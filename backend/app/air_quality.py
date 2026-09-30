import asyncio
import os
from datetime import datetime, timedelta
from time import monotonic
from urllib.parse import unquote

import httpx
from dotenv import dotenv_values

from .weather import ENV, KST

CITIES = {
    "busan": ("부산", "연산동"), "seoul": ("서울", "중구"),
    "incheon": ("인천", "구월동"), "daejeon": ("대전", "둔산동"),
    "daegu": ("대구", "수창동"), "gwangju": ("광주", "치평동"),
    "jeju": ("제주", "이도동"),
}
cache = {}
lock = asyncio.Lock()


def concentration(item, field):
    try:
        value = int(item.get(field + "Value"))
        return value if value >= 0 and not item.get(field + "Flag") else None
    except (ValueError, TypeError):
        return None


def parse_air(items, preferred, now):
    candidates = []
    for item in items:
        try:
            stamp = datetime.strptime(item["dataTime"], "%Y-%m-%d %H:%M").replace(tzinfo=KST)
            if not item.get("stationName") or stamp > now + timedelta(minutes=5):
                continue
            candidates.append((item, stamp))
        except (ValueError, KeyError, TypeError):
            continue
    if not candidates:
        raise ValueError("No station data")
    # Prefer the configured station; show its missing/stale readings honestly.
    item, stamp = min(candidates, key=lambda pair: (pair[0]["stationName"] != preferred,
                                                  -pair[1].timestamp(), pair[0]["stationName"]))
    result = {"station": item["stationName"], "measured_at": stamp.isoformat(),
              "status": "stale" if now - stamp > timedelta(hours=3) else "ok"}
    for field in ("pm10", "pm25"):
        result[field] = concentration(item, field)
        grade = str(item.get(field + "Grade1h", ""))
        result[field + "_grade"] = int(grade) if grade in ("1", "2", "3", "4") and result[field] is not None else None
    return result


async def get_air_quality(region):
    key = (os.environ.get("AIRKOREA_SERVICE_KEY") or dotenv_values(ENV, encoding="utf-8-sig").get("AIRKOREA_SERVICE_KEY") or "").strip()
    if not key:
        return {"status": "unconfigured", "region": region, "message": "대기질 연결 대기 중"}
    async with lock:
        cached = cache.get(region)
        if cached and cached[0] == key and monotonic() - cached[1] < 1800:
            return cached[2]
        city, station = CITIES[region]
        try:
            async with httpx.AsyncClient(timeout=12) as client:
                response = await client.get(
                    "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty",
                    params={"serviceKey": unquote(key), "returnType": "json", "numOfRows": 1000,
                            "pageNo": 1, "sidoName": city, "ver": "1.3"})
                response.raise_for_status()
                payload = response.json()["response"]
                if str(payload["header"]["resultCode"]) != "00":
                    raise ValueError("Upstream rejected request")
                result = {"region": region, **parse_air(payload["body"]["items"], station, datetime.now(KST))}
            cache[region] = (key, monotonic(), result)
            return result
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            return {"status": "error", "region": region,
                    "message": "대기질을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."}
