from __future__ import annotations

import pytest

from src.metrics import (
    MetricConfig,
    build_customer_fact,
    build_item_fact,
    build_order_fact,
    calculate_kpis,
    category_performance,
    cohort_retention,
)
from src.sample_data import build_demo_tables


def _facts():
    tables = build_demo_tables()
    order_fact = build_order_fact(tables)
    item_fact = build_item_fact(tables)
    customer_fact = build_customer_fact(order_fact)
    return order_fact, item_fact, customer_fact


def test_kpis_exclude_canceled_orders_from_default_gmv():
    order_fact, _, customer_fact = _facts()
    kpis = calculate_kpis(order_fact, customer_fact, MetricConfig("total"))
    assert kpis["orders"] == 5
    assert kpis["gmv"] == pytest.approx(1007.0)
    assert kpis["aov"] == pytest.approx(201.4)
    assert kpis["cancel_rate"] == pytest.approx(1 / 6)


def test_repeat_rate_uses_customer_unique_id():
    order_fact, _, customer_fact = _facts()
    kpis = calculate_kpis(order_fact, customer_fact, MetricConfig("total"))
    assert kpis["repeat_rate"] == pytest.approx(1 / 4)


def test_category_performance_uses_translated_category():
    _, item_fact, _ = _facts()
    perf = category_performance(item_fact, MetricConfig("goods"))
    assert perf.iloc[0]["category_english"] == "computers_accessories"
    assert perf.iloc[0]["gmv"] == pytest.approx(540.0)


def test_cohort_retention_has_second_month_repeat():
    order_fact, _, _ = _facts()
    retention = cohort_retention(order_fact)
    assert retention.loc["2018-01", 1] == pytest.approx(0.5)
