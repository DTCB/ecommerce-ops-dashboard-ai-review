from __future__ import annotations

import json

import pandas as pd

from src.anomaly import detect_time_series_anomalies, top_declining_categories
from src.llm_client import call_openai_compatible_chat
from src.metrics import MetricConfig, calculate_kpis, category_performance, delivery_experience, monthly_trend


def build_report_context(
    order_fact: pd.DataFrame,
    item_fact: pd.DataFrame,
    customer_fact: pd.DataFrame,
    config: MetricConfig,
) -> dict:
    kpis = calculate_kpis(order_fact, customer_fact, config)
    trend = monthly_trend(order_fact, config)
    categories = category_performance(item_fact, config).head(8)
    anomalies = detect_time_series_anomalies(trend, "gmv")
    declining = top_declining_categories(item_fact, config).head(5)
    delivery = delivery_experience(order_fact)
    return {
        "kpis": kpis,
        "trend": trend.tail(6).to_dict(orient="records"),
        "top_categories": categories.to_dict(orient="records"),
        "anomalies": anomalies.to_dict(orient="records"),
        "declining_categories": declining.to_dict(orient="records"),
        "delivery": delivery,
        "gmv_mode": config.gmv_mode,
    }


def _fmt_money(value: float) -> str:
    return f"{value:,.0f}"


def render_template_report(context: dict, report_type: str = "周报", note: str | None = None) -> str:
    kpis = context["kpis"]
    top_categories = context["top_categories"][:3]
    anomalies = context["anomalies"]
    declining = context["declining_categories"]
    delivery = context["delivery"]

    top_text = "、".join(f"{row['category_english']}({_fmt_money(row['gmv'])})" for row in top_categories) or "暂无"
    anomaly_text = "；".join(f"{row['purchase_month']} {row['direction']}，z={row['z_score']:.2f}" for row in anomalies) or "未发现显著异常波动"
    decline_text = "；".join(f"{row['category_english']} 环比 {row['change_rate']:.1%}" for row in declining if pd.notna(row.get("change_rate"))) or "暂无明显下滑品类"

    fallback_note = f"\n> {note}\n" if note else ""
    return f"""# 电商运营{report_type}复盘
{fallback_note}
## 1. 核心结论
- 本期 GMV 为 **{_fmt_money(kpis['gmv'])}**，订单量 **{kpis['orders']:,}**，客单价 **{kpis['aov']:,.1f}**。
- 复购率 **{kpis['repeat_rate']:.1%}**，取消/不可用订单占比 **{kpis['cancel_rate']:.1%}**，平均评分 **{kpis['avg_review_score']:.2f}**。
- 当前贡献最高的品类为：{top_text}。

## 2. 异常与风险
- GMV 波动：{anomaly_text}。
- 品类下滑：{decline_text}。
- 履约体验：平均交付 **{delivery['avg_delivery_days']:.1f}** 天，延迟订单占比 **{delivery['late_rate']:.1%}**。

## 3. 可能原因
- GMV 变化优先从高贡献品类、履约延迟、评分变化和取消订单结构四个方向排查。
- 如果高 GMV 品类同时出现评分下降或交付延迟，说明增长质量存在风险。
- 复购率偏低时，应重点检查新客沉淀、售后体验和复购激励机制。

## 4. 运营建议
- 对 Top 品类做分层运营：高 GMV 高评分品类加大资源，高 GMV 低评分品类优先定位体验问题。
- 针对环比下滑品类检查价格、库存、物流和评价，形成单品/卖家问题清单。
- 对延迟订单占比高的地区或卖家设置预警，减少履约体验对评分和复购的拖累。

## 5. 后续验证指标
- GMV、订单量、客单价、取消率、延迟订单占比、平均评分、复购率。
"""


def build_llm_prompt(context: dict, report_type: str) -> str:
    payload = json.dumps(context, ensure_ascii=False, default=str)
    return f"""请基于以下结构化电商经营数据，生成一份{report_type}复盘。
要求固定包含：核心结论、异常解释、可能原因、运营建议、后续验证指标。
不要编造曝光、访问量、转化率等 Olist 数据集中不存在的指标。

数据：
{payload}
"""


def generate_report(context: dict, report_type: str = "周报", use_llm: bool = False) -> str:
    if not use_llm:
        return render_template_report(context, report_type)
    try:
        return call_openai_compatible_chat(build_llm_prompt(context, report_type))
    except Exception as exc:  # noqa: BLE001 - UI should gracefully fall back for demo reliability.
        return render_template_report(context, report_type, note=str(exc))

