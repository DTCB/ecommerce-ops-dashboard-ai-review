from __future__ import annotations

import json
import sqlite3
import sys
from calendar import monthrange
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import DB_PATH, ROOT_DIR
from src.metrics import MetricConfig, monthly_trend


def compare(current: dict, previous: dict, basis: str, categories: pd.DataFrame) -> dict:
    current_days = current["days"] if basis == "daily" else 1
    previous_days = previous["days"] if basis == "daily" else 1
    metrics = {}
    for key in ("gmv", "orders", "aov"):
        before = previous[key] / (previous_days if key != "aov" else 1)
        after = current[key] / (current_days if key != "aov" else 1)
        metrics[key] = {
            "current": after,
            "previous": before,
            "rate": (after - before) / before,
        }

    category_changes = []
    for category, row in categories.iterrows():
        before = float(row[previous["month"]]) / previous_days
        after = float(row[current["month"]]) / current_days
        if abs(after - before) < 0.005:
            continue
        category_changes.append({
            "category": category,
            "previous": before,
            "current": after,
            "delta": after - before,
            "rate": (after - before) / before if before else None,
        })
    category_changes.sort(key=lambda row: (row["delta"], row["category"]))

    return {
        "metrics": metrics,
        "order_effect": (metrics["orders"]["current"] - metrics["orders"]["previous"]) * previous["aov"],
        "aov_effect": metrics["orders"]["current"] * (current["aov"] - previous["aov"]),
        "gainers": [row for row in reversed(category_changes) if row["delta"] > 0][:5],
        "decliners": [row for row in category_changes if row["delta"] < 0][:5],
    }


def main() -> None:
    if not DB_PATH.is_file():
        raise SystemExit("请先执行 python scripts/build_database.py 生成 Olist SQLite 数据。")

    months = ["2017-12", *(f"2018-{month:02d}" for month in range(1, 8))]
    period = (months[0], months[-1])
    with sqlite3.connect(f"{DB_PATH.as_uri()}?mode=ro", uri=True) as connection:
        orders = pd.read_sql_query(
            "SELECT purchase_month, order_id, order_status, total_gmv FROM order_fact "
            "WHERE purchase_month BETWEEN ? AND ?",
            connection,
            params=period,
        )
        items = pd.read_sql_query(
            "SELECT purchase_month, category_english, sum(total_gmv) AS gmv, "
            "count(DISTINCT order_id) AS orders FROM item_fact "
            "WHERE order_status = 'delivered' AND purchase_month BETWEEN ? AND ? "
            "GROUP BY purchase_month, category_english",
            connection,
            params=period,
        )
        regions = pd.read_sql_query(
            "SELECT purchase_month, category_english, coalesce(nullif(customer_state, ''), 'unknown') AS state, "
            "sum(total_gmv) AS gmv, count(DISTINCT order_id) AS orders FROM item_fact "
            "WHERE order_status = 'delivered' AND purchase_month BETWEEN ? AND ? "
            "GROUP BY purchase_month, category_english, state",
            connection,
            params=period,
        )
        products = pd.read_sql_query(
            "SELECT purchase_month, category_english, product_id, "
            "coalesce(nullif(customer_state, ''), 'unknown') AS state, "
            "sum(total_gmv) AS gmv, count(DISTINCT order_id) AS orders FROM item_fact "
            "WHERE order_status = 'delivered' AND purchase_month BETWEEN ? AND ? "
            "AND product_id IS NOT NULL "
            "GROUP BY purchase_month, category_english, state, product_id",
            connection,
            params=period,
        )

    trend = monthly_trend(orders, MetricConfig()).set_index("purchase_month")
    if trend.index.tolist() != months:
        raise SystemExit("Olist 数据缺少演示所需的月份。")
    categories = (
        items.pivot(index="category_english", columns="purchase_month", values="gmv")
        .reindex(columns=months, fill_value=0)
        .fillna(0)
        .round(2)
    )
    monthly = [
        {
            "month": month,
            "days": monthrange(*map(int, month.split("-")))[1],
            "gmv": round(float(trend.loc[month, "gmv"]), 2),
            "orders": int(trend.loc[month, "orders"]),
            "aov": float(trend.loc[month, "aov"]),
        }
        for month in months
    ]
    cases = {
        current["month"]: {
            "previous": previous["month"],
            **{basis: compare(current, previous, basis, categories) for basis in ("total", "daily")},
        }
        for previous, current in zip(monthly, monthly[1:])
    }
    data = {"monthly": monthly, "cases": cases}
    destination = ROOT_DIR / "data" / "demo_aggregates.json"
    destination.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Exported {len(months)} monthly aggregates to {destination.name}")

    diagnostics: dict = {month: {} for month in months}
    for row in items.itertuples(index=False):
        diagnostics[row.purchase_month][row.category_english] = {
            "gmv": round(row.gmv, 2), "orders": row.orders, "states": {},
        }
    for row in regions.itertuples(index=False):
        diagnostics[row.purchase_month][row.category_english]["states"][row.state] = {
            "gmv": round(row.gmv, 2), "orders": row.orders,
        }
    destination = ROOT_DIR / "data" / "demo_diagnostics.json"
    destination.write_text(json.dumps(diagnostics, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Exported category and buyer state aggregates to {destination.name}")

    product_data: dict = {month: {} for month in months}
    for row in products.itertuples(index=False):
        scopes = product_data[row.purchase_month].setdefault(row.category_english, {})
        scopes.setdefault(row.state, {})[row.product_id] = [round(row.gmv, 2), row.orders]
    destination = ROOT_DIR / "data" / "demo_products.json"
    destination.write_text(json.dumps(product_data, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Exported product aggregates to {destination.name}")


if __name__ == "__main__":
    main()
