from __future__ import annotations

import sqlite3
from pathlib import Path

import pandas as pd


MODEL_TABLES = ["order_fact", "item_fact", "customer_fact"]


def write_model_tables(db_path: str | Path, tables: dict[str, pd.DataFrame]) -> None:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        for name in MODEL_TABLES:
            tables[name].to_sql(name, conn, if_exists="replace", index=False)


def read_model_tables(db_path: str | Path) -> dict[str, pd.DataFrame]:
    path = Path(db_path)
    with sqlite3.connect(path) as conn:
        tables = {name: pd.read_sql_query(f"select * from {name}", conn) for name in MODEL_TABLES}
    for table_name in ["order_fact", "item_fact"]:
        for column in ["order_purchase_timestamp", "purchase_date", "order_delivered_customer_date", "order_estimated_delivery_date"]:
            if column in tables[table_name].columns:
                tables[table_name][column] = pd.to_datetime(tables[table_name][column], errors="coerce")
    for column in ["first_purchase_date", "last_purchase_date"]:
        if column in tables["customer_fact"].columns:
            tables["customer_fact"][column] = pd.to_datetime(tables["customer_fact"][column], errors="coerce")
    return tables

