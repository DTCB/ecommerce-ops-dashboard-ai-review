from __future__ import annotations

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from src.config import DATA_RAW_DIR, DB_PATH
from src.data_loader import load_raw_tables
from src.database import write_model_tables
from src.metrics import build_customer_fact, build_item_fact, build_order_fact


def main() -> None:
    raw_tables = load_raw_tables(DATA_RAW_DIR)
    order_fact = build_order_fact(raw_tables)
    item_fact = build_item_fact(raw_tables)
    customer_fact = build_customer_fact(order_fact)
    write_model_tables(DB_PATH, {"order_fact": order_fact, "item_fact": item_fact, "customer_fact": customer_fact})
    print(f"SQLite database written to {DB_PATH}")


if __name__ == "__main__":
    main()
