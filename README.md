# FlightWall for Chromecast Ultra

A lightweight, FlightWall-inspired live overhead flight tracker built specifically for your **Chromecast Ultra** (`Mini Monitor`) — designed to both **run locally on this PC for testing** and **run 24/7 independently on the Chromecast Ultra after your PC is turned off** via a free Cloudflare Worker.

## How It Works

1. **Live Aircraft Data:** Queries `opendata.adsb.fi` (with automatic failover to `api.adsb.lol`) for airborne aircraft within your configured radius.
2. **Route & Aircraft Enrichment:** Looks up the closest plane's callsign and ICAO hex via `api.adsbdb.com` (with failover to `hexdb.io`), caching routes for 6 hours to avoid rate limits.
3. **LED Display (`web/index.html`):** Ultra-lightweight vanilla HTML/CSS/JS sized to fill a 16:9 screen (`100vw × 100vh`) with live route progress, telemetry, OLED pixel-shift burn-in protection, and automatic 12-hour memory refresh.
4. **Chromecast Ultra Casting (`cast.py`):** Uses DashCast (`force=True`) so the Chromecast Ultra navigates directly to your FlightWall URL and runs it natively inside its own browser engine — **no browser tab or active PC connection required once loaded**.

---

## Step 1: Set Your Home Coordinates

Edit `.env` (copied from `.env.example`):

```ini
LAT=43.6532
LON=-79.3832
RADIUS_NM=25
UNITS=imperial
COMMERCIAL_ONLY=false
CHROMECAST_NAME=Mini Monitor
CHROMECAST_HOST=192.168.2.18
```

> **Tip:** Right-click your home on Google Maps to copy your exact `LAT, LON`.

---

## Step 2: Run & Test Locally on This PC

Start the local server:

```powershell
python server.py
```

- Preview in your PC browser: `http://localhost:8080/?controls=1`
- Cast the local server to your Chromecast Ultra (`Mini Monitor`):

```powershell
python cast.py cast
```

Other handy commands:

```powershell
python cast.py scan     # List all Chromecasts on your Wi-Fi
python cast.py status   # Check what is currently running
python cast.py stop     # Return Chromecast Ultra to Ambient Mode
```

> **Windows Firewall Note:** If your Chromecast Ultra can't reach `http://<your-pc-ip>:8080` during local testing, allow inbound TCP port `8080` on your Private network in Windows Defender Firewall (or skip straight to Step 3 for independent cloud hosting!).

---

## Step 3: Make Your Chromecast Ultra Run Independently (PC Turned Off)

When casting a local `http://192.168.x.x:8080` URL, the display stops updating if your PC shuts down.  
To make your Chromecast Ultra run **completely independently 24/7**, deploy the included single-file **Cloudflare Worker** (100% free tier — 100,000 requests/day; 10-second polling uses only ~8,640/day):

1. *(Optional)* Update default coordinates in `cloudflare/wrangler.toml`, or pass them in the URL.
2. If you edited `web/index.html`, rebuild the worker bundle:
   ```powershell
   python cloudflare/build_worker.py
   ```
3. Deploy to Cloudflare (one-time browser login, free account, no credit card needed):
   ```powershell
   cd cloudflare
   npx wrangler login
   npx wrangler deploy
   ```
4. Cloudflare prints your live HTTPS URL (e.g. `https://flightwall-chromecast.<your-name>.workers.dev`). Save it in `.env` as `PUBLIC_URL`, then cast it **once** to your Chromecast Ultra:
   ```powershell
   python cast.py cast --url "https://flightwall-chromecast.<your-name>.workers.dev/?lat=YOUR_LAT&lon=YOUR_LON&radius=25"
   ```
5. **You can now shut down your PC!** Your Chromecast Ultra will keep fetching live flights from Cloudflare every 10 seconds indefinitely.

### Caveat on Power Outages / Reboots
Stock Chromecast Ultra firmware cannot auto-launch a web page on cold boot. After a power outage, Chromecast reboot, or casting another app (like YouTube), simply run `python cast.py cast` once again — or run `python cast.py watch` on an always-on device (like a Raspberry Pi) if you ever want automatic recovery.

---

## URL Query Parameters

You can customize any display directly via URL parameters:

| Parameter | Example | Description |
| :--- | :--- | :--- |
| `lat`, `lon` | `?lat=43.6532&lon=-79.3832` | Home coordinates |
| `radius` | `&radius=25` | Search radius in nautical miles (`1`–`250`) |
| `units` | `&units=metric` | `imperial` (mi/ft/kts) or `metric` (km/m/km/h) |
| `commercial` | `&commercial=1` | Hide private/general aviation planes |
| `poll` | `&poll=10` | Refresh interval in seconds (min `5`) |
| `controls` | `&controls=1` | Show quick config overlay (for PC browser testing) |
