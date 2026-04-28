"""DB の range NULL 曲に対して複数音域サイトを試行して埋めるバッチ。

仕様:
    - Supabase REST から range_high_midi IS NULL 曲を取得 (release_year DESC)
    - 各曲につきソース順に試行: vocal-range.com → keytube.net
    - per-song time budget (デフォルト 15s) を超えたら諦める
    - 結果を range_results.jsonl に逐次追記 (cache + 結果出力兼用)
    - 年が変わるたびに range_results.json を checkpoint 書き出し
      (TS 側で `pnpm apply:range` を回すと incremental 反映)

実行:
    cd scraper
    uv run python src/refresh_range_data.py
    uv run python src/refresh_range_data.py --budget 20 --limit 100  # 試運転
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import logging
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import quote

import requests

from config import PROJECT_ROOT, SCRAPER_ROOT, require
from fetch_keytube import KeyTubeClient, KeyTubeMatch, KeyTubeRateLimited
from fetch_vocal_range import VocalRangeClient, VocalRangeMatch, VocalRangeRateLimited

logger = logging.getLogger("scraper.refresh_range")

DEFAULT_BUDGET_SEC = 15.0


@dataclasses.dataclass(frozen=True)
class _RangeResult:
    range_low_midi: int | None
    range_high_midi: int | None
    falsetto_max_midi: int | None
    source: str          # "vocal-range" or "keytube"
    source_url: str
    similarity: float


def _to_result(m: VocalRangeMatch | KeyTubeMatch | None, source: str) -> _RangeResult | None:
    if m is None:
        return None
    if m.range_high_midi is None and m.range_low_midi is None and m.falsetto_max_midi is None:
        return None
    return _RangeResult(
        range_low_midi=m.range_low_midi,
        range_high_midi=m.range_high_midi,
        falsetto_max_midi=m.falsetto_max_midi,
        source=source,
        source_url=m.source_url,
        similarity=m.similarity,
    )


def _load_env_supabase() -> tuple[str, str]:
    """親 .env.local から Supabase URL + service_role key を読む。"""
    env_path = PROJECT_ROOT / ".env.local"
    url = key = None
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k == "NEXT_PUBLIC_SUPABASE_URL":
                url = v
            elif k == "SUPABASE_SERVICE_ROLE_KEY":
                key = v
    if not url or not key:
        raise RuntimeError(
            "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が .env.local に見当たりません"
        )
    return url, key


def _fetch_null_range_songs(supabase_url: str, service_key: str) -> list[dict]:
    """release_year DESC で range_high_midi NULL 曲を全取得。"""
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Accept": "application/json",
    }
    out: list[dict] = []
    # PostgREST のページサイズ上限 (default 1000)。逐次取得。
    page_size = 1000
    offset = 0
    while True:
        url = (
            f"{supabase_url}/rest/v1/songs?"
            f"select=id,title,artist,release_year,range_low_midi,range_high_midi,falsetto_max_midi"
            f"&range_high_midi=is.null"
            f"&order=release_year.desc.nullslast,title.asc"
            f"&limit={page_size}&offset={offset}"
        )
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        rows = resp.json()
        if not rows:
            break
        out.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size
    return out


def _load_results_cache(path: Path) -> dict[str, dict]:
    """song_id -> entry。append-only jsonl の last-write-wins。"""
    cache: dict[str, dict] = {}
    if not path.exists():
        return cache
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            cache[entry["id"]] = entry
    return cache


def _append_result(path: Path, entry: dict) -> None:
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False))
        f.write("\n")


def _write_checkpoint_json(
    path: Path,
    cache: dict[str, dict],
    scraped_at: datetime,
) -> None:
    """全 cache を集約 JSON に書き出す (TS 側 apply 用)。"""
    songs: list[dict] = []
    for entry in cache.values():
        result = entry.get("result")
        if result is None:
            continue  # 試したけど見つからなかった曲は apply 不要
        songs.append({
            "id": entry["id"],
            "title": entry.get("title"),
            "artist": entry.get("artist"),
            "release_year": entry.get("release_year"),
            **result,
        })
    payload = {
        "songs": songs,
        "metadata": {
            "scraped_at": scraped_at.isoformat(),
            "applied_count": len(songs),
            "tried_total": len(cache),
        },
    }
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _try_sources(
    title: str,
    artist: str,
    vocal_range: VocalRangeClient,
    keytube: KeyTubeClient,
    budget_sec: float,
) -> _RangeResult | None:
    """budget 内で各ソースを順次試行。最初のヒットを返す。"""
    start = time.monotonic()

    # 1) vocal-range.com
    if time.monotonic() - start < budget_sec:
        try:
            m = vocal_range.best_match(title, artist)
        except VocalRangeRateLimited:
            m = None
            logger.warning("vocal-range rate limited")
        r = _to_result(m, "vocal-range")
        if r and r.range_high_midi is not None:
            return r

    # 2) keytube.net
    if time.monotonic() - start < budget_sec:
        try:
            m2 = keytube.best_match(title, artist, fetch_falsetto=True)
        except KeyTubeRateLimited:
            m2 = None
            logger.warning("keytube rate limited")
        r2 = _to_result(m2, "keytube")
        if r2 and r2.range_high_midi is not None:
            return r2

    # 1 件目が部分ヒット (例えば low だけ取れた) なら r を返す
    return r if 'r' in locals() and r else None


def run(*, budget_sec: float = DEFAULT_BUDGET_SEC, limit: int | None = None) -> int:
    contact = require("SCRAPER_CONTACT_EMAIL")
    supabase_url, service_key = _load_env_supabase()

    output_dir = SCRAPER_ROOT / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    cache_path = output_dir / "range_results_cache.jsonl"
    checkpoint_path = output_dir / "range_results.json"

    songs = _fetch_null_range_songs(supabase_url, service_key)
    logger.info("DB: %d songs need range data", len(songs))
    if limit:
        songs = songs[:limit]
        logger.info("--limit %d 適用", limit)

    cache = _load_results_cache(cache_path)
    logger.info("results cache: %d entries", len(cache))

    vocal_range = VocalRangeClient(contact)
    keytube = KeyTubeClient()

    scraped_at = datetime.now(timezone.utc)
    hits = misses = cached_used = 0
    prev_year: int | None = None
    processed = 0

    for i, song in enumerate(songs, start=1):
        sid = song["id"]
        cur_year = song.get("release_year")
        # 年境界 → checkpoint 書き出し (newest first)
        if prev_year is not None and cur_year != prev_year:
            _write_checkpoint_json(checkpoint_path, cache, scraped_at)
            year_label = "?" if prev_year is None else str(prev_year)
            logger.info(
                "CHECKPOINT: year %s done. range_results.json: %d hits / %d tried",
                year_label,
                sum(1 for v in cache.values() if v.get("result")),
                len(cache),
            )

        if sid in cache:
            cached_used += 1
            if cache[sid].get("result"):
                hits += 1
            else:
                misses += 1
        else:
            result = _try_sources(
                song["title"], song["artist"],
                vocal_range, keytube, budget_sec,
            )
            entry = {
                "id": sid,
                "title": song["title"],
                "artist": song["artist"],
                "release_year": cur_year,
                "result": dataclasses.asdict(result) if result else None,
            }
            _append_result(cache_path, entry)
            cache[sid] = entry
            processed += 1
            if result is not None:
                hits += 1
            else:
                misses += 1

        if i % 25 == 0:
            logger.info(
                "progress: %d/%d (hits=%d misses=%d cached_used=%d new=%d)",
                i, len(songs), hits, misses, cached_used, processed,
            )
        prev_year = cur_year

    # 最終 checkpoint
    _write_checkpoint_json(checkpoint_path, cache, scraped_at)
    logger.info(
        "done: hits=%d misses=%d (cached_used=%d, new=%d) wrote %s",
        hits, misses, cached_used, processed, checkpoint_path,
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="DB の range NULL 曲を音域サイトで補完")
    parser.add_argument(
        "--budget", type=float, default=DEFAULT_BUDGET_SEC,
        help=f"per-song timeout 秒 (default: {DEFAULT_BUDGET_SEC})",
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="先頭 N 曲だけ処理 (試運転用)",
    )
    parser.add_argument(
        "--log-level", default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=args.log_level,
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )
    return run(budget_sec=args.budget, limit=args.limit)


if __name__ == "__main__":
    sys.exit(main())
