from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlsplit

import httpx
from dotenv import dotenv_values
from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from api import _quota as quota
from api._diagnostics import pick_categories, run_check

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "data" / "demo_aggregates.json").read_text(encoding="utf-8"))
DIAGNOSTICS = json.loads((ROOT / "data" / "demo_diagnostics.json").read_text(encoding="utf-8"))
PRODUCTS = json.loads((ROOT / "data" / "demo_products.json").read_text(encoding="utf-8"))
MODEL_TIMEOUT = 25
app = FastAPI(title="经营透镜 API")
logger = logging.getLogger("uvicorn.error")


class ReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    month: str
    basis: Literal["total", "daily"]


class CheckRequest(ReviewRequest):
    category: str
    operation: Literal["volume_aov", "state_orders", "product_changes"]
    state: str | None = None


class Statement(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    text: str = Field(min_length=1, max_length=240)
    evidence: list[str] = Field(min_length=1)


StatementList = Annotated[list[Statement], Field(min_length=1, max_length=3)]


class Hypothesis(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    driver: Literal["order_volume", "aov"]
    text: str = Field(min_length=1, max_length=240)


class ReviewContent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    observations: StatementList
    diagnostics: dict[str, Hypothesis]


def settings() -> dict[str, str]:
    local = {}
    if not os.getenv("VERCEL"):
        path = ROOT / ".env.local"
        local = dotenv_values(path if path.is_file() else ROOT / ".env")
    return {
        name: (os.environ.get(name) or local.get(name) or default).strip()
        for name, default in {
            "LLM_API_KEY": "",
            "LLM_BASE_URL": "",
            "LLM_MODEL": "qwen3.8-flash",
        }.items()
    }


def is_configured(config: dict[str, str]) -> bool:
    try:
        endpoint = urlsplit(config["LLM_BASE_URL"])
    except ValueError:
        return False
    return bool(
        config["LLM_API_KEY"]
        and config["LLM_MODEL"]
        and endpoint.scheme == "https"
        and endpoint.hostname
        and endpoint.path.rstrip("/").endswith("/compatible-mode/v1")
        and not (endpoint.username or endpoint.password or endpoint.query or endpoint.fragment)
    )


def live_enabled(config: dict[str, str]) -> bool:
    return is_configured(config) and (
        not os.getenv("VERCEL")
        or (
            os.getenv("VERCEL_ENV") == "production"
            and bool(os.getenv("LLM_MODEL", "").strip())
            and os.getenv("AI_BUDGET_CONFIRMED") == "1"
            and quota.configured()
        )
    )


@app.get("/api/status")
def status(response: Response) -> dict[str, bool]:
    response.headers["Cache-Control"] = "no-store"
    return {"available": live_enabled(settings())}


def make_evidence(case: dict) -> dict:
    return {
        **case["metrics"],
        "bridge": {"order_effect": case["order_effect"], "aov_effect": case["aov_effect"]},
        **{f"category:{row['category']}": row for row in case["gainers"] + case["decliners"]},
    }


def validate_report(response: dict, references: dict[str, str], targets: dict[str, dict]) -> ReviewContent:
    choice = response["choices"][0]
    if choice["finish_reason"] != "stop":
        raise ValueError("incomplete completion")
    report = ReviewContent.model_validate_json(choice["message"]["content"])
    if report.diagnostics.keys() != targets.keys():
        raise ValueError("invalid diagnosis slots")
    for statement in report.observations:
        if not set(statement.evidence) <= references.keys():
            raise ValueError("unknown evidence ID")
        statement.evidence = [references[key] for key in list(dict.fromkeys(statement.evidence))[:3]]
    return report


def get_case(request: ReviewRequest) -> dict:
    case = DATA["cases"].get(request.month)
    if case is None:
        raise HTTPException(status_code=422, detail="请选择 2018 年 1–7 月内的分析月份。")
    return case


@app.post("/api/review/check")
def check(request: CheckRequest) -> dict:
    case = get_case(request)
    view = case[request.basis]
    if request.category not in {row["category"] for row in view["gainers"] + view["decliners"]}:
        raise HTTPException(status_code=422, detail="请选择当前涨跌榜中的品类。")
    data = PRODUCTS if request.operation == "product_changes" else DIAGNOSTICS
    if request.state is not None and (
        request.operation != "product_changes"
        or not any(request.state in data[month].get(request.category, {}) for month in (request.month, case["previous"]))
    ):
        raise HTTPException(status_code=422, detail="请选择该品类比较期内的买家州。")
    return {
        **request.model_dump(exclude_none=True),
        **run_check(data, request.month, case["previous"], request.basis, request.category, request.operation, request.state),
    }


@app.post("/api/review")
async def review(request: ReviewRequest, http_request: Request) -> dict:
    case = get_case(request)
    config = settings()
    if not live_enabled(config):
        raise HTTPException(status_code=503, detail="实时 AI 复盘尚未开放，仍可查看案例和下钻结果。")

    if os.getenv("VERCEL"):
        await quota.reserve(http_request.headers.get("x-vercel-forwarded-for", ""))

    view = case[request.basis]
    evidence = make_evidence(view)
    references = {f"E{number:02}": target for number, target in enumerate(evidence, start=1)}
    targets = {f"D{number:02}": row for number, row in enumerate(pick_categories(view), start=1)}
    example = {
        "observations": [{"text": "中文数据结论", "evidence": ["E01"]}],
        "diagnostics": {key: {"driver": "order_volume", "text": "值得验证的理由"} for key in targets},
    }
    payload = {
        "model": config["LLM_MODEL"],
        "enable_thinking": False,
        "stream": False,
        "max_tokens": 1800,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是一名电商经营数据分析师。只输出以下结构的 JSON 对象："
                    + json.dumps(example, ensure_ascii=False)
                    + "。observations 写 1 至 3 条中文结论，每项 evidence 只填输入 evidence 的顶层编号（如 E01）。"
                    "只描述证据支持的经营变化。diagnostics 必须包含 targets 中每个编号且仅包含这些编号。"
                    "每项 driver 只能是 order_volume（订单量主导）或 aov（客单价主导）。"
                    "text 写一句中文，结合已有品类 GMV 与全站量价变化，说明为什么值得验证这个方向。"
                    "品类量价结果要等用户点击后计算，不能声称已确认品类订单数或客单价变化。"
                    "品类用中文名称，不复写数字，不虚构库存、活动、流量或经营原因。"
                ),
            },
            {
                "role": "user",
                "content": json.dumps({
                    "month": request.month,
                    "previous": case["previous"],
                    "basis": request.basis,
                    "scope": "已交付订单，含运费 GMV，货币 BRL",
                    "targets": targets,
                    "evidence": {
                        key: {"metric": target, **evidence[target]}
                        for key, target in references.items()
                    },
                }, ensure_ascii=False),
            },
        ],
    }
    try:
        async with asyncio.timeout(MODEL_TIMEOUT):
            async with httpx.AsyncClient(follow_redirects=False) as client:
                response = await client.post(
                    config["LLM_BASE_URL"].rstrip("/") + "/chat/completions",
                    headers={"Authorization": f"Bearer {config['LLM_API_KEY']}"},
                    json=payload,
                    timeout=MODEL_TIMEOUT,
                )
                response.raise_for_status()
                result = response.json()
                report = validate_report(result, references, targets)
    except (TimeoutError, httpx.TimeoutException) as exc:
        raise HTTPException(status_code=504, detail="百炼响应超时，请稍后重试。") from exc
    except httpx.HTTPStatusError as exc:
        upstream = exc.response.status_code
        detail = {
            401: "百炼未接受当前凭据，请检查 API Key 与接口地域。",
            403: "百炼拒绝了本次请求，请检查模型权限。",
            429: "百炼暂时限流，请稍后重试。",
        }.get(upstream, "百炼调用失败，请检查接口地址和模型设置后重试。")
        raise HTTPException(status_code=502, detail=detail) from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="暂时无法连接百炼服务，请检查网络后重试。") from exc
    except ValidationError as exc:
        logger.warning("AI review schema mismatch: %s", [item["type"] for item in exc.errors(include_input=False)])
        raise HTTPException(status_code=502, detail="百炼未返回有效的经营复盘，请重试。") from exc
    except (ValueError, TypeError, KeyError, IndexError) as exc:
        logger.warning("AI review rejected: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="百炼未返回有效的经营复盘，请重试。") from exc

    upstream_model = result.get("model")
    return {
        "observations": [item.model_dump() for item in report.observations],
        "diagnostics": [
            {"category": row["category"], "gmv_delta": row["delta"], **report.diagnostics[key].model_dump()}
            for key, row in targets.items()
        ],
        "month": request.month,
        "basis": request.basis,
        "model": upstream_model if isinstance(upstream_model, str) and upstream_model else config["LLM_MODEL"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
