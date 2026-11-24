import math
import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.responses import FileResponse, JSONResponse

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

DEFAULT_LAT = float(os.getenv("LAT", "43.6532"))
DEFAULT_LON = float(os.getenv("LON", "-79.3832"))
DEFAULT_RADIUS_NM = float(os.getenv("RADIUS_NM", "25"))
DEFAULT_UNITS = os.getenv("UNITS", "imperial").lower()
DEFAULT_COMMERCIAL_ONLY = os.getenv("COMMERCIAL_ONLY", "false").lower() in ("1", "true", "yes")
DEFAULT_PORT = int(os.getenv("PORT", "8080"))

USER_AGENT = "FlightWall-Chromecast/1.0"
CARDINALS = [
    "N", "NNE", "NE", "ENE",
    "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW",
    "W", "WNW", "NW", "NNW",
]
COMMERCIAL_RE = re.compile(r"^[A-Z]{3}[0-9][A-Z0-9]{0,4}$")

# Simple in-memory TTL caches: key -> (expires_at, value)
_route_cache: dict[str, tuple[float, dict[str, Any] | None]] = {}
_aircraft_cache: dict[str, tuple[float, dict[str, Any] | None]] = {}
_http_client: httpx.AsyncClient | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _http_client
    _http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(6.5, connect=4.0),
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        follow_redirects=True,
    )
    try:
        yield
    finally:
        if _http_client is not None:
            await _http_client.aclose()
            _http_client = None


app = FastAPI(title="FlightWall Local Server", lifespan=lifespan)


def haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r_nm = 3440.065
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r_nm * math.asin(math.sqrt(min(1.0, a)))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def deg_to_cardinal(deg: float | None) -> str | None:
    if deg is None:
        return None
    idx = int((deg + 11.25) // 22.5) % 16
    return CARDINALS[idx]


def cache_get(store: dict[str, tuple[float, Any]], key: str) -> tuple[bool, Any]:
    item = store.get(key)
    if item is None:
        return False, None
    exp, val = item
    if time.time() > exp:
        store.pop(key, None)
        return False, None
    return True, val


def cache_set(store: dict[str, tuple[float, Any]], key: str, val: Any, ttl_sec: int) -> None:
    if len(store) > 2000:
        now = time.time()
        expired = [k for k, (e, _) in store.items() if e < now]
        for k in expired:
            store.pop(k, None)
        if len(store) > 2000:
            store.clear()
    store[key] = (time.time() + ttl_sec, val)


async def fetch_nearby_adsb(lat: float, lon: float, radius_nm: float) -> tuple[str, list[dict[str, Any]]]:
    assert _http_client is not None
    dist = max(1, min(250, int(round(radius_nm))))
    sources = [
        ("adsb.fi", f"https://opendata.adsb.fi/api/v2/lat/{lat:.5f}/lon/{lon:.5f}/dist/{dist}", "aircraft"),
        ("adsb.lol", f"https://api.adsb.lol/v2/point/{lat:.5f}/{lon:.5f}/{dist}", "ac"),
    ]
    last_err: Exception | None = None
    for name, url, field in sources:
        try:
            r = await _http_client.get(url)
            if r.status_code == 200:
                payload = r.json()
                ac_list = payload.get(field) or payload.get("aircraft") or payload.get("ac") or []
                return name, ac_list
        except Exception as e:
            last_err = e
    raise RuntimeError(f"All ADS-B feeds failed: {last_err}")


async def lookup_route(callsign: str) -> dict[str, Any] | None:
    cs = callsign.strip().upper()
    if not cs or len(cs) < 3:
        return None
    hit, val = cache_get(_route_cache, cs)
    if hit:
        return val

    assert _http_client is not None
    result: dict[str, Any] | None = None

    # Primary: ADSBdb
    try:
        r = await _http_client.get(f"https://api.adsbdb.com/v0/callsign/{cs}")
        if r.status_code == 200:
            fr = (r.json().get("response") or {}).get("flightroute")
            if isinstance(fr, dict) and fr.get("origin") and fr.get("destination"):
                al = fr.get("airline") or {}
                orig = fr.get("origin") or {}
                dest = fr.get("destination") or {}
                result = {
                    "flight_iata": fr.get("callsign_iata"),
                    "airline": {
                        "name": al.get("name"),
                        "iata": al.get("iata"),
                        "icao": al.get("icao"),
                    },
                    "origin": {
                        "iata": orig.get("iata_code") or orig.get("icao_code"),
                        "icao": orig.get("icao_code"),
                        "city": orig.get("municipality"),
                        "name": orig.get("name"),
                        "country": orig.get("country_iso_name"),
                        "lat": orig.get("latitude"),
                        "lon": orig.get("longitude"),
                    },
                    "destination": {
                        "iata": dest.get("iata_code") or dest.get("icao_code"),
                        "icao": dest.get("icao_code"),
                        "city": dest.get("municipality"),
                        "name": dest.get("name"),
                        "country": dest.get("country_iso_name"),
                        "lat": dest.get("latitude"),
                        "lon": dest.get("longitude"),
                    },
                }
    except Exception:
        pass

    # Fallback: hexdb.io
    if result is None:
        try:
            r = await _http_client.get(f"https://hexdb.io/api/v1/route/iata/{cs}")
            if r.status_code == 200:
                j = r.json()
                route_str = j.get("route") or ""
                parts = [p.strip() for p in route_str.split("-") if p.strip()]
                if len(parts) >= 2:
                    result = {
                        "flight_iata": None,
                        "airline": None,
                        "origin": {"iata": parts[0], "city": None, "name": None, "country": None, "lat": None, "lon": None},
                        "destination": {"iata": parts[-1], "city": None, "name": None, "country": None, "lat": None, "lon": None},
                    }
        except Exception:
            pass

    cache_set(_route_cache, cs, result, 6 * 3600 if result else 15 * 60)
    return result


async def lookup_aircraft(hex_code: str) -> dict[str, Any] | None:
    hx = hex_code.strip().lower()
    if not hx:
        return None
    hit, val = cache_get(_aircraft_cache, hx)
    if hit:
        return val

    assert _http_client is not None
    result: dict[str, Any] | None = None

    try:
        r = await _http_client.get(f"https://api.adsbdb.com/v0/aircraft/{hx}")
        if r.status_code == 200:
            ac = (r.json().get("response") or {}).get("aircraft")
            if isinstance(ac, dict):
                mfr = (ac.get("manufacturer") or "").strip()
                typ = (ac.get("type") or "").strip()
                model = f"{mfr} {typ}".strip() if mfr and not typ.lower().startswith(mfr.lower()) else (typ or mfr)
                result = {
                    "code": ac.get("icao_type"),
                    "model": model or None,
                    "registration": ac.get("registration"),
                    "owner": ac.get("registered_owner"),
                }
    except Exception:
        pass

    if result is None:
        try:
            r = await _http_client.get(f"https://hexdb.io/api/v1/aircraft/{hx}")
            if r.status_code == 200:
                ac = r.json()
                mfr = (ac.get("Manufacturer") or "").strip()
                typ = (ac.get("Type") or "").strip()
                model = f"{mfr} {typ}".strip() if mfr and not typ.lower().startswith(mfr.lower()) else (typ or mfr)
                result = {
                    "code": ac.get("ICAOTypeCode"),
                    "model": model or None,
                    "registration": ac.get("Registration"),
                    "owner": ac.get("RegisteredOwners"),
                }
        except Exception:
            pass

    cache_set(_aircraft_cache, hx, result, 24 * 3600 if result else 30 * 60)
    return result


def parse_altitude(ac: dict[str, Any]) -> int | None:
    alt = ac.get("alt_baro")
    if alt == "ground":
        return None
    if isinstance(alt, (int, float)):
        return int(round(alt))
    alt_g = ac.get("alt_geom")
    if isinstance(alt_g, (int, float)):
        return int(round(alt_g))
    return None


def is_airborne(ac: dict[str, Any]) -> bool:
    if ac.get("lat") is None or ac.get("lon") is None:
        return False
    seen_pos = ac.get("seen_pos")
    if isinstance(seen_pos, (int, float)) and seen_pos > 75:
        return False
    alt_baro = ac.get("alt_baro")
    if alt_baro == "ground":
        return False
    alt = parse_altitude(ac)
    gs = ac.get("gs")
    if alt is not None and alt <= 50 and isinstance(gs, (int, float)) and gs < 35:
        return False
    return True


def compute_progress(ac_lat: float, ac_lon: float, orig: dict[str, Any], dest: dict[str, Any]) -> int | None:
    o_lat, o_lon = orig.get("lat"), orig.get("lon")
    d_lat, d_lon = dest.get("lat"), dest.get("lon")
    if None in (o_lat, o_lon, d_lat, d_lon):
        return None
    d_orig = haversine_nm(o_lat, o_lon, ac_lat, ac_lon)
    d_dest = haversine_nm(ac_lat, ac_lon, d_lat, d_lon)
    total = d_orig + d_dest
    if total <= 1.0:
        return 50
    pct = int(round((d_orig / total) * 100))
    return max(2, min(98, pct))


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(
        BASE_DIR / "web" / "index.html",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "timestamp": int(time.time())}


@app.get("/api/closest")
async def closest_flight(
    lat: float = Query(DEFAULT_LAT, ge=-90.0, le=90.0),
    lon: float = Query(DEFAULT_LON, ge=-180.0, le=180.0),
    radius: float = Query(DEFAULT_RADIUS_NM, ge=1.0, le=250.0),
    commercial_only: bool = Query(DEFAULT_COMMERCIAL_ONLY),
) -> JSONResponse:
    try:
        source, raw_aircraft = await fetch_nearby_adsb(lat, lon, radius)
    except Exception as e:
        return JSONResponse(status_code=502, content={"error": str(e), "closest": None})

    candidates: list[tuple[float, float, dict[str, Any]]] = []
    for ac in raw_aircraft:
        if not is_airborne(ac):
            continue
        ac_lat = float(ac["lat"])
        ac_lon = float(ac["lon"])
        dist_nm = haversine_nm(lat, lon, ac_lat, ac_lon)
        if dist_nm > radius:
            continue
        cs = (ac.get("flight") or "").strip().upper()
        if commercial_only and not COMMERCIAL_RE.match(cs):
            continue
        brg = bearing_deg(lat, lon, ac_lat, ac_lon)
        candidates.append((dist_nm, brg, ac))

    candidates.sort(key=lambda x: x[0])

    if not candidates:
        return JSONResponse(
            content={
                "timestamp": int(time.time()),
                "query": {"lat": lat, "lon": lon, "radius_nm": radius},
                "source": source,
                "total_nearby": 0,
                "closest": None,
                "nearby": [],
            }
        )

    dist_nm, brg, top = candidates[0]
    hex_code = (top.get("hex") or "").strip().lower()
    callsign = (top.get("flight") or "").strip().upper()

    route_info = await lookup_route(callsign) if callsign else None
    ac_extra = None
    if not top.get("desc") or not top.get("t"):
        ac_extra = await lookup_aircraft(hex_code)

    alt_ft = parse_altitude(top)
    gs_kts = top.get("gs")
    track = top.get("track")
    vr = top.get("baro_rate") if top.get("baro_rate") is not None else top.get("geom_rate")

    route_payload = None
    if route_info and route_info.get("origin") and route_info.get("destination"):
        orig = route_info["origin"]
        dest = route_info["destination"]
        route_payload = {
            "origin": {k: orig.get(k) for k in ("iata", "icao", "city", "name", "country")},
            "destination": {k: dest.get(k) for k in ("iata", "icao", "city", "name", "country")},
            "progress_pct": compute_progress(float(top["lat"]), float(top["lon"]), orig, dest),
        }

    model_str = top.get("desc") or (ac_extra.get("model") if ac_extra else None)
    type_code = top.get("t") or (ac_extra.get("code") if ac_extra else None)
    reg_str = top.get("r") or (ac_extra.get("registration") if ac_extra else None)
    owner_str = top.get("ownOp") or (ac_extra.get("owner") if ac_extra else None)

    closest_obj = {
        "hex": hex_code,
        "callsign": callsign or reg_str or hex_code.upper(),
        "flight_iata": route_info.get("flight_iata") if route_info else None,
        "registration": reg_str,
        "airline": route_info.get("airline") if route_info else None,
        "aircraft": {
            "code": type_code,
            "model": model_str,
            "owner": owner_str,
            "category": top.get("category"),
        },
        "route": route_payload,
        "telemetry": {
            "distance_nm": round(dist_nm, 2),
            "distance_mi": round(dist_nm * 1.15078, 2),
            "distance_km": round(dist_nm * 1.852, 2),
            "bearing_deg": round(brg, 1),
            "bearing_cardinal": deg_to_cardinal(brg),
            "altitude_ft": alt_ft,
            "altitude_m": int(round(alt_ft * 0.3048)) if alt_ft is not None else None,
            "speed_kts": round(gs_kts, 1) if isinstance(gs_kts, (int, float)) else None,
            "speed_mph": round(gs_kts * 1.15078, 1) if isinstance(gs_kts, (int, float)) else None,
            "speed_kmh": round(gs_kts * 1.852, 1) if isinstance(gs_kts, (int, float)) else None,
            "track_deg": round(track, 1) if isinstance(track, (int, float)) else None,
            "track_cardinal": deg_to_cardinal(track) if isinstance(track, (int, float)) else None,
            "vert_rate_fpm": int(round(vr)) if isinstance(vr, (int, float)) else None,
            "squawk": top.get("squawk"),
        },
    }

    nearby_summary = []
    for d_nm, _, other in candidates[1:4]:
        o_cs = (other.get("flight") or other.get("r") or other.get("hex") or "").strip().upper()
        o_alt = parse_altitude(other)
        hit, cached_rt = cache_get(_route_cache, o_cs)
        rt_short = None
        if hit and cached_rt and cached_rt.get("origin") and cached_rt.get("destination"):
            oi = cached_rt["origin"].get("iata")
            di = cached_rt["destination"].get("iata")
            if oi and di:
                rt_short = f"{oi}-{di}"
        nearby_summary.append(
            {
                "callsign": o_cs,
                "route_short": rt_short,
                "distance_mi": round(d_nm * 1.15078, 1),
                "distance_km": round(d_nm * 1.852, 1),
                "altitude_ft": o_alt,
                "altitude_m": int(round(o_alt * 0.3048)) if o_alt is not None else None,
            }
        )

    return JSONResponse(
        content={
            "timestamp": int(time.time()),
            "query": {"lat": lat, "lon": lon, "radius_nm": radius},
            "source": source,
            "total_nearby": len(candidates),
            "closest": closest_obj,
            "nearby": nearby_summary,
        },
        headers={"Cache-Control": "no-store"},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=DEFAULT_PORT, log_level="info")
