/**
 * FlightWall Standalone Cloudflare Worker
 * Serves BOTH the FlightWall LED UI (/) and the live flight proxy (/api/closest)
 * on Cloudflare's free tier (100,000 req/day) so your Chromecast Ultra runs 24/7
 * completely independently after your PC is turned off!
 *
 * Generated via: python cloudflare/build_worker.py
 */

const INDEX_HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n  <title>FlightWall</title>\n  <style>\n    :root {\n      --bg: #040609;\n      --panel: #0b1018;\n      --panel-border: rgba(255, 255, 255, 0.08);\n      --amber: #ffb82e;\n      --amber-glow: rgba(255, 184, 46, 0.35);\n      --cyan: #38bdf8;\n      --cyan-glow: rgba(56, 189, 248, 0.32);\n      --green: #22c55e;\n      --red: #fb7185;\n      --text: #f1f5f9;\n      --muted: #7c8ba1;\n      --dim: #465266;\n    }\n\n    * {\n      box-sizing: border-box;\n      margin: 0;\n      padding: 0;\n    }\n\n    html, body {\n      width: 100vw;\n      height: 100vh;\n      overflow: hidden;\n      background-color: var(--bg);\n      color: var(--text);\n      font-family: \"Segoe UI\", -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;\n      -webkit-font-smoothing: antialiased;\n      user-select: none;\n    }\n\n    /* Subtle LED dot-matrix texture \u2014 ultra-lightweight CSS for Chromecast Ultra */\n    body::before {\n      content: \"\";\n      position: fixed;\n      inset: 0;\n      pointer-events: none;\n      background-image: radial-gradient(rgba(255, 255, 255, 0.045) 1px, transparent 1px);\n      background-size: 6px 6px;\n      z-index: 10;\n    }\n\n    /* Soft ambient radial vignette */\n    body::after {\n      content: \"\";\n      position: fixed;\n      inset: 0;\n      pointer-events: none;\n      background: radial-gradient(circle at 50% 42%, rgba(56, 189, 248, 0.06), transparent 62%);\n      z-index: 0;\n    }\n\n    .board {\n      position: relative;\n      z-index: 1;\n      width: 100vw;\n      height: 100vh;\n      padding: 2.6vh 3.2vw 2.2vh;\n      display: grid;\n      grid-template-rows: auto 1fr auto auto;\n      gap: 2vh;\n      transition: transform 2s ease, opacity 0.35s ease;\n    }\n\n    .board.switching {\n      opacity: 0.72;\n    }\n\n    /* ---------------- TOP HEADER ---------------- */\n    .header {\n      display: flex;\n      align-items: center;\n      justify-content: space-between;\n      border-bottom: 1px solid var(--panel-border);\n      padding-bottom: 1.6vh;\n      gap: 2vw;\n    }\n\n    .airline-block {\n      display: flex;\n      align-items: center;\n      gap: 1.4vw;\n      min-width: 0;\n    }\n\n    .airline-badge {\n      display: inline-flex;\n      align-items: center;\n      justify-content: center;\n      min-width: 4.8vw;\n      height: 5.4vh;\n      padding: 0 1vw;\n      border-radius: 0.8vh;\n      background: linear-gradient(135deg, rgba(255, 184, 46, 0.2), rgba(255, 184, 46, 0.08));\n      border: 1px solid rgba(255, 184, 46, 0.45);\n      color: var(--amber);\n      font-family: \"Consolas\", \"SFMono-Regular\", Menlo, monospace;\n      font-weight: 800;\n      font-size: clamp(18px, 2.7vh, 36px);\n      letter-spacing: 0.08em;\n      text-shadow: 0 0 14px var(--amber-glow);\n      flex-shrink: 0;\n    }\n\n    .airline-meta {\n      display: flex;\n      flex-direction: column;\n      min-width: 0;\n    }\n\n    .airline-name {\n      font-size: clamp(18px, 3vh, 40px);\n      font-weight: 700;\n      letter-spacing: 0.04em;\n      text-transform: uppercase;\n      white-space: nowrap;\n      overflow: hidden;\n      text-overflow: ellipsis;\n      line-height: 1.1;\n    }\n\n    .flight-sub {\n      font-family: \"Consolas\", \"SFMono-Regular\", Menlo, monospace;\n      font-size: clamp(12px, 1.85vh, 22px);\n      color: var(--cyan);\n      letter-spacing: 0.1em;\n      margin-top: 0.35vh;\n      white-space: nowrap;\n      overflow: hidden;\n      text-overflow: ellipsis;\n    }\n\n    .status-block {\n      display: flex;\n      align-items: center;\n      gap: 1.4vw;\n      flex-shrink: 0;\n    }\n\n    .pill {\n      display: inline-flex;\n      align-items: center;\n      gap: 0.55vw;\n      padding: 0.7vh 1.1vw;\n      border-radius: 999px;\n      background: var(--panel);\n      border: 1px solid var(--panel-border);\n      font-family: \"Consolas\", \"SFMono-Regular\", Menlo, monospace;\n      font-size: clamp(11px, 1.75vh, 20px);\n      color: var(--muted);\n      letter-spacing: 0.08em;\n      text-transform: uppercase;\n    }\n\n    .dot {\n      width: 1.1vh;\n      height: 1.1vh;\n      border-radius: 50%;\n      background: var(--green);\n      box-shadow: 0 0 10px var(--green);\n      animation: pulse 2.2s infinite ease-in-out;\n    }\n\n    .dot.warn {\n      background: var(--amber);\n      box-shadow: 0 0 10px var(--amber);\n    }\n\n    .dot.err {\n      background: var(--red);\n      box-shadow: 0 0 10px var(--red);\n    }\n\n    .clock {\n      font-family: \"Consolas\", \"SFMono-Regular\", Menlo, monospace;\n      font-size: clamp(20px, 3.2vh, 40px);\n      font-weight: 700;\n      color: var(--text);\n      letter-spacing: 0.06em;\n    }\n\n    /* ---------------- HERO CENTERPIECE ---------------- */\n    .hero {\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      min-height: 0;\n    }\n\n    /* Commercial Route View */\n    .route-hero {\n      width: 100%;\n      display: grid;\n      grid-template-columns: minmax(18vw, 1fr) minmax(24vw, 1.25fr) minmax(18vw, 1fr);\n      align-items: center;\n      gap: 2.2vw;\n    }\n\n    .airport {\n      display: flex;\n      flex-direction: column;\n      align-items: center;\n      text-align: center;\n      min-width: 0;\n    }\n\n    .airport-code {\n      font-family: \"Consolas\", \"SFMono-Regular\", Menlo, monospace;\n      font-size: clamp(54px, 15.5vh, 180px);\n      font-weight: 900;\n      line-height: 0.92;\n      letter-spacing: 0.04em;\n      color: var(--amber);\n      text-shadow: 0 0 28px var(--amber-glow), 0 0 6px rgba(255, 184, 46, 0.5);\n    }\n\n    .airport-city {\n      margin-top: 1.5vh;\n      font-size: clamp(14px, 2.7vh, 34px);\n      font-weight: 600;\n      color: var(--text);\n      letter-spacing: 0.08em;\n      text-transform: uppercase;\n      max-width: 100%;\n      white-space: nowrap;\n      overflow: hidden;\n      text-overflow: ellipsis;\n    }\n\n    .airport-country {\n      margin-top: 0.4vh;\n      font-family: \"Consolas\", \"SFMono-Regular\", Menlo, monospace;\n      font-size: clamp(11px, 1.7vh, 20px);\n      color: var(--muted);\n      letter-spacing: 0.12em;\n      text-transform: uppercase;\n    }\n\n    .path-center {\n      display: flex;\n      flex-direction: column;\n      align-items: center;\n      gap: 2vh;\n    }\n\n    .proximity-tag {\n      font-family: \"Consolas\", \"SFMono-Regular\", Menlo, monospace;\n      font-size: clamp(13px, 2.2vh, 26px);\n      font-weight: 700;\n      letter-spacing: 0.12em;\n      color: var(--cyan);\n      text-transform: uppercase;\n      text-shadow: 0 0 14px var(--cyan-glow);\n    }\n\n    .track-wrap {\n      position: relative;\n      width: 100%;\n      height: 5.5vh;\n      display: flex;\n      align-items: center;\n    }\n\n    .track-line {\n      width: 100%;\n      height: 0.55vh;\n      border-radius: 999px;\n      background: rgba(255, 255, 255, 0.12);\n      position: relative;\n      overflow: hidden;\n    }\n\n    .track-fill {\n      height: 100%;\n      width: 50%;\n      background: linear-gradient(90deg, rgba(56, 189, 248, 0.25), var(--cyan));\n      box-shadow: 0 0 14px var(--cyan-glow);\n      transition: width 1s ease;\n    }\n\n    .track-dot {\n      position: absolute;\n      width: 1.2vh;\n      height: 1.2vh;\n      border-radius: 50%;\n      background: var(--amber);\n      box-shadow: 0 0 8px var(--amber-glow);\n      top: 50%;\n      transform: translateY(-50%);\n    }\n\n    .track-dot.start { left: 0; }\n    .track-dot.end { right: 0; background: var(--dim); box-shadow: none; }\n\n    .plane-marker {\n      position: absolute;\n      top: 50%;\n      left: 50%;\n      transform: translate(-50%, -50%);\n      transition: left 1s ease;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      filter: drop-shadow(0 0 12px var(--cyan-glow));\n    }\n\n    .plane-marker svg {\n      width: clamp(28px, 5.2vh, 62px);\n      height: clamp(28px, 5.2vh, 62px);\n      fill: var(--text);\n    }\n\n    .aircraft-pill {\n      padding: 0.8vh 1.5vw;\n      border-radius: 0.9vh;\n      background: var(--panel);\n      border: 1px solid var(--panel-border);\n      font-size: clamp(13px, 2.15vh, 26px);\n      font-weight: 600;\n      color: var(--text);\n      letter-spacing: 0.05em;\n      text-align: center;\n      max-width: 100%;\n      white-space: nowrap;\n      overflow: hidden;\n      text-overflow: ellipsis;\n    }\n\n    .aircraft-pill span {\n      color: var(--amber);\n      font-family: \"Consolas\", \"SFMono-Regular\", Menlo, monospace;\n      margin-right: 0.5vw;\n    }\n\n    /* Private / General Aviation View (no scheduled route) */\n    .ga-hero {\n      width: 100%;\n      display: flex;\n      flex-direction: column;\n      align-items: center;\n      justify-content: center;\n      text-align: center;\n      gap: 1.8vh;\n    }\n\n    .ga-top {\n      display: flex;\n      align-items: center;\n      gap: 1.4vw;\n    }\n\n    .ga-icon svg {\n      width: clamp(36px, 7vh, 80px);\n      height: clamp(36px, 7vh, 80px);\n      fill: var(--cyan);\n      filter: drop-shadow(0 0 14px var(--cyan-glow));\n    }\n\n    .ga-callsign {\n      font-family: \"Consolas\", \"SFMono-Regular\", Menlo, monospace;\n      font-size: clamp(54px, 14.5vh, 168px);\n      font-weight: 900;\n      letter-spacing: 0.06em;\n      line-height: 0.95;\n      color: var(--amber);\n      text-shadow: 0 0 28px var(--amber-glow);\n    }\n\n    .ga-model {\n      font-size: clamp(18px, 3.4vh, 42px);\n      font-weight: 700;\n      color: var(--text);\n      letter-spacing: 0.06em;\n      text-transform: uppercase;\n    }\n\n    .ga-owner {\n      font-family: \"Consolas\", \"SFMono-Regular\", Menlo, monospace;\n      font-size: clamp(13px, 2.2vh, 26px);\n      color: var(--cyan);\n      letter-spacing: 0.1em;\n      text-transform: uppercase;\n    }\n\n    /* Idle / No Aircraft View */\n    .idle-hero {\n      display: flex;\n      flex-direction: column;\n      align-items: center;\n      justify-content: center;\n      text-align: center;\n      gap: 2.2vh;\n    }\n\n    .radar-ring {\n      width: clamp(76px, 15vh, 160px);\n      height: clamp(76px, 15vh, 160px);\n      border-radius: 50%;\n      border: 2px solid rgba(56, 189, 248, 0.32);\n      position: relative;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n    }\n\n    .radar-ring::before {\n      content: \"\";\n      position: absolute;\n      inset: 18%;\n      border-radius: 50%;\n      border: 1px dashed rgba(56, 189, 248, 0.28);\n    }\n\n    .radar-sweep {\n      position: absolute;\n      inset: 0;\n      border-radius: 50%;\n      background: conic-gradient(from 0deg, rgba(56, 189, 248, 0.35), transparent 65deg);\n      animation: spin 4.5s linear infinite;\n    }\n\n    .idle-title {\n      font-family: \"Consolas\", \"SFMono-Regular\", Menlo, monospace;\n      font-size: clamp(22px, 4.2vh, 48px);\n      font-weight: 700;\n      letter-spacing: 0.14em;\n      color: var(--text);\n      text-transform: uppercase;\n    }\n\n    .idle-sub {\n      font-family: \"Consolas\", \"SFMono-Regular\", Menlo, monospace;\n      font-size: clamp(13px, 2.1vh, 24px);\n      color: var(--muted);\n      letter-spacing: 0.08em;\n    }\n\n    /* ---------------- TELEMETRY CARDS ---------------- */\n    .telemetry {\n      display: grid;\n      grid-template-columns: repeat(4, 1fr);\n      gap: 1.5vw;\n    }\n\n    .card {\n      background: var(--panel);\n      border: 1px solid var(--panel-border);\n      border-radius: 1.2vh;\n      padding: 1.8vh 1.6vw;\n      display: flex;\n      flex-direction: column;\n      justify-content: space-between;\n      min-height: 14.5vh;\n    }\n\n    .card-label {\n      font-family: \"Consolas\", \"SFMono-Regular\", Menlo, monospace;\n      font-size: clamp(11px, 1.65vh, 19px);\n      color: var(--muted);\n      letter-spacing: 0.14em;\n      text-transform: uppercase;\n    }\n\n    .card-value {\n      font-family: \"Consolas\", \"SFMono-Regular\", Menlo, monospace;\n      font-size: clamp(24px, 4.4vh, 52px);\n      font-weight: 800;\n      color: var(--text);\n      letter-spacing: 0.03em;\n      line-height: 1.1;\n      margin-top: 0.6vh;\n      white-space: nowrap;\n    }\n\n    .card-value .unit {\n      font-size: 0.52em;\n      color: var(--muted);\n      font-weight: 600;\n      margin-left: 0.25em;\n    }\n\n    .card-sub {\n      font-family: \"Consolas\", \"SFMono-Regular\", Menlo, monospace;\n      font-size: clamp(11px, 1.75vh, 20px);\n      color: var(--cyan);\n      letter-spacing: 0.08em;\n      margin-top: 0.6vh;\n      display: flex;\n      align-items: center;\n      gap: 0.5vw;\n      white-space: nowrap;\n    }\n\n    .climb { color: var(--green); }\n    .descend { color: var(--red); }\n    .level { color: var(--muted); }\n\n    .heading-arrow {\n      display: inline-block;\n      width: 2.1vh;\n      height: 2.1vh;\n      transition: transform 0.8s ease;\n    }\n\n    /* ---------------- FOOTER / ALSO NEARBY ---------------- */\n    .footer {\n      display: flex;\n      align-items: center;\n      justify-content: space-between;\n      border-top: 1px solid var(--panel-border);\n      padding-top: 1.3vh;\n      gap: 1.5vw;\n      font-family: \"Consolas\", \"SFMono-Regular\", Menlo, monospace;\n      font-size: clamp(11px, 1.7vh, 19px);\n      color: var(--muted);\n    }\n\n    .nearby-list {\n      display: flex;\n      align-items: center;\n      gap: 1.2vw;\n      overflow: hidden;\n      min-width: 0;\n    }\n\n    .nearby-label {\n      color: var(--dim);\n      letter-spacing: 0.12em;\n      flex-shrink: 0;\n    }\n\n    .nearby-chip {\n      display: inline-flex;\n      align-items: center;\n      gap: 0.55vw;\n      padding: 0.45vh 0.9vw;\n      border-radius: 0.6vh;\n      background: rgba(255, 255, 255, 0.04);\n      border: 1px solid rgba(255, 255, 255, 0.06);\n      white-space: nowrap;\n      color: var(--text);\n    }\n\n    .nearby-chip b {\n      color: var(--amber);\n      font-weight: 700;\n    }\n\n    .nearby-chip span {\n      color: var(--muted);\n    }\n\n    .source-tag {\n      color: var(--dim);\n      letter-spacing: 0.08em;\n      flex-shrink: 0;\n      text-transform: uppercase;\n    }\n\n    /* Optional PC Setup Bar (only shown with ?controls=1) */\n    .controls-bar {\n      position: fixed;\n      bottom: 14px;\n      right: 14px;\n      z-index: 50;\n      background: rgba(11, 16, 24, 0.95);\n      border: 1px solid rgba(56, 189, 248, 0.4);\n      border-radius: 10px;\n      padding: 12px 14px;\n      display: none;\n      gap: 8px;\n      align-items: center;\n      flex-wrap: wrap;\n      font-size: 13px;\n      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);\n    }\n\n    .controls-bar.visible { display: flex; }\n\n    .controls-bar input, .controls-bar select {\n      background: #040609;\n      color: var(--text);\n      border: 1px solid rgba(255, 255, 255, 0.16);\n      border-radius: 6px;\n      padding: 5px 8px;\n      width: 96px;\n      font-family: monospace;\n    }\n\n    .controls-bar button {\n      background: var(--amber);\n      color: #040609;\n      border: none;\n      border-radius: 6px;\n      padding: 6px 12px;\n      font-weight: 700;\n      cursor: pointer;\n    }\n\n    .hidden { display: none !important; }\n\n    @keyframes pulse {\n      0%, 100% { opacity: 1; transform: scale(1); }\n      50% { opacity: 0.45; transform: scale(0.85); }\n    }\n\n    @keyframes spin {\n      from { transform: rotate(0deg); }\n      to { transform: rotate(360deg); }\n    }\n  </style>\n</head>\n<body>\n  <div class=\"board\" id=\"board\">\n    <!-- HEADER -->\n    <header class=\"header\">\n      <div class=\"airline-block\">\n        <div class=\"airline-badge\" id=\"airlineBadge\">FW</div>\n        <div class=\"airline-meta\">\n          <div class=\"airline-name\" id=\"airlineName\">FLIGHTWALL</div>\n          <div class=\"flight-sub\" id=\"flightSub\">INITIALIZING RADAR...</div>\n        </div>\n      </div>\n      <div class=\"status-block\">\n        <div class=\"pill\">\n          <span class=\"dot\" id=\"statusDot\"></span>\n          <span id=\"statusText\">LIVE</span>\n        </div>\n        <div class=\"pill\" id=\"countPill\">0 IN RANGE</div>\n        <div class=\"clock\" id=\"clock\">--:--</div>\n      </div>\n    </header>\n\n    <!-- HERO -->\n    <main class=\"hero\">\n      <!-- Commercial Route View -->\n      <section class=\"route-hero hidden\" id=\"routeHero\">\n        <div class=\"airport\">\n          <div class=\"airport-code\" id=\"origCode\">---</div>\n          <div class=\"airport-city\" id=\"origCity\">---</div>\n          <div class=\"airport-country\" id=\"origCountry\"></div>\n        </div>\n\n        <div class=\"path-center\">\n          <div class=\"proximity-tag\" id=\"routeProximity\">CLOSEST OVERHEAD</div>\n          <div class=\"track-wrap\">\n            <div class=\"track-line\">\n              <div class=\"track-fill\" id=\"trackFill\"></div>\n            </div>\n            <div class=\"track-dot start\"></div>\n            <div class=\"track-dot end\"></div>\n            <div class=\"plane-marker\" id=\"planeMarker\">\n              <svg viewBox=\"0 0 24 24\" aria-hidden=\"true\">\n                <path d=\"M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z\" transform=\"rotate(90 12 12)\"/>\n              </svg>\n            </div>\n          </div>\n          <div class=\"aircraft-pill\" id=\"routeAircraft\"><span>---</span>Aircraft</div>\n        </div>\n\n        <div class=\"airport\">\n          <div class=\"airport-code\" id=\"destCode\">---</div>\n          <div class=\"airport-city\" id=\"destCity\">---</div>\n          <div class=\"airport-country\" id=\"destCountry\"></div>\n        </div>\n      </section>\n\n      <!-- General Aviation / Private / No-Route View -->\n      <section class=\"ga-hero hidden\" id=\"gaHero\">\n        <div class=\"ga-top\">\n          <div class=\"ga-icon\" id=\"gaIcon\">\n            <svg viewBox=\"0 0 24 24\" aria-hidden=\"true\">\n              <path d=\"M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z\"/>\n            </svg>\n          </div>\n          <div class=\"ga-callsign\" id=\"gaCallsign\">---</div>\n        </div>\n        <div class=\"ga-model\" id=\"gaModel\">AIRCRAFT</div>\n        <div class=\"ga-owner\" id=\"gaOwner\">PRIVATE / UNSCHEDULED</div>\n      </section>\n\n      <!-- Clear Skies / Idle View -->\n      <section class=\"idle-hero\" id=\"idleHero\">\n        <div class=\"radar-ring\">\n          <div class=\"radar-sweep\"></div>\n        </div>\n        <div class=\"idle-title\" id=\"idleTitle\">SCANNING LOCAL SKIES</div>\n        <div class=\"idle-sub\" id=\"idleSub\">WAITING FOR NEARBY AIRCRAFT...</div>\n      </section>\n    </main>\n\n    <!-- TELEMETRY -->\n    <section class=\"telemetry\" id=\"telemetryGrid\">\n      <div class=\"card\">\n        <div class=\"card-label\">Distance</div>\n        <div class=\"card-value\" id=\"valDist\">--<span class=\"unit\" id=\"unitDist\">MI</span></div>\n        <div class=\"card-sub\" id=\"subDist\">BEARING --</div>\n      </div>\n      <div class=\"card\">\n        <div class=\"card-label\">Altitude</div>\n        <div class=\"card-value\" id=\"valAlt\">--<span class=\"unit\" id=\"unitAlt\">FT</span></div>\n        <div class=\"card-sub level\" id=\"subAlt\">\u25cf LEVEL</div>\n      </div>\n      <div class=\"card\">\n        <div class=\"card-label\">Ground Speed</div>\n        <div class=\"card-value\" id=\"valSpeed\">--<span class=\"unit\" id=\"unitSpeed\">KTS</span></div>\n        <div class=\"card-sub\" id=\"subSpeed\">-- MPH</div>\n      </div>\n      <div class=\"card\">\n        <div class=\"card-label\">Heading</div>\n        <div class=\"card-value\" id=\"valHeading\">--<span class=\"unit\">\u00b0</span></div>\n        <div class=\"card-sub\">\n          <svg class=\"heading-arrow\" id=\"headingArrow\" viewBox=\"0 0 24 24\" fill=\"currentColor\">\n            <path d=\"M12 2L19 21L12 17L5 21L12 2Z\"/>\n          </svg>\n          <span id=\"subHeading\">TRACK --</span>\n        </div>\n      </div>\n    </section>\n\n    <!-- FOOTER -->\n    <footer class=\"footer\">\n      <div class=\"nearby-list\" id=\"nearbyList\">\n        <span class=\"nearby-label\">ALSO NEARBY</span>\n        <span style=\"color: var(--dim)\">Scanning...</span>\n      </div>\n      <div class=\"source-tag\" id=\"sourceTag\">ADSB</div>\n    </footer>\n  </div>\n\n  <!-- Optional PC Controls Overlay (?controls=1) -->\n  <div class=\"controls-bar\" id=\"controlsBar\">\n    <label>Lat <input id=\"inLat\" type=\"text\" /></label>\n    <label>Lon <input id=\"inLon\" type=\"text\" /></label>\n    <label>Radius (nm) <input id=\"inRadius\" type=\"number\" style=\"width:68px\" /></label>\n    <select id=\"inUnits\" style=\"width:94px\">\n      <option value=\"imperial\">Imperial</option>\n      <option value=\"metric\">Metric</option>\n    </select>\n    <button id=\"btnApply\">Apply</button>\n  </div>\n\n  <script>\n    (function () {\n      const qs = new URLSearchParams(window.location.search);\n      const cfg = {\n        lat: qs.get(\"lat\"),\n        lon: qs.get(\"lon\"),\n        radius: qs.get(\"radius\"),\n        units: (qs.get(\"units\") || \"imperial\").toLowerCase(),\n        commercial: qs.get(\"commercial\") || qs.get(\"commercial_only\") || \"\",\n        poll: Math.max(5, parseInt(qs.get(\"poll\") || \"10\", 10) || 10),\n        controls: qs.get(\"controls\") === \"1\"\n      };\n\n      const $ = (id) => document.getElementById(id);\n      let lastHex = null;\n      let failCount = 0;\n\n      // Clock updater\n      function updateClock() {\n        const now = new Date();\n        const h = String(now.getHours()).padStart(2, \"0\");\n        const m = String(now.getMinutes()).padStart(2, \"0\");\n        $(\"clock\").textContent = h + \":\" + m;\n      }\n      updateClock();\n      setInterval(updateClock, 15000);\n\n      // Subtle OLED burn-in protection shift every 60s\n      let shiftStep = 0;\n      const shifts = [[0, 0], [2, 1], [-2, 1], [1, -2], [-1, -1]];\n      setInterval(() => {\n        shiftStep = (shiftStep + 1) % shifts.length;\n        const [x, y] = shifts[shiftStep];\n        $(\"board\").style.transform = `translate(${x}px, ${y}px)`;\n      }, 60000);\n\n      // Periodic clean reload every 12h to keep Chromecast Ultra RAM spotless 24/7\n      setTimeout(() => window.location.reload(), 12 * 60 * 60 * 1000);\n\n      // Optional PC controls bar (?controls=1)\n      if (cfg.controls) {\n        $(\"controlsBar\").classList.add(\"visible\");\n        $(\"inLat\").value = cfg.lat || \"\";\n        $(\"inLon\").value = cfg.lon || \"\";\n        $(\"inRadius\").value = cfg.radius || \"25\";\n        $(\"inUnits\").value = cfg.units;\n        $(\"btnApply\").addEventListener(\"click\", () => {\n          const next = new URLSearchParams();\n          if ($(\"inLat\").value.trim()) next.set(\"lat\", $(\"inLat\").value.trim());\n          if ($(\"inLon\").value.trim()) next.set(\"lon\", $(\"inLon\").value.trim());\n          if ($(\"inRadius\").value.trim()) next.set(\"radius\", $(\"inRadius\").value.trim());\n          next.set(\"units\", $(\"inUnits\").value);\n          next.set(\"controls\", \"1\");\n          window.location.search = next.toString();\n        });\n      }\n\n      function esc(str) {\n        return String(str == null ? \"\" : str)\n          .replace(/&/g, \"&amp;\")\n          .replace(/</g, \"&lt;\")\n          .replace(/>/g, \"&gt;\")\n          .replace(/\"/g, \"&quot;\");\n      }\n\n      function fmtNum(n) {\n        if (n === null || n === undefined || Number.isNaN(n)) return \"--\";\n        return Math.round(n).toLocaleString(\"en-US\");\n      }\n\n      function buildApiUrl() {\n        const p = new URLSearchParams();\n        if (cfg.lat) p.set(\"lat\", cfg.lat);\n        if (cfg.lon) p.set(\"lon\", cfg.lon);\n        if (cfg.radius) p.set(\"radius\", cfg.radius);\n        if (cfg.commercial) p.set(\"commercial_only\", cfg.commercial);\n        const q = p.toString();\n        return \"/api/closest\" + (q ? \"?\" + q : \"\");\n      }\n\n      function setStatus(state, label) {\n        const dot = $(\"statusDot\");\n        dot.className = \"dot\" + (state === \"warn\" ? \" warn\" : state === \"err\" ? \" err\" : \"\");\n        $(\"statusText\").textContent = label;\n      }\n\n      function renderIdle(data) {\n        $(\"routeHero\").classList.add(\"hidden\");\n        $(\"gaHero\").classList.add(\"hidden\");\n        $(\"idleHero\").classList.remove(\"hidden\");\n\n        $(\"airlineBadge\").textContent = \"FW\";\n        $(\"airlineName\").textContent = \"FLIGHTWALL\";\n        const rNm = data && data.query ? data.query.radius_nm : (cfg.radius || 25);\n        $(\"flightSub\").textContent = `MONITORING ${rNm} NM RADIUS`;\n        $(\"idleTitle\").textContent = \"CLEAR SKIES OVERHEAD\";\n        $(\"idleSub\").textContent = `NO AIRCRAFT WITHIN ${rNm} NM \u00b7 POLLING EVERY ${cfg.poll}S`;\n\n        $(\"valDist\").innerHTML = `--<span class=\"unit\">${cfg.units === \"metric\" ? \"KM\" : \"MI\"}</span>`;\n        $(\"subDist\").textContent = \"BEARING --\";\n        $(\"valAlt\").innerHTML = `--<span class=\"unit\">${cfg.units === \"metric\" ? \"M\" : \"FT\"}</span>`;\n        $(\"subAlt\").className = \"card-sub level\";\n        $(\"subAlt\").textContent = \"\u25cf STANDBY\";\n        $(\"valSpeed\").innerHTML = `--<span class=\"unit\">${cfg.units === \"metric\" ? \"KM/H\" : \"KTS\"}</span>`;\n        $(\"subSpeed\").textContent = \"--\";\n        $(\"valHeading\").innerHTML = `--<span class=\"unit\">\u00b0</span>`;\n        $(\"subHeading\").textContent = \"TRACK --\";\n        $(\"headingArrow\").style.transform = \"rotate(0deg)\";\n\n        $(\"nearbyList\").innerHTML = '<span class=\"nearby-label\">ALSO NEARBY</span><span style=\"color:var(--dim)\">None in range</span>';\n      }\n\n      function renderFlight(data) {\n        const f = data.closest;\n        const t = f.telemetry || {};\n        const ac = f.aircraft || {};\n        const al = f.airline || {};\n        const rt = f.route || null;\n        const metric = cfg.units === \"metric\";\n\n        if (lastHex && lastHex !== f.hex) {\n          $(\"board\").classList.add(\"switching\");\n          setTimeout(() => $(\"board\").classList.remove(\"switching\"), 320);\n        }\n        lastHex = f.hex;\n\n        // Header\n        const badgeText = al.iata || al.icao || (f.callsign ? f.callsign.slice(0, 3) : ac.code || \"AC\");\n        $(\"airlineBadge\").textContent = badgeText.toUpperCase().slice(0, 4);\n\n        const displayAirline = al.name || ac.owner || (rt ? \"COMMERCIAL FLIGHT\" : \"PRIVATE / GENERAL AVIATION\");\n        $(\"airlineName\").textContent = displayAirline;\n\n        const subParts = [];\n        if (f.flight_iata && f.flight_iata !== f.callsign) subParts.push(f.flight_iata);\n        if (f.callsign) subParts.push(f.callsign);\n        if (f.registration && f.registration !== f.callsign) subParts.push(\"REG \" + f.registration);\n        if (t.squawk) subParts.push(\"SQK \" + t.squawk);\n        $(\"flightSub\").textContent = subParts.join(\" \u00b7 \") || f.hex.toUpperCase();\n\n        // Hero section\n        const distVal = metric ? t.distance_km : t.distance_mi;\n        const distUnit = metric ? \"KM\" : \"MI\";\n        const distStr = distVal !== null && distVal !== undefined ? distVal.toFixed(1) : \"--\";\n\n        if (rt && rt.origin && rt.destination && rt.origin.iata && rt.destination.iata) {\n          $(\"idleHero\").classList.add(\"hidden\");\n          $(\"gaHero\").classList.add(\"hidden\");\n          $(\"routeHero\").classList.remove(\"hidden\");\n\n          $(\"origCode\").textContent = rt.origin.iata;\n          $(\"origCity\").textContent = rt.origin.city || rt.origin.name || \"\";\n          $(\"origCountry\").textContent = rt.origin.country || \"\";\n\n          $(\"destCode\").textContent = rt.destination.iata;\n          $(\"destCity\").textContent = rt.destination.city || rt.destination.name || \"\";\n          $(\"destCountry\").textContent = rt.destination.country || \"\";\n\n          $(\"routeProximity\").textContent = `${distStr} ${distUnit} \u00b7 ${t.bearing_cardinal || \"--\"} OF YOU`;\n\n          const pct = typeof rt.progress_pct === \"number\" ? Math.max(6, Math.min(94, rt.progress_pct)) : 50;\n          $(\"trackFill\").style.width = pct + \"%\";\n          $(\"planeMarker\").style.left = pct + \"%\";\n\n          const codeSpan = ac.code ? `<span>${esc(ac.code)}</span>` : \"\";\n          $(\"routeAircraft\").innerHTML = codeSpan + esc(ac.model || \"AIRCRAFT\");\n        } else {\n          $(\"idleHero\").classList.add(\"hidden\");\n          $(\"routeHero\").classList.add(\"hidden\");\n          $(\"gaHero\").classList.remove(\"hidden\");\n\n          $(\"gaCallsign\").textContent = f.flight_iata || f.callsign || f.registration || f.hex.toUpperCase();\n          const modelLabel = [ac.code, ac.model].filter(Boolean).join(\" \u00b7 \") || \"AIRCRAFT\";\n          $(\"gaModel\").textContent = modelLabel;\n          const ownerLabel = al.name || ac.owner || \"UNSCHEDULED / LOCAL FLIGHT\";\n          $(\"gaOwner\").textContent = `${ownerLabel}  \u00b7  ${distStr} ${distUnit} ${t.bearing_cardinal || \"\"}`;\n        }\n\n        // Telemetry cards\n        $(\"valDist\").innerHTML = `${distStr}<span class=\"unit\">${distUnit}</span>`;\n        $(\"subDist\").textContent = t.bearing_deg !== null && t.bearing_deg !== undefined\n          ? `BEARING ${Math.round(t.bearing_deg)}\u00b0 ${t.bearing_cardinal || \"\"}`\n          : \"BEARING --\";\n\n        if (metric) {\n          $(\"valAlt\").innerHTML = `${fmtNum(t.altitude_m)}<span class=\"unit\">M</span>`;\n        } else {\n          $(\"valAlt\").innerHTML = `${fmtNum(t.altitude_ft)}<span class=\"unit\">FT</span>`;\n        }\n\n        const vr = t.vert_rate_fpm || 0;\n        if (vr > 150) {\n          $(\"subAlt\").className = \"card-sub climb\";\n          $(\"subAlt\").textContent = `\u25b2 +${fmtNum(vr)} FPM`;\n        } else if (vr < -150) {\n          $(\"subAlt\").className = \"card-sub descend\";\n          $(\"subAlt\").textContent = `\u25bc ${fmtNum(vr)} FPM`;\n        } else {\n          $(\"subAlt\").className = \"card-sub level\";\n          $(\"subAlt\").textContent = \"\u25cf CRUISING / LEVEL\";\n        }\n\n        if (metric) {\n          $(\"valSpeed\").innerHTML = `${fmtNum(t.speed_kmh)}<span class=\"unit\">KM/H</span>`;\n          $(\"subSpeed\").textContent = `${fmtNum(t.speed_kts)} KTS`;\n        } else {\n          $(\"valSpeed\").innerHTML = `${fmtNum(t.speed_kts)}<span class=\"unit\">KTS</span>`;\n          $(\"subSpeed\").textContent = `${fmtNum(t.speed_mph)} MPH`;\n        }\n\n        if (t.track_deg !== null && t.track_deg !== undefined) {\n          const deg = Math.round(t.track_deg);\n          $(\"valHeading\").innerHTML = `${String(deg).padStart(3, \"0\")}<span class=\"unit\">\u00b0</span>`;\n          $(\"subHeading\").textContent = `TRACK ${t.track_cardinal || \"--\"}`;\n          $(\"headingArrow\").style.transform = `rotate(${deg}deg)`;\n        } else {\n          $(\"valHeading\").innerHTML = `--<span class=\"unit\">\u00b0</span>`;\n          $(\"subHeading\").textContent = \"TRACK --\";\n        }\n\n        // Also nearby chips\n        const list = $(\"nearbyList\");\n        const others = (data.nearby || []).slice(0, 3);\n        if (others.length === 0) {\n          list.innerHTML = '<span class=\"nearby-label\">ALSO NEARBY</span><span style=\"color:var(--dim)\">Only aircraft in range</span>';\n        } else {\n          let html = '<span class=\"nearby-label\">ALSO NEARBY</span>';\n          for (const o of others) {\n            const d = metric ? (o.distance_km != null ? o.distance_km.toFixed(1) + \" km\" : \"--\") : (o.distance_mi != null ? o.distance_mi.toFixed(1) + \" mi\" : \"--\");\n            const alt = metric ? (o.altitude_m != null ? fmtNum(o.altitude_m) + \"m\" : \"\") : (o.altitude_ft != null ? fmtNum(o.altitude_ft) + \"ft\" : \"\");\n            const tag = o.route_short ? `${o.callsign} (${o.route_short})` : o.callsign;\n            html += `<span class=\"nearby-chip\"><b>${esc(tag)}</b><span>${esc(d)}${alt ? \" \u00b7 \" + esc(alt) : \"\"}</span></span>`;\n          }\n          list.innerHTML = html;\n        }\n      }\n\n      async function poll() {\n        const controller = new AbortController();\n        const timer = setTimeout(() => controller.abort(), 8500);\n        try {\n          const res = await fetch(buildApiUrl(), { cache: \"no-store\", signal: controller.signal });\n          clearTimeout(timer);\n          if (!res.ok) throw new Error(\"HTTP \" + res.status);\n          const data = await res.json();\n          failCount = 0;\n\n          if (!cfg.lat && data.query && cfg.controls) {\n            $(\"inLat\").value = data.query.lat;\n            $(\"inLon\").value = data.query.lon;\n            $(\"inRadius\").value = data.query.radius_nm;\n          }\n\n          const count = data.total_nearby || 0;\n          $(\"countPill\").textContent = `${count} IN RANGE`;\n          $(\"sourceTag\").textContent = `${(data.source || \"ADSB\").toUpperCase()} \u00b7 ${data.query ? data.query.radius_nm : 25} NM`;\n          setStatus(\"ok\", \"LIVE\");\n\n          if (data.closest) {\n            renderFlight(data);\n          } else {\n            renderIdle(data);\n          }\n        } catch (err) {\n          clearTimeout(timer);\n          failCount++;\n          setStatus(failCount >= 3 ? \"err\" : \"warn\", failCount >= 3 ? \"OFFLINE\" : \"RETRYING\");\n        }\n      }\n\n      poll();\n      setInterval(poll, cfg.poll * 1000);\n    })();\n  </script>\n</body>\n</html>\n";

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
