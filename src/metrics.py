from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


DATE_COLUMNS = [
    "order_purchase_timestamp",
    "order_approved_at",
    "order_delivered_carrier_date",
    "order_delivered_customer_date",
    "order_estimated_delivery_date",
]


@dataclass(frozen=True)
class MetricConfig:
    gmv_mode: str = "total"

    @property
    def gmv_column(self) -> str:
        return "total_gmv" if self.gmv_mode == "total" else "goods_gmv"


def _copy_tables(tables: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    return {key: value.copy() for key, value in tables.items()}


def _to_datetime(df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    for column in columns:
        if column in df.columns:
            df[column] = pd.to_datetime(df[column], errors="coerce")
    return df


def _prepare_orders(tables: dict[str, pd.DataFrame]) -> pd.DataFrame:
    data = _copy_tables(tables)
    orders = data["orders"].drop_duplicates("order_id")
    orders = _to_datetime(orders, DATE_COLUMNS)
    customers = data["customers"].drop_duplicates("customer_id")
    reviews = data["order_reviews"].groupby("order_id", as_index=False)["review_score"].mean()
    payments = (
        data["order_payments"]
        .groupby("order_id", as_index=False)
        .agg(payment_value=("payment_value", "sum"), payment_type=("payment_type", lambda x: x.mode().iat[0] if not x.mode().empty else "unknown"))
    )
    items = (
        data["order_items"]
        .groupby("order_id", as_index=False)
        .agg(goods_gmv=("price", "sum"), freight_value=("freight_value", "sum"), item_count=("order_item_id", "count"))
    )

    fact = orders.merge(customers, on="customer_id", how="left")
    fact = fact.merge(items, on="order_id", how="left")
    fact = fact.merge(payments, on="order_id", how="left")
    fact = fact.merge(reviews, on="order_id", how="left")
    fact["goods_gmv"] = fact["goods_gmv"].fillna(0.0)
    fact["freight_value"] = fact["freight_value"].fillna(0.0)
    fact["total_gmv"] = fact["goods_gmv"] + fact["freight_value"]
    fact["item_count"] = fact["item_count"].fillna(0).astype(int)
    fact["purchase_date"] = fact["order_purchase_timestamp"].dt.floor("D")
    fact["purchase_month"] = fact["order_purchase_timestamp"].dt.to_period("M").astype(str)
    fact["delivery_days"] = (
        fact["order_delivered_customer_date"] - fact["order_purchase_timestamp"]
    ).dt.total_seconds() / 86400
    fact["delay_days"] = (
        fact["order_delivered_customer_date"] - fact["order_estimated_delivery_date"]
    ).dt.total_seconds() / 86400
    return fact


def build_order_fact(tables: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return _prepare_orders(tables)


def build_item_fact(tables: dict[str, pd.DataFrame]) -> pd.DataFrame:
    data = _copy_tables(tables)
    orders = _to_datetime(data["orders"].drop_duplicates("order_id"), DATE_COLUMNS)
    customers = data["customers"].drop_duplicates("customer_id")
    products = data["products"].drop_duplicates("product_id")
    sellers = data["sellers"].drop_duplicates("seller_id")
    translations = data["category_translation"].drop_duplicates("product_category_name")
    reviews = data["order_reviews"].groupby("order_id", as_index=False)["review_score"].mean()

    products = products.merge(translations, on="product_category_name", how="left")
    products["category_english"] = products["product_category_name_english"].fillna(
        products["product_category_name"]
    )
    items = data["order_items"].drop_duplicates(["order_id", "order_item_id"])
    fact = items.merge(orders, on="order_id", how="left")
    fact = fact.merge(customers, on="customer_id", how="left")
    fact = fact.merge(products[["product_id", "category_english"]], on="product_id", how="left")
    fact = fact.merge(sellers, on="seller_id", how="left", suffixes=("", "_seller"))
    fact = fact.merge(reviews, on="order_id", how="left")
    fact["category_english"] = fact["category_english"].fillna("unknown")
    fact["goods_gmv"] = fact["price"].fillna(0.0)
    fact["total_gmv"] = fact["price"].fillna(0.0) + fact["freight_value"].fillna(0.0)
    fact["purchase_date"] = fact["order_purchase_timestamp"].dt.floor("D")
    fact["purchase_month"] = fact["order_purchase_timestamp"].dt.to_period("M").astype(str)
    return fact


def build_customer_fact(order_fact: pd.DataFrame) -> pd.DataFrame:
    delivered = order_fact[order_fact["order_status"] == "delivered"].copy()
    if delivered.empty:
        return pd.DataFrame(columns=["customer_unique_id", "first_purchase_date", "last_purchase_date", "orders", "gmv", "is_repeat"])
    return (
        delivered.groupby("customer_unique_id", as_index=False)
        .agg(
            first_purchase_date=("purchase_date", "min"),
            last_purchase_date=("purchase_date", "max"),
            orders=("order_id", "nunique"),
            gmv=("total_gmv", "sum"),
        )
        .assign(is_repeat=lambda df: df["orders"] >= 2)
    )


def _delivered(df: pd.DataFrame) -> pd.DataFrame:
    return df[df["order_status"] == "delivered"].copy()


def calculate_kpis(order_fact: pd.DataFrame, customer_fact: pd.DataFrame, config: MetricConfig) -> dict[str, float]:
    delivered = _delivered(order_fact)
    all_orders = order_fact["order_id"].nunique()
    orders = delivered["order_id"].nunique()
    gmv = delivered[config.gmv_column].sum()
    customers = customer_fact["customer_unique_id"].nunique() if not customer_fact.empty else 0
    repeats = int(customer_fact["is_repeat"].sum()) if "is_repeat" in customer_fact else 0
    return {
        "gmv": float(gmv),
        "orders": int(orders),
        "aov": float(gmv / orders) if orders else 0.0,
        "repeat_rate": float(repeats / customers) if customers else 0.0,
        "cancel_rate": float((order_fact["order_status"].isin(["canceled", "unavailable"]).sum()) / all_orders) if all_orders else 0.0,
        "fulfillment_rate": float(orders / all_orders) if all_orders else 0.0,
        "avg_review_score": float(delivered["review_score"].mean()) if not delivered.empty else 0.0,
    }


def monthly_trend(order_fact: pd.DataFrame, config: MetricConfig) -> pd.DataFrame:
    delivered = _delivered(order_fact)
    if delivered.empty:
        return pd.DataFrame(columns=["purchase_month", "gmv", "orders", "aov"])
    trend = (
        delivered.groupby("purchase_month", as_index=False)
        .agg(gmv=(config.gmv_column, "sum"), orders=("order_id", "nunique"))
        .sort_values("purchase_month")
    )
    trend["aov"] = np.where(trend["orders"] > 0, trend["gmv"] / trend["orders"], 0)
    return trend


def category_performance(item_fact: pd.DataFrame, config: MetricConfig) -> pd.DataFrame:
    delivered = _delivered(item_fact)
    if delivered.empty:
        return pd.DataFrame(columns=["category_english", "gmv", "orders", "items", "aov", "avg_review_score"])
    perf = (
        delivered.groupby("category_english", as_index=False)
        .agg(
            gmv=(config.gmv_column, "sum"),
            orders=("order_id", "nunique"),
            items=("order_item_id", "count"),
            avg_review_score=("review_score", "mean"),
        )
        .sort_values("gmv", ascending=False)
    )
    perf["aov"] = np.where(perf["orders"] > 0, perf["gmv"] / perf["orders"], 0)
    return perf


def region_performance(order_fact: pd.DataFrame, config: MetricConfig) -> pd.DataFrame:
    delivered = _delivered(order_fact)
    if delivered.empty:
        return pd.DataFrame(columns=["customer_state", "gmv", "orders", "customers"])
    return (
        delivered.groupby("customer_state", as_index=False)
        .agg(gmv=(config.gmv_column, "sum"), orders=("order_id", "nunique"), customers=("customer_unique_id", "nunique"))
        .sort_values("gmv", ascending=False)
    )


def cohort_retention(order_fact: pd.DataFrame) -> pd.DataFrame:
    delivered = _delivered(order_fact)
    if delivered.empty:
        return pd.DataFrame()
    orders = delivered[["customer_unique_id", "order_id", "order_purchase_timestamp"]].dropna().copy()
    orders["order_month"] = orders["order_purchase_timestamp"].dt.to_period("M")
    first = orders.groupby("customer_unique_id")["order_month"].transform("min")
    orders["cohort_month"] = first
    orders["month_index"] = (orders["order_month"].dt.year - first.dt.year) * 12 + (orders["order_month"].dt.month - first.dt.month)
    grouped = orders.groupby(["cohort_month", "month_index"])["customer_unique_id"].nunique().reset_index()
    cohort = grouped.pivot(index="cohort_month", columns="month_index", values="customer_unique_id").fillna(0)
    base = cohort[0].replace(0, np.nan)
    retention = cohort.divide(base, axis=0).fillna(0)
    retention.index = retention.index.astype(str)
    return retention


def delivery_experience(order_fact: pd.DataFrame) -> dict[str, float]:
    delivered = _delivered(order_fact)
    if delivered.empty:
        return {"avg_delivery_days": 0.0, "avg_delay_days": 0.0, "late_rate": 0.0}
    late = delivered["delay_days"] > 0
    return {
        "avg_delivery_days": float(delivered["delivery_days"].mean()),
        "avg_delay_days": float(delivered["delay_days"].clip(lower=0).mean()),
        "late_rate": float(late.mean()),
    }


def payment_mix(order_fact: pd.DataFrame) -> pd.DataFrame:
    if order_fact.empty:
        return pd.DataFrame(columns=["payment_type", "payment_value", "orders"])
    return (
        order_fact.groupby("payment_type", as_index=False)
        .agg(payment_value=("payment_value", "sum"), orders=("order_id", "nunique"))
        .sort_values("payment_value", ascending=False)
    )

