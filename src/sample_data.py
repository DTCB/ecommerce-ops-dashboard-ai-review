from __future__ import annotations

import pandas as pd


def build_demo_tables() -> dict[str, pd.DataFrame]:
    orders = pd.DataFrame(
        [
            ["o1", "c1", "delivered", "2018-01-05", "2018-01-05", "2018-01-07", "2018-01-12", "2018-01-15"],
            ["o2", "c2", "delivered", "2018-01-18", "2018-01-18", "2018-01-20", "2018-01-28", "2018-01-26"],
            ["o3", "c1", "delivered", "2018-02-10", "2018-02-10", "2018-02-12", "2018-02-18", "2018-02-20"],
            ["o4", "c3", "canceled", "2018-02-15", None, None, None, "2018-02-25"],
            ["o5", "c4", "delivered", "2018-03-02", "2018-03-02", "2018-03-04", "2018-03-10", "2018-03-11"],
            ["o6", "c5", "delivered", "2018-03-18", "2018-03-18", "2018-03-20", "2018-03-25", "2018-03-29"],
        ],
        columns=[
            "order_id",
            "customer_id",
            "order_status",
            "order_purchase_timestamp",
            "order_approved_at",
            "order_delivered_carrier_date",
            "order_delivered_customer_date",
            "order_estimated_delivery_date",
        ],
    )
    customers = pd.DataFrame(
        [
            ["c1", "u1", "01000", "sao paulo", "SP"],
            ["c2", "u2", "20000", "rio de janeiro", "RJ"],
            ["c3", "u3", "30000", "belo horizonte", "MG"],
            ["c4", "u4", "40000", "salvador", "BA"],
            ["c5", "u5", "80000", "curitiba", "PR"],
        ],
        columns=["customer_id", "customer_unique_id", "customer_zip_code_prefix", "customer_city", "customer_state"],
    )
    order_items = pd.DataFrame(
        [
            ["o1", 1, "p1", "s1", "2018-01-08", 120.0, 15.0],
            ["o2", 1, "p2", "s2", "2018-01-21", 240.0, 20.0],
            ["o3", 1, "p1", "s1", "2018-02-13", 180.0, 18.0],
            ["o4", 1, "p3", "s3", "2018-02-16", 90.0, 10.0],
            ["o5", 1, "p2", "s2", "2018-03-05", 300.0, 22.0],
            ["o6", 1, "p4", "s1", "2018-03-22", 80.0, 12.0],
        ],
        columns=["order_id", "order_item_id", "product_id", "seller_id", "shipping_limit_date", "price", "freight_value"],
    )
    payments = pd.DataFrame(
        [
            ["o1", 1, "credit_card", 1, 135.0],
            ["o2", 1, "boleto", 1, 260.0],
            ["o3", 1, "credit_card", 2, 198.0],
            ["o4", 1, "voucher", 1, 100.0],
            ["o5", 1, "credit_card", 3, 322.0],
            ["o6", 1, "debit_card", 1, 92.0],
        ],
        columns=["order_id", "payment_sequential", "payment_type", "payment_installments", "payment_value"],
    )
    reviews = pd.DataFrame(
        [
            ["r1", "o1", 5],
            ["r2", "o2", 3],
            ["r3", "o3", 4],
            ["r4", "o4", 1],
            ["r5", "o5", 5],
            ["r6", "o6", 2],
        ],
        columns=["review_id", "order_id", "review_score"],
    )
    products = pd.DataFrame(
        [
            ["p1", "beleza_saude"],
            ["p2", "informatica_acessorios"],
            ["p3", "moveis_decoracao"],
            ["p4", "esporte_lazer"],
        ],
        columns=["product_id", "product_category_name"],
    )
    sellers = pd.DataFrame(
        [
            ["s1", "01000", "sao paulo", "SP"],
            ["s2", "20000", "rio de janeiro", "RJ"],
            ["s3", "30000", "belo horizonte", "MG"],
        ],
        columns=["seller_id", "seller_zip_code_prefix", "seller_city", "seller_state"],
    )
    translation = pd.DataFrame(
        [
            ["beleza_saude", "health_beauty"],
            ["informatica_acessorios", "computers_accessories"],
            ["moveis_decoracao", "furniture_decor"],
            ["esporte_lazer", "sports_leisure"],
        ],
        columns=["product_category_name", "product_category_name_english"],
    )
    return {
        "orders": orders,
        "customers": customers,
        "order_items": order_items,
        "order_payments": payments,
        "order_reviews": reviews,
        "products": products,
        "sellers": sellers,
        "category_translation": translation,
    }

