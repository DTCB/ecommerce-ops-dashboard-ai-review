import json
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from api import index

REVIEW_CASE = {"month": "2018-06", "basis": "total"}
VERCEL_IP = {"x-vercel-forwarded-for": "203.0.113.5"}


@pytest.fixture()
def client():
    return TestClient(index.app)


@pytest.fixture()
def upstream(monkeypatch):
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.setattr(index, "settings", lambda: {
        "LLM_API_KEY": "test-key",
        "LLM_BASE_URL": "https://example.test/compatible-mode/v1",
        "LLM_MODEL": "test-model",
    })
    async_client = httpx.AsyncClient

    def install(handler):
        monkeypatch.setattr(
            index.httpx, "AsyncClient",
            lambda **kwargs: async_client(transport=httpx.MockTransport(handler), **kwargs),
        )

    return install


def test_demo_values_and_bridge():
    cases = index.DATA["cases"]
    assert cases["2018-06"]["total"]["metrics"]["gmv"]["rate"] == pytest.approx(-0.1035, abs=0.00005)
    assert cases["2018-06"]["daily"]["metrics"]["gmv"]["rate"] == pytest.approx(-0.0736, abs=0.00005)
    assert cases["2018-04"]["total"]["metrics"]["orders"]["rate"] == pytest.approx(-0.0293, abs=0.00005)
    assert cases["2018-04"]["total"]["metrics"]["gmv"]["rate"] == pytest.approx(0.011, abs=0.00005)
    for case in cases.values():
        for basis in ("total", "daily"):
            view = case[basis]
            gmv = view["metrics"]["gmv"]
            assert view["order_effect"] + view["aov_effect"] == pytest.approx(gmv["current"] - gmv["previous"])


def test_unconfigured_and_invalid_month(client, monkeypatch):
    monkeypatch.setattr(index, "settings", lambda: {"LLM_API_KEY": "", "LLM_BASE_URL": "", "LLM_MODEL": "test"})
    assert client.get("/api/status").json() == {"available": False}
    assert client.post("/api/review", json={"month": "2018-08", "basis": "total"}).status_code == 422
    assert client.post("/api/review", json={"month": "2018-06", "basis": "total"}).status_code == 503


def completion(*references, slots=("D01", "D02")):
    statement = [{"text": "查看订单量变化。", "evidence": list(references)}]
    content = json.dumps({
        "observations": statement,
        "diagnostics": {slot: {"driver": "order_volume", "text": "比较品类订单量。"} for slot in slots},
    })
    return httpx.Response(200, json={
        "model": "upstream-model",
        "choices": [{"finish_reason": "stop", "message": {"content": content}}],
    })


def test_live_request_uses_selected_evidence(client, upstream):
    def respond(request):
        body = json.loads(request.content)
        assert body["enable_thinking"] is False
        context = json.loads(body["messages"][-1]["content"])
        assert context["month"] == "2018-04"
        assert context["basis"] == "daily"
        assert context["evidence"]["E01"]["metric"] == "gmv"
        assert context["evidence"]["E01"]["rate"] == pytest.approx(0.0447, abs=0.00005)
        assert list(context["targets"]) == ["D01", "D02"]
        return completion("E01", "E01", "E02", "E03", "E04")

    upstream(respond)
    response = client.post("/api/review", json={"month": "2018-04", "basis": "daily"})
    assert response.status_code == 200
    assert response.json()["model"] == "upstream-model"
    assert response.json()["basis"] == "daily"
    assert response.json()["observations"][0]["evidence"] == ["gmv", "orders", "aov"]
    view = index.DATA["cases"]["2018-04"]["daily"]
    assert [card["category"] for card in response.json()["diagnostics"]] == [
        row["category"] for row in view["gainers"][:2]
    ]


def test_unknown_evidence_fails(client, upstream):
    upstream(lambda request: completion("traffic"))
    assert client.post("/api/review", json={"month": "2018-06", "basis": "total"}).status_code == 502


def test_timeout_fails(client, upstream):
    def timeout(request):
        raise httpx.ReadTimeout("test timeout", request=request)

    upstream(timeout)
    assert client.post("/api/review", json={"month": "2018-06", "basis": "total"}).status_code == 504


def test_connection_failure_logs_only_error_type(client, upstream, caplog):
    def fail(request):
        raise httpx.LocalProtocolError("request included test-key", request=request)

    upstream(fail)
    response = client.post("/api/review", json=REVIEW_CASE)
    assert response.status_code == 502
    assert "AI upstream request failed: LocalProtocolError" in caplog.text
    assert "test-key" not in caplog.text
    assert "test-key" not in response.text


def test_missing_diagnosis_slot_fails(client, upstream):
    upstream(lambda request: completion("E01", slots=("D01",)))
    assert client.post("/api/review", json={"month": "2018-06", "basis": "total"}).status_code == 502


@pytest.mark.parametrize(("category", "before", "after", "order_share"), [
    ("watches_gifts", 585, 444, 0.9047),
    ("garden_tools", 227, 148, 0.7514),
])
def test_june_volume_check(client, monkeypatch, category, before, after, order_share):
    def unexpected_settings():
        pytest.fail("The check should not read model configuration")

    monkeypatch.setattr(index, "settings", unexpected_settings)
    result = client.post("/api/review/check", json={
        "month": "2018-06", "basis": "total", "category": category, "operation": "volume_aov",
    }).json()
    assert result["before"]["orders"] == before
    assert result["after"]["orders"] == after
    assert result["driver"] == "order_volume"
    assert result["order_share"] == pytest.approx(order_share, abs=0.0001)
    assert result["order_effect"] + result["aov_effect"] == pytest.approx(result["after"]["gmv"] - result["before"]["gmv"])


def test_daily_state_check_uses_each_month_days(client):
    for basis, before_days, after_days in [("total", 1, 1), ("daily", 31, 30)]:
        result = client.post("/api/review/check", json={
            "month": "2018-06", "basis": basis, "category": "watches_gifts", "operation": "state_orders",
        }).json()
        assert result["direction"] == -1
        assert len(result["rows"]) == 5
        assert result["rows"][0]["state"] == "SP"
        assert result["rows"][0]["previous_orders"] == pytest.approx(231 / before_days)
        assert result["rows"][0]["current_orders"] == pytest.approx(167 / after_days)


def test_april_empty_baseline_and_check_validation(client):
    request = {"month": "2018-04", "basis": "total", "category": "computers", "operation": "volume_aov"}
    response = client.post("/api/review/check", json=request)
    assert response.status_code == 200
    assert response.json()["status"] == "insufficient"
    assert response.json()["before"] == {"orders": 0, "gmv": 0, "aov": None}
    assert response.json()["after"]["gmv"] == pytest.approx(14571.61)
    for invalid in [{"month": "2018-08"}, {"basis": "weekly"}, {"category": "not_on_board"}, {"operation": "sql"}]:
        assert client.post("/api/review/check", json={**request, **invalid}).status_code == 422


@pytest.mark.parametrize("category", ["sports_leisure", "health_beauty"])
def test_other_ranked_categories_are_available_without_ai(client, monkeypatch, category):
    monkeypatch.setenv("VERCEL", "1")
    assert client.get("/api/status").json() == {"available": False}
    response = client.post("/api/review/check", json={
        "month": "2018-06", "basis": "total", "category": category, "operation": "volume_aov",
    })
    assert response.status_code == 200
    assert response.json()["category"] == category
    assert response.json()["before"]["orders"] > 0


def test_product_changes_for_category_and_buyer_state(client):
    request = {
        "month": "2018-06", "basis": "total", "category": "watches_gifts", "operation": "product_changes",
    }
    state = client.post("/api/review/check", json={**request, "state": "SP"})
    assert state.status_code == 200
    report = state.json()
    assert report["state"] == "SP"
    assert report["gmv_delta"] == pytest.approx(-20833.21)
    assert len(report["rows"]) == 170
    largest_drop = min(report["rows"], key=lambda row: row["gmv_delta"])
    assert largest_drop["gmv_delta"] == pytest.approx(-3178.91)
    assert (largest_drop["previous_orders"], largest_drop["current_orders"]) == (33, 3)
    total = client.post("/api/review/check", json=request).json()
    assert total["gmv_delta"] == pytest.approx(-34096.31)
    assert len(total["rows"]) > len(report["rows"])
    daily = client.post("/api/review/check", json={**request, "basis": "daily", "state": "SP"}).json()
    product = next(row for row in daily["rows"] if row["product"] == largest_drop["product"])
    assert product["previous_orders"] == pytest.approx(33 / 31)
    assert product["current_orders"] == pytest.approx(3 / 30)
    assert client.post("/api/review/check", json={**request, "state": "invalid"}).status_code == 422
    assert client.post("/api/review/check", json={**request, "operation": "volume_aov", "state": "SP"}).status_code == 422


@pytest.fixture()
def production(monkeypatch, upstream):
    for name, value in {
        "VERCEL": "1",
        "VERCEL_ENV": "production",
        "AI_BUDGET_CONFIRMED": "1",
        "LLM_MODEL": "test-model",
        "UPSTASH_REDIS_REST_URL": "https://redis.example.test",
        "UPSTASH_REDIS_REST_TOKEN": "test-redis-token",
        "QUOTA_HASH_SECRET": "test-hash-secret",
    }.items():
        monkeypatch.setenv(name, value)
    return upstream


@pytest.mark.parametrize(("name", "value"), [
    ("VERCEL_ENV", "preview"),
    ("VERCEL_ENV", ""),
    ("AI_BUDGET_CONFIRMED", "0"),
    ("UPSTASH_REDIS_REST_TOKEN", ""),
    ("LLM_MODEL", ""),
])
def test_hosted_review_requires_production_configuration(client, production, monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    production(lambda request: pytest.fail("Closed review must not call Redis or the model"))
    response = client.get("/api/status")
    assert response.json() == {"available": False}
    assert response.headers["cache-control"] == "no-store"
    assert client.post("/api/review", json=REVIEW_CASE, headers=VERCEL_IP).status_code == 503
    assert client.post("/api/review/check", json={
        **REVIEW_CASE, "operation": "state_orders", "category": "watches_gifts",
    }).status_code == 200


@pytest.mark.parametrize(("redis_reply", "expected", "message"), [
    (httpx.Response(200, json={"result": 1}), 429, "今天的实时复盘次数已用完"),
    (httpx.Response(200, json={"result": 2}), 429, "本月的全站实时复盘额度已用完"),
    (httpx.Response(500), 503, "实时复盘暂时不可用"),
    (httpx.Response(200, json={"result": False}), 503, "实时复盘暂时不可用"),
])
def test_rejected_quota_never_calls_model(client, production, redis_reply, expected, message):
    def respond(request):
        assert request.url.host == "redis.example.test"
        return redis_reply

    production(respond)
    assert client.get("/api/status").json() == {"available": True}
    result = client.post("/api/review", json=REVIEW_CASE, headers=VERCEL_IP)
    assert result.status_code == expected
    assert message in result.json()["detail"]
    if expected == 429:
        assert "08:00" in result.json()["detail"]
        assert int(result.headers["retry-after"]) >= 1


def test_validate_case_and_trusted_ip_before_reserving(client, production):
    production(lambda request: pytest.fail("Invalid review must not contact Redis or the model"))
    assert client.post("/api/review", json={**REVIEW_CASE, "month": "2018-08"}, headers=VERCEL_IP).status_code == 422
    assert client.post("/api/review", json=REVIEW_CASE, headers={"x-forwarded-for": "203.0.113.5"}).status_code == 503


def test_concurrent_reviews_use_one_redis_reservation_per_request(client, production):
    from threading import Lock

    lock = Lock()
    reservations = 0
    model_calls = 0

    def respond(request):
        nonlocal reservations, model_calls
        with lock:
            if request.url.host == "redis.example.test":
                command, script, key_count, daily_key, month_key, daily, monthly, *_ = json.loads(request.content)
                assert (command, script, key_count) == ("EVAL", index.quota.QUOTA_SCRIPT, 2)
                assert (daily, monthly) == (3, 200)
                assert daily_key.startswith("ecommerce-lens:day:")
                assert VERCEL_IP["x-vercel-forwarded-for"] not in daily_key
                assert month_key.startswith("ecommerce-lens:month:")
                reservations += 1
                return httpx.Response(200, json={"result": 0 if reservations <= daily else 1})
            model_calls += 1
            return completion("E01")

    production(respond)
    with ThreadPoolExecutor(max_workers=6) as pool:
        statuses = list(pool.map(
            lambda _: client.post("/api/review", json=REVIEW_CASE, headers=VERCEL_IP).status_code,
            range(6),
        ))
    assert sorted(statuses) == [200, 200, 200, 429, 429, 429]
    assert (reservations, model_calls) == (6, 3)


def test_quota_uses_utc_boundaries_and_normalizes_ipv6(production):
    commands = []
    production(lambda request: (commands.append(json.loads(request.content)), httpx.Response(200, json={"result": 0}))[1])
    now = datetime(2026, 12, 31, 23, 59, 30, tzinfo=timezone.utc)
    asyncio.run(index.quota.reserve("2001:0db8::1", now=now))
    asyncio.run(index.quota.reserve("2001:db8::1", now=now))
    assert commands[0] == commands[1]
    assert commands[0][4] == "ecommerce-lens:month:2026-12"
    assert commands[0][-2:] == [int(now.timestamp()) + 90] * 2
