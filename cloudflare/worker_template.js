/**
 * FlightWall Standalone Cloudflare Worker
 * Serves BOTH the FlightWall LED UI (/) and the live flight proxy (/api/closest)
 * on Cloudflare's free tier (100,000 req/day) so your Chromecast Ultra runs 24/7
 * completely independently after your PC is turned off!
 *
 * Generated via: python cloudflare/build_worker.py
 */

const INDEX_HTML = __INDEX_HTML__;

const USER_AGENT = "FlightWall-Chromecast/1.0";
const CARDINALS = [
  "N", "NNE", "NE", "ENE",
  "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW",
  "W", "WNW", "NW", "NNW",
];
const COMMERCIAL_RE = /^[A-Z]{3}[0-9][A-Z0-9]{0,4}$/;

// Per-isolate in-memory TTL cache (also paired with Cloudflare Cache API where appropriate)
const routeCache = new Map();
const aircraftCache = new Map();

function cacheGet(map, key) {
  const entry = map.get(key);
  if (!entry) return { hit: false, value: null };
  if (Date.now() > entry.exp) {
    map.delete(key);
    return { hit: false, value: null };
  }
  return { hit: true, value: entry.value };
}

function cacheSet(map, key, value, ttlSec) {
  if (map.size > 1000) map.clear();
  map.set(key, { exp: Date.now() + ttlSec * 1000, value });
}

function toRad(d) {
  return (d * Math.PI) / 180;
}

function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, a)));
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dl = toRad(lon2 - lon1);
  const x = Math.sin(dl) * Math.cos(p2);
  const y = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

function degToCardinal(deg) {
  if (deg == null || Number.isNaN(deg)) return null;
  return CARDINALS[Math.floor((deg + 11.25) / 22.5) % 16];
}

function parseAltitude(ac) {
  if (ac.alt_baro === "ground") return null;
  if (typeof ac.alt_baro === "number") return Math.round(ac.alt_baro);
  if (typeof ac.alt_geom === "number") return Math.round(ac.alt_geom);
  return null;
}

function isAirborne(ac) {
  if (ac.lat == null || ac.lon == null) return false;
  if (typeof ac.seen_pos === "number" && ac.seen_pos > 75) return false;
  if (ac.alt_baro === "ground") return false;
  const alt = parseAltitude(ac);
  if (alt != null && alt <= 50 && typeof ac.gs === "number" && ac.gs < 35) return false;
  return true;
}

function computeProgress(acLat, acLon, orig, dest) {
  if (orig.lat == null || orig.lon == null || dest.lat == null || dest.lon == null) return null;
  const dOrig = haversineNm(orig.lat, orig.lon, acLat, acLon);
  const dDest = haversineNm(acLat, acLon, dest.lat, dest.lon);
  const total = dOrig + dDest;
  if (total <= 1) return 50;
  return Math.max(2, Math.min(98, Math.round((dOrig / total) * 100)));
}

async function fetchJson(url, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNearbyAdsb(lat, lon, radiusNm) {
  const dist = Math.max(1, Math.min(250, Math.round(radiusNm)));
  const feeds = [
    ["adsb.fi", `https://opendata.adsb.fi/api/v2/lat/${lat.toFixed(5)}/lon/${lon.toFixed(5)}/dist/${dist}`, "aircraft"],
    ["adsb.lol", `https://api.adsb.lol/v2/point/${lat.toFixed(5)}/${lon.toFixed(5)}/${dist}`, "ac"],
  ];
  for (const [name, url, field] of feeds) {
    const data = await fetchJson(url, 6500);
    if (data) {
      return { source: name, list: data[field] || data.aircraft || data.ac || [] };
    }
  }
  throw new Error("All ADS-B feeds failed");
}

async function lookupRoute(callsign) {
  const cs = (callsign || "").trim().toUpperCase();
  if (cs.length < 3) return null;
  const cached = cacheGet(routeCache, cs);
  if (cached.hit) return cached.value;

  let result = null;
  const adsbdb = await fetchJson(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`, 5000);
  const fr = adsbdb && adsbdb.response && adsbdb.response.flightroute;
  if (fr && fr.origin && fr.destination) {
    const al = fr.airline || {};
    const o = fr.origin;
    const d = fr.destination;
    result = {
      flight_iata: fr.callsign_iata || null,
      airline: { name: al.name || null, iata: al.iata || null, icao: al.icao || null },
      origin: {
        iata: o.iata_code || o.icao_code || null,
        icao: o.icao_code || null,
        city: o.municipality || null,
        name: o.name || null,
        country: o.country_iso_name || null,
        lat: o.latitude ?? null,
        lon: o.longitude ?? null,
      },
      destination: {
        iata: d.iata_code || d.icao_code || null,
        icao: d.icao_code || null,
        city: d.municipality || null,
        name: d.name || null,
        country: d.country_iso_name || null,
        lat: d.latitude ?? null,
        lon: d.longitude ?? null,
      },
    };
  } else {
    const hexdb = await fetchJson(`https://hexdb.io/api/v1/route/iata/${encodeURIComponent(cs)}`, 4500);
    if (hexdb && typeof hexdb.route === "string") {
      const parts = hexdb.route.split("-").map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        result = {
          flight_iata: null,
          airline: null,
          origin: { iata: parts[0], city: null, name: null, country: null, lat: null, lon: null },
          destination: { iata: parts[parts.length - 1], city: null, name: null, country: null, lat: null, lon: null },
        };
      }
    }
  }

  cacheSet(routeCache, cs, result, result ? 6 * 3600 : 15 * 60);
  return result;
}

async function lookupAircraft(hexCode) {
  const hx = (hexCode || "").trim().toLowerCase();
  if (!hx) return null;
  const cached = cacheGet(aircraftCache, hx);
  if (cached.hit) return cached.value;

  let result = null;
  const adsbdb = await fetchJson(`https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(hx)}`, 4500);
  const ac = adsbdb && adsbdb.response && adsbdb.response.aircraft;
  if (ac) {
    const mfr = (ac.manufacturer || "").trim();
    const typ = (ac.type || "").trim();
    const model = mfr && !typ.toLowerCase().startsWith(mfr.toLowerCase()) ? `${mfr} ${typ}`.trim() : (typ || mfr || null);
    result = {
      code: ac.icao_type || null,
      model,
      registration: ac.registration || null,
      owner: ac.registered_owner || null,
    };
  } else {
    const hexdb = await fetchJson(`https://hexdb.io/api/v1/aircraft/${encodeURIComponent(hx)}`, 4500);
    if (hexdb) {
      const mfr = (hexdb.Manufacturer || "").trim();
      const typ = (hexdb.Type || "").trim();
      const model = mfr && !typ.toLowerCase().startsWith(mfr.toLowerCase()) ? `${mfr} ${typ}`.trim() : (typ || mfr || null);
      result = {
        code: hexdb.ICAOTypeCode || null,
        model,
        registration: hexdb.Registration || null,
        owner: hexdb.RegisteredOwners || null,
      };
    }
  }

  cacheSet(aircraftCache, hx, result, result ? 24 * 3600 : 30 * 60);
  return result;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(INDEX_HTML, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, timestamp: Math.floor(Date.now() / 1000) });
    }

    if (url.pathname === "/api/closest") {
      const lat = parseFloat(url.searchParams.get("lat") || env.DEFAULT_LAT || "43.6532");
      const lon = parseFloat(url.searchParams.get("lon") || env.DEFAULT_LON || "-79.3832");
      const radius = Math.max(1, Math.min(250, parseFloat(url.searchParams.get("radius") || env.DEFAULT_RADIUS_NM || "25")));
      const commercialParam = (url.searchParams.get("commercial_only") || url.searchParams.get("commercial") || env.DEFAULT_COMMERCIAL_ONLY || "false").toLowerCase();
      const commercialOnly = commercialParam === "1" || commercialParam === "true" || commercialParam === "yes";

      if (Number.isNaN(lat) || Number.isNaN(lon)) {
        return Response.json({ error: "Invalid lat/lon" }, { status: 400 });
      }

      let feed;
      try {
        feed = await fetchNearbyAdsb(lat, lon, radius);
      } catch (err) {
        return Response.json({ error: String(err), closest: null }, { status: 502 });
      }

      const candidates = [];
      for (const ac of feed.list) {
        if (!isAirborne(ac)) continue;
        const distNm = haversineNm(lat, lon, ac.lat, ac.lon);
        if (distNm > radius) continue;
        const cs = (ac.flight || "").trim().toUpperCase();
        if (commercialOnly && !COMMERCIAL_RE.test(cs)) continue;
        candidates.push({ distNm, brg: bearingDeg(lat, lon, ac.lat, ac.lon), ac });
      }
      candidates.sort((a, b) => a.distNm - b.distNm);

      if (candidates.length === 0) {
        return Response.json(
          {
            timestamp: Math.floor(Date.now() / 1000),
            query: { lat, lon, radius_nm: radius },
            source: feed.source,
            total_nearby: 0,
            closest: null,
            nearby: [],
          },
          { headers: { "Cache-Control": "no-store" } }
        );
      }

      const { distNm, brg, ac: top } = candidates[0];
      const hexCode = (top.hex || "").trim().toLowerCase();
      const callsign = (top.flight || "").trim().toUpperCase();

      const [routeInfo, acExtra] = await Promise.all([
        callsign ? lookupRoute(callsign) : Promise.resolve(null),
        !top.desc || !top.t ? lookupAircraft(hexCode) : Promise.resolve(null),
      ]);

      const altFt = parseAltitude(top);
      const gsKts = typeof top.gs === "number" ? top.gs : null;
      const track = typeof top.track === "number" ? top.track : null;
      const vr = typeof top.baro_rate === "number" ? top.baro_rate : (typeof top.geom_rate === "number" ? top.geom_rate : null);

      let routePayload = null;
      if (routeInfo && routeInfo.origin && routeInfo.destination) {
        routePayload = {
          origin: {
            iata: routeInfo.origin.iata,
            icao: routeInfo.origin.icao,
            city: routeInfo.origin.city,
            name: routeInfo.origin.name,
            country: routeInfo.origin.country,
          },
          destination: {
            iata: routeInfo.destination.iata,
            icao: routeInfo.destination.icao,
            city: routeInfo.destination.city,
            name: routeInfo.destination.name,
            country: routeInfo.destination.country,
          },
          progress_pct: computeProgress(top.lat, top.lon, routeInfo.origin, routeInfo.destination),
        };
      }

      const closest = {
        hex: hexCode,
        callsign: callsign || top.r || hexCode.toUpperCase(),
        flight_iata: routeInfo ? routeInfo.flight_iata : null,
        registration: top.r || (acExtra ? acExtra.registration : null),
        airline: routeInfo ? routeInfo.airline : null,
        aircraft: {
          code: top.t || (acExtra ? acExtra.code : null),
          model: top.desc || (acExtra ? acExtra.model : null),
          owner: top.ownOp || (acExtra ? acExtra.owner : null),
          category: top.category || null,
        },
        route: routePayload,
        telemetry: {
          distance_nm: Number(distNm.toFixed(2)),
          distance_mi: Number((distNm * 1.15078).toFixed(2)),
          distance_km: Number((distNm * 1.852).toFixed(2)),
          bearing_deg: Number(brg.toFixed(1)),
          bearing_cardinal: degToCardinal(brg),
          altitude_ft: altFt,
          altitude_m: altFt != null ? Math.round(altFt * 0.3048) : null,
          speed_kts: gsKts != null ? Number(gsKts.toFixed(1)) : null,
          speed_mph: gsKts != null ? Number((gsKts * 1.15078).toFixed(1)) : null,
          speed_kmh: gsKts != null ? Number((gsKts * 1.852).toFixed(1)) : null,
          track_deg: track != null ? Number(track.toFixed(1)) : null,
          track_cardinal: degToCardinal(track),
          vert_rate_fpm: vr != null ? Math.round(vr) : null,
          squawk: top.squawk || null,
        },
      };

      const nearby = candidates.slice(1, 4).map(({ distNm: dNm, ac: o }) => {
        const oCs = (o.flight || o.r || o.hex || "").trim().toUpperCase();
        const oAlt = parseAltitude(o);
        const c = cacheGet(routeCache, oCs);
        let routeShort = null;
        if (c.hit && c.value && c.value.origin && c.value.destination && c.value.origin.iata && c.value.destination.iata) {
          routeShort = `${c.value.origin.iata}-${c.value.destination.iata}`;
        }
        return {
          callsign: oCs,
          route_short: routeShort,
          distance_mi: Number((dNm * 1.15078).toFixed(1)),
          distance_km: Number((dNm * 1.852).toFixed(1)),
          altitude_ft: oAlt,
          altitude_m: oAlt != null ? Math.round(oAlt * 0.3048) : null,
        };
      });

      return Response.json(
        {
          timestamp: Math.floor(Date.now() / 1000),
          query: { lat, lon, radius_nm: radius },
          source: feed.source,
          total_nearby: candidates.length,
          closest,
          nearby,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    return new Response("Not Found", { status: 404 });
  },
};
