from __future__ import annotations

from pathlib import Path

import pandas as pd


REQUIRED_FILES = {
    "orders": "olist_orders_dataset.csv",
    "order_items": "olist_order_items_dataset.csv",
    "order_payments": "olist_order_payments_dataset.csv",
    "order_reviews": "olist_order_reviews_dataset.csv",
    "customers": "olist_customers_dataset.csv",
    "products": "olist_products_dataset.csv",
    "sellers": "olist_sellers_dataset.csv",
    "category_translation": "product_category_name_translation.csv",
}


class MissingDataError(FileNotFoundError):
    """Raised when one or more required Olist files are absent."""


def missing_files(raw_dir: Path) -> list[str]:
    return [name for name in REQUIRED_FILES.values() if not (raw_dir / name).exists()]


def load_raw_tables(raw_dir: str | Path) -> dict[str, pd.DataFrame]:
    raw_path = Path(raw_dir)
    missing = missing_files(raw_path)
    if missing:
        expected = "\n".join(f"- {name}" for name in REQUIRED_FILES.values())
        absent = "\n".join(f"- {name}" for name in missing)
        raise MissingDataError(
            f"data/raw 缺少 Olist 核心 CSV。\n\n缺失文件：\n{absent}\n\n需要文件：\n{expected}"
        )

    tables: dict[str, pd.DataFrame] = {}
    for key, file_name in REQUIRED_FILES.items():
        tables[key] = pd.read_csv(raw_path / file_name)
    return tables

