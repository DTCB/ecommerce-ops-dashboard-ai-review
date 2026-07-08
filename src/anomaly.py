from __future__ import annotations

import pandas as pd

from src.metrics import MetricConfig


def detect_time_series_anomalies(trend: pd.DataFrame, value_col: str = "gmv", window: int = 3, threshold: float = 1.5) -> pd.DataFrame:
    if trend.empty or len(trend) < 3:
        return pd.DataFrame(columns=["purchase_month", value_col, "rolling_mean", "z_score", "direction"])
    result = trend.copy().sort_values("purchase_month")
    result["rolling_mean"] = result[value_col].rolling(window=window, min_periods=2).mean().shift(1)
    result["rolling_std"] = result[value_col].rolling(window=window, min_periods=2).std(ddof=0).shift(1)
    result["z_score"] = (result[value_col] - result["rolling_mean"]) / result["rolling_std"].replace(0, pd.NA)
    result["direction"] = result["z_score"].apply(lambda x: "上升异常" if pd.notna(x) and x > 0 else "下降异常")
    result = result[result["z_score"].abs() >= threshold]
    return result[["purchase_month", value_col, "rolling_mean", "z_score", "direction"]].reset_index(drop=True)


def top_declining_categories(item_fact: pd.DataFrame, config: MetricConfig, top_n: int = 10) -> pd.DataFrame:
    delivered = item_fact[item_fact["order_status"] == "delivered"].copy()
    if delivered.empty or delivered["purchase_month"].nunique() < 2:
        return pd.DataFrame(columns=["category_english", "previous_gmv", "latest_gmv", "change", "change_rate"])
    months = sorted(delivered["purchase_month"].dropna().unique())
    previous_month, latest_month = months[-2], months[-1]
    pivot = (
        delivered[delivered["purchase_month"].isin([previous_month, latest_month])]
        .groupby(["category_english", "purchase_month"])[config.gmv_column]
        .sum()
        .unstack(fill_value=0)
    )
    pivot["previous_gmv"] = pivot.get(previous_month, 0)
    pivot["latest_gmv"] = pivot.get(latest_month, 0)
    pivot["change"] = pivot["latest_gmv"] - pivot["previous_gmv"]
    pivot["change_rate"] = pivot["change"] / pivot["previous_gmv"].replace(0, pd.NA)
    return (
        pivot.reset_index()[["category_english", "previous_gmv", "latest_gmv", "change", "change_rate"]]
        .sort_values("change")
        .head(top_n)
    )

