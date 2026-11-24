"""Embed web/index.html into cloudflare/worker.js for zero-dependency deployment."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML_PATH = ROOT / "web" / "index.html"
TEMPLATE_PATH = ROOT / "cloudflare" / "worker_template.js"
OUT_PATH = ROOT / "cloudflare" / "worker.js"


def main() -> None:
    html = HTML_PATH.read_text(encoding="utf-8")
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    if "__INDEX_HTML__" not in template:
        raise RuntimeError("Placeholder __INDEX_HTML__ not found in worker_template.js")
    output = template.replace("__INDEX_HTML__", json.dumps(html), 1)
    OUT_PATH.write_text(output, encoding="utf-8")
    print(f"Built {OUT_PATH} ({len(output):,} bytes)")


if __name__ == "__main__":
    main()
