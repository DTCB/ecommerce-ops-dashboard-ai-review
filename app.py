from __future__ import annotations

from pathlib import Path

import pandas as pd
import plotly.express as px
import streamlit as st

from src.anomaly import detect_time_series_anomalies, top_declining_categories
from src.config import DATA_PROCESSED_DIR, DATA_RAW_DIR, DB_PATH
from src.data_loader import MissingDataError, load_raw_tables
from src.database import read_model_tables, write_model_tables
from src.llm_client import get_llm_settings
from src.metrics import (
    MetricConfig,
    build_customer_fact,
    build_item_fact,
    build_order_fact,
    calculate_kpis,
    category_performance,
    cohort_retention,
    delivery_experience,
    monthly_trend,
    payment_mix,
    region_performance,
)
from src.report import build_report_context, generate_report
from src.sample_data import build_demo_tables


st.set_page_config(
    page_title="电商运营数据分析看板 + AI复盘助手",
    page_icon="📊",
    layout="wide",
)


@st.cache_data(show_spinner=False)
def load_modeled_data(source: str) -> dict[str, pd.DataFrame]:
    if source == "SQLite 数据库" and DB_PATH.exists():
        return read_model_tables(DB_PATH)

    if source == "Olist CSV":
        raw_tables = load_raw_tables(DATA_RAW_DIR)
    else:
        raw_tables = build_demo_tables()

    order_fact = build_order_fact(raw_tables)
    item_fact = build_item_fact(raw_tables)
    customer_fact = build_customer_fact(order_fact)
    return {
        "order_fact": order_fact,
        "item_fact": item_fact,
        "customer_fact": customer_fact,
    }


def available_sources() -> list[str]:
    sources = ["演示样例数据"]
    if DB_PATH.exists():
        sources.insert(0, "SQLite 数据库")
    sources.append("Olist CSV")
    return sources


def filter_data(
    tables: dict[str, pd.DataFrame],
    date_range: tuple[pd.Timestamp, pd.Timestamp],
    states: list[str],
    categories: list[str],
) -> dict[str, pd.DataFrame]:
    order_fact = tables["order_fact"].copy()
    item_fact = tables["item_fact"].copy()
    start, end = date_range

    order_mask = order_fact["purchase_date"].between(start, end)
    item_mask = item_fact["purchase_date"].between(start, end)

    if states:
        order_mask &= order_fact["customer_state"].isin(states)
        item_mask &= item_fact["customer_state"].isin(states)
    if categories:
        order_ids = item_fact.loc[item_fact["category_english"].isin(categories), "order_id"].unique()
        order_mask &= order_fact["order_id"].isin(order_ids)
        item_mask &= item_fact["category_english"].isin(categories)

    filtered_order = order_fact.loc[order_mask].copy()
    filtered_item = item_fact.loc[item_mask].copy()
    return {
        "order_fact": filtered_order,
        "item_fact": filtered_item,
        "customer_fact": build_customer_fact(filtered_order),
    }


def metric_card(label: str, value: str, help_text: str | None = None) -> None:
    st.metric(label, value, help=help_text)


def render_setup_warning(error: Exception) -> None:
    st.warning("未检测到完整 Olist 原始数据，当前可先使用演示样例数据。")
    with st.expander("Olist 数据放置说明", expanded=True):
        st.write(
            "请从 Kaggle 下载 Olist Brazilian E-Commerce Public Dataset，解压后将 CSV 放入 "
            f"`{DATA_RAW_DIR}`。需要的核心文件见 README。"
        )
        st.code(str(error), language="text")


def main() -> None:
    st.title("电商运营数据分析看板 + AI复盘助手")
    st.caption("围绕经营诊断构建：数据导入、指标体系、异常识别、AI/模板双模式复盘。")

    with st.sidebar:
        st.header("数据与口径")
        source = st.selectbox("数据来源", available_sources())
        gmv_mode = st.radio("GMV 口径", ["含运费 GMV", "商品金额 GMV"], horizontal=True)
        if st.button("从 data/raw 导入并写入 SQLite", use_container_width=True):
            try:
                raw_tables = load_raw_tables(DATA_RAW_DIR)
                modeled = {
                    "order_fact": build_order_fact(raw_tables),
                    "item_fact": build_item_fact(raw_tables),
                }
                modeled["customer_fact"] = build_customer_fact(modeled["order_fact"])
                DATA_PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
                write_model_tables(DB_PATH, modeled)
                st.success(f"已写入 {DB_PATH}")
                st.cache_data.clear()
            except MissingDataError as exc:
                st.error(str(exc))

    try:
        tables = load_modeled_data(source)
    except MissingDataError as exc:
        render_setup_warning(exc)
        tables = {
            "order_fact": build_order_fact(build_demo_tables()),
            "item_fact": build_item_fact(build_demo_tables()),
        }
        tables["customer_fact"] = build_customer_fact(tables["order_fact"])

    order_fact = tables["order_fact"]
    item_fact = tables["item_fact"]
    if order_fact.empty:
        st.error("当前数据为空，请检查筛选条件或原始数据。")
        return

    min_date = order_fact["purchase_date"].min()
    max_date = order_fact["purchase_date"].max()
    states = sorted(order_fact["customer_state"].dropna().unique().tolist())
    categories = sorted(item_fact["category_english"].dropna().unique().tolist())

    with st.sidebar:
        date_range_raw = st.date_input(
            "分析日期",
            value=(min_date.date(), max_date.date()),
            min_value=min_date.date(),
            max_value=max_date.date(),
        )
        selected_states = st.multiselect("州/地区", states)
        selected_categories = st.multiselect("品类", categories)

    if len(date_range_raw) != 2:
        st.info("请选择完整的起止日期。")
        return

    filtered = filter_data(
        tables,
        (pd.Timestamp(date_range_raw[0]), pd.Timestamp(date_range_raw[1])),
        selected_states,
        selected_categories,
    )
    config = MetricConfig(gmv_mode="total" if gmv_mode == "含运费 GMV" else "goods")

    page = st.sidebar.radio(
        "页面",
        ["总览", "经营诊断", "品类与商品", "用户与地域", "履约与体验", "AI复盘"],
    )

    order_fact = filtered["order_fact"]
    item_fact = filtered["item_fact"]
    customer_fact = filtered["customer_fact"]
    kpis = calculate_kpis(order_fact, customer_fact, config)
    trend = monthly_trend(order_fact, config)

    if page == "总览":
        cols = st.columns(6)
        cols[0].metric("GMV", f"{kpis['gmv']:,.0f}")
        cols[1].metric("订单量", f"{kpis['orders']:,}")
        cols[2].metric("客单价", f"{kpis['aov']:,.1f}")
        cols[3].metric("复购率", f"{kpis['repeat_rate']:.1%}")
        cols[4].metric("取消率", f"{kpis['cancel_rate']:.1%}")
        cols[5].metric("平均评分", f"{kpis['avg_review_score']:.2f}")
        st.plotly_chart(px.line(trend, x="purchase_month", y="gmv", markers=True, title="月度 GMV 趋势"), use_container_width=True)
        st.plotly_chart(px.bar(trend, x="purchase_month", y="orders", title="月度订单量"), use_container_width=True)

    elif page == "经营诊断":
        anomalies = detect_time_series_anomalies(trend, "gmv")
        declining = top_declining_categories(item_fact, config)
        left, right = st.columns(2)
        with left:
            st.subheader("GMV 异常波动")
            st.dataframe(anomalies, use_container_width=True, hide_index=True)
        with right:
            st.subheader("Top 下滑品类")
            st.dataframe(declining, use_container_width=True, hide_index=True)
        status = order_fact.groupby("order_status", as_index=False)["order_id"].nunique()
        st.plotly_chart(px.bar(status, x="order_status", y="order_id", title="订单状态分布"), use_container_width=True)

    elif page == "品类与商品":
        perf = category_performance(item_fact, config)
        st.plotly_chart(px.bar(perf.head(15), x="category_english", y="gmv", title="品类 GMV Top15"), use_container_width=True)
        st.dataframe(perf, use_container_width=True, hide_index=True)
        price_fig = px.histogram(item_fact[item_fact["order_status"] == "delivered"], x="price", nbins=30, title="商品价格带分布")
        st.plotly_chart(price_fig, use_container_width=True)

    elif page == "用户与地域":
        region = region_performance(order_fact, config)
        retention = cohort_retention(order_fact)
        st.plotly_chart(px.bar(region.head(15), x="customer_state", y="gmv", title="州/地区 GMV Top15"), use_container_width=True)
        st.subheader("月度 Cohort 留存")
        st.dataframe(retention.style.format("{:.1%}"), use_container_width=True)

    elif page == "履约与体验":
        delivery = delivery_experience(order_fact)
        payments = payment_mix(order_fact)
        cols = st.columns(3)
        cols[0].metric("平均交付天数", f"{delivery['avg_delivery_days']:.1f}")
        cols[1].metric("平均延迟天数", f"{delivery['avg_delay_days']:.1f}")
        cols[2].metric("延迟订单占比", f"{delivery['late_rate']:.1%}")
        st.plotly_chart(px.bar(payments, x="payment_type", y="payment_value", title="支付方式金额结构"), use_container_width=True)
        st.plotly_chart(px.scatter(order_fact, x="delivery_days", y="review_score", title="交付时长与评分关系"), use_container_width=True)

    else:
        report_type = st.selectbox("报告类型", ["日报", "周报", "月报"])
        context = build_report_context(order_fact, item_fact, customer_fact, config)
        use_llm = st.toggle("尝试调用真实 LLM API", value=False)
        settings = get_llm_settings()
        status = "已检测到 API Key" if settings["api_key"] else "未检测到 API Key"
        st.caption(f"{status} | Base URL: `{settings['base_url']}` | Model: `{settings['model']}`")
        report = generate_report(context, report_type=report_type, use_llm=use_llm)
        st.download_button("下载 Markdown 复盘", report, file_name="operation_review.md", mime="text/markdown")
        st.markdown(report)


if __name__ == "__main__":
    main()
