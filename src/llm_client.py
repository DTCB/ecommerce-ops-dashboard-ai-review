from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

try:
    from dotenv import dotenv_values
except ImportError:  # pragma: no cover - dependency is optional for core logic.
    dotenv_values = None


ENV_PATH = Path(__file__).resolve().parents[1] / ".env"


class LLMConfigError(RuntimeError):
    pass


def _read_dotenv() -> dict[str, str]:
    if not dotenv_values or not ENV_PATH.exists():
        return {}
    return {key: value for key, value in dotenv_values(ENV_PATH).items() if value}


def get_llm_settings() -> dict[str, str]:
    dotenv_config = _read_dotenv()
    api_key = (
        os.getenv("LLM_API_KEY")
        or os.getenv("OPENAI_API_KEY")
        or dotenv_config.get("LLM_API_KEY")
        or dotenv_config.get("OPENAI_API_KEY")
        or ""
    ).strip()
    base_url = (
        os.getenv("LLM_BASE_URL")
        or os.getenv("OPENAI_BASE_URL")
        or dotenv_config.get("LLM_BASE_URL")
        or dotenv_config.get("OPENAI_BASE_URL")
        or "https://api.openai.com/v1"
    ).strip().rstrip("/")
    model = (
        os.getenv("LLM_MODEL")
        or os.getenv("OPENAI_MODEL")
        or dotenv_config.get("LLM_MODEL")
        or dotenv_config.get("OPENAI_MODEL")
        or "gpt-4o-mini"
    ).strip()
    return {"api_key": api_key, "base_url": base_url, "model": model}


def call_openai_compatible_chat(prompt: str, timeout: int = 45) -> str:
    settings = get_llm_settings()
    api_key = settings["api_key"]
    base_url = settings["base_url"]
    model = settings["model"]
    if not api_key:
        raise LLMConfigError("未检测到 LLM_API_KEY/OPENAI_API_KEY，已降级为模板复盘。")

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "你是一名电商运营数据分析师，请输出结构化、可执行的经营复盘。"},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
    }
    req = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"LLM API 调用失败，已降级为模板复盘：{exc}") from exc
    return data["choices"][0]["message"]["content"]
