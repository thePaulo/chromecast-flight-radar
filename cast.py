"""Cast FlightWall to your Chromecast Ultra (Mini Monitor) via DashCast.

Examples:
  python cast.py scan
  python cast.py cast
  python cast.py cast --url "https://flightwall.your-subdomain.workers.dev/?lat=43.65&lon=-79.38&radius=25"
  python cast.py status
  python cast.py stop
"""

import argparse
import os
import socket
import sys
import time
import urllib.parse
from pathlib import Path

import pychromecast
from dotenv import load_dotenv
from pychromecast.controllers.dashcast import DashCastController

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


def detect_lan_ip_for(target_host: str | None) -> str:
    """Pick the exact local NIC IP that routes to the Chromecast (avoids VPN adapters)."""
    probe = target_host or "192.168.1.1"
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((probe, 8009))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def connect_cast(name: str | None, host: str | None, timeout: int = 12):
    known_hosts = [host] if host else None
    friendly_names = [name] if name else None

    casts, browser = pychromecast.get_listed_chromecasts(
        friendly_names=friendly_names,
        known_hosts=known_hosts,
        discovery_timeout=timeout,
    )
    if not casts and host:
        # Fallback: match any cast on that IP even if friendly name changed
        pychromecast.discovery.stop_discovery(browser)
        casts, browser = pychromecast.get_listed_chromecasts(
            known_hosts=[host],
            discovery_timeout=timeout,
        )

    if not casts:
        pychromecast.discovery.stop_discovery(browser)
        raise SystemExit(
            f"Could not find Chromecast (name={name!r}, host={host!r}). "
            "Run 'python cast.py scan' to list available Cast devices."
        )

    cast = casts[0]
    cast.wait(timeout=timeout)
    return cast, browser


def build_target_url(args: argparse.Namespace, cast_host: str) -> str:
    base = args.url or os.getenv("PUBLIC_URL", "").strip()
    if not base:
        port = int(os.getenv("PORT", "8080"))
        lan_ip = detect_lan_ip_for(cast_host)
        base = f"http://{lan_ip}:{port}/"

    parsed = urllib.parse.urlparse(base)
    params = dict(urllib.parse.parse_qsl(parsed.query))

    if args.lat is not None:
        params["lat"] = str(args.lat)
    elif "lat" not in params and os.getenv("LAT"):
        params["lat"] = os.getenv("LAT", "")

    if args.lon is not None:
        params["lon"] = str(args.lon)
    elif "lon" not in params and os.getenv("LON"):
        params["lon"] = os.getenv("LON", "")

    if args.radius is not None:
        params["radius"] = str(args.radius)
    elif "radius" not in params and os.getenv("RADIUS_NM"):
        params["radius"] = os.getenv("RADIUS_NM", "")

    if args.units:
        params["units"] = args.units
    elif "units" not in params and os.getenv("UNITS"):
        params["units"] = os.getenv("UNITS", "imperial")

    if args.commercial:
        params["commercial"] = "1"
    elif "commercial" not in params and os.getenv("COMMERCIAL_ONLY", "").lower() in ("1", "true", "yes"):
        params["commercial"] = "1"

    if args.poll is not None:
        params["poll"] = str(args.poll)
    elif "poll" not in params and os.getenv("POLL_SECONDS"):
        params["poll"] = os.getenv("POLL_SECONDS", "10")

    query = urllib.parse.urlencode({k: v for k, v in params.items() if v})
    return urllib.parse.urlunparse(parsed._replace(query=query))


def cmd_scan(_args: argparse.Namespace) -> None:
    print("Scanning local network for Chromecast devices (6s)...")
    services, browser = pychromecast.discovery.discover_chromecasts(timeout=6)
    pychromecast.discovery.stop_discovery(browser)
    if not services:
        print("No Chromecast devices found.")
        return
    print(f"\nFound {len(services)} device(s):")
    for s in services:
        print(f"  - {s.friendly_name:<22} | {s.model_name:<20} | {s.host}:{s.port}")


def launch_url_on_cast(cast, url: str) -> None:
    dash = DashCastController()
    cast.register_handler(dash)
    done = {"fired": False}

    def _on_loaded(_resp=None):
        done["fired"] = True

    # force=True navigates the Chromecast Ultra's browser directly to our URL
    # so it stays alive independently after this script (or PC) shuts down.
    dash.load_url(url, force=True, callback_function=_on_loaded)
    deadline = time.time() + 10
    while not done["fired"] and time.time() < deadline:
        time.sleep(0.25)
    # Give DashCast a moment to complete window.location navigation before disconnecting
    time.sleep(2.0)


def cmd_cast(args: argparse.Namespace) -> None:
    name = args.name or os.getenv("CHROMECAST_NAME")
    host = args.host or os.getenv("CHROMECAST_HOST")
    print(f"Connecting to Chromecast (name={name!r}, host={host!r})...")
    cast, browser = connect_cast(name, host)
    try:
        actual_host = cast.cast_info.host
        url = build_target_url(args, actual_host)
        print(f"Connected to '{cast.cast_info.friendly_name}' ({cast.cast_info.model_name}) at {actual_host}")
        print(f"Casting URL: {url}")
        launch_url_on_cast(cast, url)
        print("Done! FlightWall is now running on the Chromecast Ultra.")
        if url.startswith("http://192.168.") or url.startswith("http://10."):
            print("Note: Currently pointing to your local PC server. For PC-independent 24/7 operation,")
            print("      deploy 'cloudflare/' (free) and re-run with --url https://your-worker.workers.dev")
    finally:
        pychromecast.discovery.stop_discovery(browser)


def cmd_status(args: argparse.Namespace) -> None:
    name = args.name or os.getenv("CHROMECAST_NAME")
    host = args.host or os.getenv("CHROMECAST_HOST")
    cast, browser = connect_cast(name, host)
    try:
        st = cast.status
        print(f"Device : {cast.cast_info.friendly_name} ({cast.cast_info.model_name}) @ {cast.cast_info.host}")
        print(f"App    : {st.display_name if st else 'Idle'} (app_id={st.app_id if st else None})")
        print(f"Status : {st.status_text if st else ''}")
    finally:
        pychromecast.discovery.stop_discovery(browser)


def cmd_stop(args: argparse.Namespace) -> None:
    name = args.name or os.getenv("CHROMECAST_NAME")
    host = args.host or os.getenv("CHROMECAST_HOST")
    cast, browser = connect_cast(name, host)
    try:
        cast.quit_app()
        time.sleep(1.0)
        print(f"Stopped casting on '{cast.cast_info.friendly_name}'.")
    finally:
        pychromecast.discovery.stop_discovery(browser)


def cmd_watch(args: argparse.Namespace) -> None:
    """Optional watchdog: re-casts FlightWall whenever the Chromecast returns to idle/Backdrop."""
    name = args.name or os.getenv("CHROMECAST_NAME")
    host = args.host or os.getenv("CHROMECAST_HOST")
    interval = max(15, args.interval)
    print(f"Watchdog active for {name or host} (checking every {interval}s). Press Ctrl+C to stop.")
    while True:
        try:
            cast, browser = connect_cast(name, host)
            try:
                app_id = cast.status.app_id if cast.status else None
                # Backdrop / Ambient Mode app_id is E8C28D3C or None
                if app_id in (None, "E8C28D3C"):
                    url = build_target_url(args, cast.cast_info.host)
                    print(f"[{time.strftime('%H:%M:%S')}] Device idle -> casting {url}")
                    launch_url_on_cast(cast, url)
                else:
                    print(f"[{time.strftime('%H:%M:%S')}] Active app: {cast.status.display_name} ({app_id})")
            finally:
                pychromecast.discovery.stop_discovery(browser)
        except KeyboardInterrupt:
            print("\nWatchdog stopped.")
            return
        except Exception as e:
            print(f"[{time.strftime('%H:%M:%S')}] Watchdog warning: {e}")
        time.sleep(interval)


def main() -> None:
    parser = argparse.ArgumentParser(description="FlightWall Chromecast Ultra Controller")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("scan", help="Discover Chromecast devices on your Wi-Fi")

    def add_target_args(p: argparse.ArgumentParser) -> None:
        p.add_argument("--name", help="Chromecast friendly name (default from .env)")
        p.add_argument("--host", help="Chromecast IP address (default from .env)")

    def add_url_args(p: argparse.ArgumentParser) -> None:
        p.add_argument("--url", help="Full FlightWall URL (e.g. your deployed Cloudflare Worker URL)")
        p.add_argument("--lat", type=float, help="Home latitude")
        p.add_argument("--lon", type=float, help="Home longitude")
        p.add_argument("--radius", type=float, help="Search radius in nautical miles")
        p.add_argument("--units", choices=["imperial", "metric"], help="Display units")
        p.add_argument("--commercial", action="store_true", help="Only show commercial flights")
        p.add_argument("--poll", type=int, help="Polling interval in seconds")

    p_cast = sub.add_parser("cast", help="Cast FlightWall to your Chromecast Ultra")
    add_target_args(p_cast)
    add_url_args(p_cast)

    p_watch = sub.add_parser("watch", help="Keep FlightWall active if the Chromecast reboots or goes idle")
    add_target_args(p_watch)
    add_url_args(p_watch)
    p_watch.add_argument("--interval", type=int, default=60, help="Check interval in seconds")

    p_status = sub.add_parser("status", help="Show current status of your Chromecast Ultra")
    add_target_args(p_status)

    p_stop = sub.add_parser("stop", help="Stop casting on your Chromecast Ultra")
    add_target_args(p_stop)

    args = parser.parse_args()
    dispatch = {
        "scan": cmd_scan,
        "cast": cmd_cast,
        "status": cmd_status,
        "stop": cmd_stop,
        "watch": cmd_watch,
    }
    dispatch[args.command](args)


if __name__ == "__main__":
    main()
