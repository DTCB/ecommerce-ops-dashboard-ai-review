from __future__ import annotations

from calendar import monthrange


def pick_categories(view: dict) -> list[dict]:
    change = view["metrics"]["gmv"]["rate"]
    if change == 0:
        return []
    return view["decliners" if change < 0 else "gainers"][:2]


def compare_period(row: dict, days: int) -> dict:
    orders = row.get("orders", 0)
    gmv = row.get("gmv", 0)
    return {
        "orders": orders / days,
        "gmv": gmv / days,
        "aov": gmv / orders if orders else None,
    }


def volume_aov(before: dict, after: dict) -> dict:
    result = {"before": before, "after": after, "status": "insufficient"}
    if before["aov"] is None or after["aov"] is None:
        return result

    order_effect = (after["orders"] - before["orders"]) * before["aov"]
    aov_effect = after["orders"] * (after["aov"] - before["aov"])
    delta = after["gmv"] - before["gmv"]
    effects = {"order_volume": order_effect, "aov": aov_effect}
    driver = max(effects, key=lambda key: abs(effects[key]))
    decisive = (
        abs(delta) >= 0.005
        and abs(abs(order_effect) - abs(aov_effect)) >= 0.005
        and effects[driver] * delta > 0
    )
    return {
        **result,
        "status": "determined" if decisive else "mixed",
        "driver": driver if decisive else None,
        "order_effect": order_effect,
        "aov_effect": aov_effect,
        "order_share": order_effect / delta if abs(delta) >= 0.005 else None,
    }


def state_orders(before: dict, after: dict, previous_days: int, current_days: int) -> dict:
    delta = after.get("orders", 0) / current_days - before.get("orders", 0) / previous_days
    direction = 0 if abs(delta) < 1e-9 else (1 if delta > 0 else -1)
    previous_states = before.get("states", {})
    current_states = after.get("states", {})
    rows = []
    for state in previous_states.keys() | current_states.keys():
        prior = compare_period(previous_states.get(state, {}), previous_days)
        current = compare_period(current_states.get(state, {}), current_days)
        order_delta = current["orders"] - prior["orders"]
        if abs(order_delta) < 1e-9 or order_delta * direction < 0:
            continue
        rows.append({
            "state": state,
            "previous_orders": prior["orders"],
            "current_orders": current["orders"],
            "order_delta": order_delta,
            "gmv_delta": current["gmv"] - prior["gmv"],
        })
    rows.sort(key=lambda row: (-abs(row["order_delta"]), row["state"]))
    return {"direction": direction, "rows": rows[:5]}


def product_changes(before: dict, after: dict, previous_days: int, current_days: int, state: str | None) -> dict:
    def totals(period: dict, days: int) -> dict:
        scopes = [period.get(state, {})] if state is not None else period.values()
        aggregate: dict = {}
        # Each order has one buyer state, so state-level distinct counts are additive per product.
        for products in scopes:
            for product, (gmv, orders) in products.items():
                total = aggregate.setdefault(product, [0, 0])
                total[0] += gmv / days
                total[1] += orders / days
        return aggregate

    prior = totals(before, previous_days)
    current = totals(after, current_days)
    rows = []
    for product in sorted(prior.keys() | current.keys()):
        previous_gmv, previous_orders = prior.get(product, (0, 0))
        current_gmv, current_orders = current.get(product, (0, 0))
        rows.append({
            "product": product,
            "previous_gmv": previous_gmv,
            "current_gmv": current_gmv,
            "previous_orders": previous_orders,
            "current_orders": current_orders,
            "gmv_delta": current_gmv - previous_gmv,
        })
    return {"rows": rows, "gmv_delta": sum(row["gmv_delta"] for row in rows)}


def run_check(data: dict, month: str, previous: str, basis: str, category: str, operation: str,
              state: str | None = None) -> dict:
    before = data[previous].get(category, {})
    after = data[month].get(category, {})
    previous_days = monthrange(*map(int, previous.split("-")))[1] if basis == "daily" else 1
    current_days = monthrange(*map(int, month.split("-")))[1] if basis == "daily" else 1
    if operation == "volume_aov":
        return volume_aov(compare_period(before, previous_days), compare_period(after, current_days))
    if operation == "product_changes":
        return product_changes(before, after, previous_days, current_days, state)
    return state_orders(before, after, previous_days, current_days)
