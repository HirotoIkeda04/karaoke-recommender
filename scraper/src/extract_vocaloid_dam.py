"""DAM ボカロ月間ランキングのキャッシュ HTML から
scraper/output/vocaloid_dam_seed.json を生成する。

scrape_dam.RANKING_PAGES は J-POP 中心構成 (vocaloid を意図的に除外) のため、
ボカロ月間 (cache/dam/vocaloid_monthly.html) は別経路で扱う。

Spotify enrichment 抜きの最小フォーマットで出力する:
    [{title, artist, dam_request_no, source_pages: ["vocaloid_monthly"]}]

実行:
    .venv/bin/python -m extract_vocaloid_dam
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scraper" / "src"))

from scrape_dam import parse_page  # noqa: E402

CACHE_HTML = REPO_ROOT / "scraper" / "cache" / "dam" / "vocaloid_monthly.html"
OUTPUT_JSON = REPO_ROOT / "scraper" / "output" / "vocaloid_dam_seed.json"


def main() -> None:
    if not CACHE_HTML.exists():
        raise SystemExit(f"missing cache: {CACHE_HTML}")
    html = CACHE_HTML.read_text(encoding="utf-8")
    songs = parse_page(html, "vocaloid_monthly")
    print(f"parsed {len(songs)} songs from {CACHE_HTML.name}")

    rows = [
        {
            "title": s.title,
            "artist": s.artist,
            "dam_request_no": s.request_no,
            "source_pages": list(s.source_pages),
        }
        for s in songs
    ]
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(
        json.dumps(
            {
                "songs": rows,
                "metadata": {
                    "source_html": str(CACHE_HTML.relative_to(REPO_ROOT)),
                    "source_pages": ["vocaloid_monthly"],
                    "total_count": len(rows),
                },
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"wrote {len(rows)} rows -> {OUTPUT_JSON.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
