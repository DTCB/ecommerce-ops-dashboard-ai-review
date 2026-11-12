"""Shared UTC request limits for the public Olist review."""

from __future__ import annotations

import asyncio
import hmac
import os
from datetime import datetime, timedelta, timezone
from ipaddress import ip_address
from math import ceil
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException

DAILY_LIMIT = 3
MONTHLY_LIMIT = 200
TIMEOUT = 3
UNAVAILABLE = "实时复盘暂时不可用，仍可查看案例和下钻结果。"

QUOTA_SCRIPT = """
local monthly = tonumber(redis.call('GET', KEYS[2]) or '0')
local daily = tonumber(redis.call('GET', KEYS[1]) or '0')
if monthly >= tonumber(ARGV[2]) then return 2 end
if daily >= tonumber(ARGV[1]) then return 1 end
redis.call('INCR', KEYS[1])
redis.call('EXPIREAT', KEYS[1], ARGV[3])
redis.call('INCR', KEYS[2])
redis.call('EXPIREAT', KEYS[2], ARGV[4])
return 0
"""


def configured() -> bool:
    try:
        endpoint = urlsplit(os.getenv("UPSTASH_REDIS_REST_URL", ""))
    except ValueError:
        return False
    return bool(
        endpoint.scheme == "https"
        and endpoint.hostname
        and not (endpoint.username or endpoint.password or endpoint.query or endpoint.fragment)
        and os.getenv("UPSTASH_REDIS_REST_TOKEN", "").strip()
        and os.getenv("QUOTA_HASH_SECRET", "").strip()
    )


async def reserve(client_ip: str, *, now: datetime | None = None) -> None:
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    next_month = (now.replace(day=28) + timedelta(days=4)).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0,
    )
    try:
        address = ip_address(client_ip.strip())
        if address.version == 6:
            address = address.ipv4_mapped or address
        day = now.date().isoformat()
        digest = hmac.digest(os.environ["QUOTA_HASH_SECRET"].encode(), f"{day}:{address}".encode(), "sha256").hex()
        keys = [f"ecommerce-lens:day:{day}:{digest}", f"ecommerce-lens:month:{now:%Y-%m}"]
        # Keep a short grace period for requests that cross midnight in transit.
        args = [DAILY_LIMIT, MONTHLY_LIMIT, int(tomorrow.timestamp()) + 60, int(next_month.timestamp()) + 60]
        async with asyncio.timeout(TIMEOUT):
            async with httpx.AsyncClient(follow_redirects=False, timeout=TIMEOUT) as client:
                response = await client.post(
                    os.environ["UPSTASH_REDIS_REST_URL"],
                    headers={"Authorization": f"Bearer {os.environ['UPSTASH_REDIS_REST_TOKEN']}"},
                    json=["EVAL", QUOTA_SCRIPT, len(keys), *keys, *args],
                )
                response.raise_for_status()
                body = response.json()
        result = body.get("result") if isinstance(body, dict) and not body.get("error") else None
        if type(result) is not int or result not in (0, 1, 2):
            raise ValueError("invalid quota result")
    except (KeyError, ValueError, TimeoutError, httpx.HTTPError):
        raise HTTPException(status_code=503, detail=UNAVAILABLE) from None

    if result:
        reset = tomorrow if result == 1 else next_month
        reset_local = reset.astimezone(timezone(timedelta(hours=8)))
        limit = "今天的实时复盘次数已用完" if result == 1 else "本月的全站实时复盘额度已用完"
        raise HTTPException(
            status_code=429,
            detail=f"{limit}，北京时间 {reset_local:%m 月 %d 日 %H:%M} 恢复。案例下钻仍可使用。",
            headers={"Retry-After": str(max(1, ceil((reset - now).total_seconds())))},
        )
