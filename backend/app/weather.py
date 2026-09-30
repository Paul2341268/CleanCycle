import asyncio
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from time import monotonic
from urllib.parse import unquote

import httpx
from dotenv import dotenv_values

KST = timezone(timedelta(hours=9))
REGIONS = {
    "busan": {"name": "부산 · 시청 기준", "nx": 98, "ny": 76},
    "seoul": {"name": "서울 · 시청 기준", "nx": 60, "ny": 127},
    "incheon": {"name": "인천 · 시청 기준", "nx": 55, "ny": 124},
    "daejeon": {"name": "대전 · 시청 기준", "nx": 67, "ny": 100},
    "daegu": {"name": "대구 · 도심 기준", "nx": 89, "ny": 90},
    "gwangju": {"name": "광주 · 시청 기준", "nx": 58, "ny": 74},
    "jeju": {"name": "제주 · 시청 기준", "nx": 52, "ny": 38},
}
ENV = Path(os.environ.get("CLEANCYCLE_ENV_FILE", Path(__file__).resolve().parents[1] / ".env"))
cache = {}
lock = asyncio.Lock()


def base_time(now):
    available = now - timedelta(minutes=15)
    candidates = [available.replace(hour=h, minute=0, second=0, microsecond=0)
                  for h in (2, 5, 8, 11, 14, 17, 20, 23)]
    return max(t for t in candidates if t <= available) if any(t <= available for t in candidates) else (
        available - timedelta(days=1)).replace(hour=23, minute=0, second=0, microsecond=0)


def parse_forecast(items, now):
    slots = {}
    for item in items:
        stamp = item["fcstDate"] + item["fcstTime"]
        slots.setdefault(stamp, {})[item["category"]] = item["fcstValue"]
    future = sorted(s for s, values in slots.items()
                    if s >= now.strftime("%Y%m%d%H%M") and {"TMP", "REH", "POP", "PTY"} <= values.keys())
    if not future:
        raise ValueError("No complete future forecast")
    stamp = future[0]
    values = slots[stamp]
    result = {"temperature": float(values["TMP"]), "humidity": float(values["REH"]),
              "rain_probability": float(values["POP"]), "precipitation": int(values["PTY"]),
              "forecast_at": datetime.strptime(stamp, "%Y%m%d%H%M").replace(tzinfo=KST).isoformat()}
    if not (0 <= result["humidity"] <= 100 and 0 <= result["rain_probability"] <= 100):
        raise ValueError("Invalid forecast range")
    return result


async def get_weather(region):
    key = (os.environ.get("KMA_SERVICE_KEY") or dotenv_values(ENV, encoding="utf-8-sig").get("KMA_SERVICE_KEY") or "").strip()
    if not key:
        return {"status": "unconfigured", "message": "날씨 연결 대기 중", "region": region}
    async with lock:
        cached = cache.get(region)
        if cached and cached[0] == key and monotonic() - cached[1] < 600:
            return cached[2]
        now = datetime.now(KST)
        base = base_time(now)
        params = {"serviceKey": unquote(key), "pageNo": 1, "numOfRows": 1000, "dataType": "JSON",
                  "base_date": base.strftime("%Y%m%d"), "base_time": base.strftime("%H%M"),
                  "nx": REGIONS[region]["nx"], "ny": REGIONS[region]["ny"]}
        try:
            async with httpx.AsyncClient(timeout=12) as client:
                response = await client.get(
                    "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst", params=params)
                response.raise_for_status()
                payload = response.json()["response"]
                if str(payload["header"]["resultCode"]) != "00":
                    raise ValueError("Upstream rejected request")
                result = {"status": "ok", "region": region, "issued_at": base.isoformat(),
                          **parse_forecast(payload["body"]["items"]["item"], now)}
            cache[region] = (key, monotonic(), result)
            return result
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            return {"status": "error", "region": region,
                    "message": "날씨를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."}
