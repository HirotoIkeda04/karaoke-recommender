"""karaoto 由来の既存 597 曲を iTunes ジャケに切り替えるためのバッチ。

現状:
    karaoto seed (songs_seed.json) で投入された 597 曲は Spotify CDN
    (i.scdn.co/...) のジャケ画像を使っている。最大 640x640 で、
    DAM 由来の iTunes 画像 (1200x1200, シングル優先選定) より画質が劣る。

このモジュールが行うこと:
    1. songs_seed.json から (spotify_track_id, title, artist) を読む
    2. 各曲を iTunes で検索 → pick_best_from_raw でシングル優先選定
    3. 結果を output/karaoto_itunes_cache.jsonl (raw schema) に保存
    4. output/karaoto_itunes.json に集約結果を出力
       (TS 側 scripts/refresh-karaoto-images.ts が読んで DB を更新)

実行:
    cd scraper
    uv run python src/refresh_karaoto_itunes.py
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from config import SCRAPER_ROOT
from fetch_itunes import ItunesClient, ItunesRateLimited, ItunesTrack, pick_best_from_raw, upgrade_artwork

logger = logging.getLogger("scraper.karaoto_itunes")


def _load_cache(path: Path) -> dict[str, dict]:
    """spotify_track_id -> entry dict。raw_results を持つ新 schema 前提。"""
    cache: dict[str, dict] = {}
    if not path.exists():
        return cache
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            if "raw_results" in entry:
                cache[entry["spotify_track_id"]] = entry
    return cache


def _append_cache(
    path: Path,
    spotify_track_id: str,
    raw_results: list[dict],
    track: ItunesTrack | None,
) -> None:
    entry = {
        "spotify_track_id": spotify_track_id,
        "raw_results": raw_results,
        "track": dataclasses.asdict(track) if track else None,
    }
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False))
        f.write("\n")


def _build_output_entry(
    seed_song: dict,
    track: ItunesTrack | None,
) -> dict:
    base = {
        "spotify_track_id": seed_song["spotify_track_id"],
        "title": seed_song["title"],
        "artist": seed_song["artist"],
    }
    if track is None:
        base.update({
            "image_url_small": None,
            "image_url_medium": None,
            "image_url_large": None,
            "itunes_track_view_url": None,
            "itunes_release_year": None,
            "itunes_similarity": None,
        })
    else:
        base.update({
            "image_url_small": track.artwork_url_100,
            "image_url_medium": upgrade_artwork(track.artwork_url_100, 600),
            "image_url_large": upgrade_artwork(track.artwork_url_100, 1200),
            "itunes_track_view_url": track.track_view_url,
            "itunes_release_year": track.release_year,
            "itunes_similarity": track.similarity,
        })
    return base


def run() -> int:
    seed_path = SCRAPER_ROOT / "output" / "songs_seed.json"
    seed = json.loads(seed_path.read_text(encoding="utf-8"))
    logger.info("loaded %d karaoto songs from songs_seed.json", len(seed["songs"]))

    output_dir = SCRAPER_ROOT / "output"
    cache_path = output_dir / "karaoto_itunes_cache.jsonl"
    out_path = output_dir / "karaoto_itunes.json"

    cache = _load_cache(cache_path)
    logger.info("itunes cache: %d entries", len(cache))

    client = ItunesClient()
    out_entries: list[dict] = []
    hits = 0
    misses = 0
    cached_used = 0
    rate_limited = False

    for i, song in enumerate(seed["songs"], start=1):
        sid = song.get("spotify_track_id")
        if not sid:
            continue  # spotify_track_id をキーに使うので skip
        title = song["title"]
        artist = song["artist"]
        # karaoto から取れる release_year を expected_year に渡せれば理想だが、
        # songs_seed.json は Spotify 由来 release_year (= Spotify 上のリリース年)
        # しか持っていない。これは「初発売年」とは限らないので、安全のため None
        # にして iTunes 結果の最古 releaseDate を使う。
        expected_year: int | None = None

        track: ItunesTrack | None = None
        if sid in cache:
            cached = cache[sid]
            raw = cached.get("raw_results", [])
            track = pick_best_from_raw(raw, title, artist, expected_year)
            cached_used += 1
        elif rate_limited:
            pass
        else:
            try:
                raw, track = client.search_and_pick(title, artist, expected_year)
            except ItunesRateLimited:
                logger.error(
                    "rate limited at %d/%d; remaining will be empty",
                    i, len(seed["songs"]),
                )
                rate_limited = True
                raw = []
                track = None
            _append_cache(cache_path, sid, raw, track)

        if track is not None:
            hits += 1
        else:
            misses += 1

        if i % 50 == 0:
            logger.info(
                "progress: %d/%d (hits=%d, misses=%d, cache_used=%d)",
                i, len(seed["songs"]), hits, misses, cached_used,
            )

        out_entries.append(_build_output_entry(song, track))

    logger.info(
        "done: hits=%d, misses=%d, cached_used=%d, rate_limited=%s",
        hits, misses, cached_used, rate_limited,
    )

    payload = {
        "songs": out_entries,
        "metadata": {
            "scraped_at": datetime.now(timezone.utc).isoformat(),
            "total_count": len(out_entries),
            "iTunes_hits": hits,
            "iTunes_misses": misses,
        },
    }
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info("wrote %d entries to %s", len(out_entries), out_path)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="karaoto 由来曲を iTunes 画像にリフレッシュ")
    parser.add_argument(
        "--log-level", default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    parser.parse_args(argv)
    logging.basicConfig(
        level="INFO",
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )
    return run()


if __name__ == "__main__":
    sys.exit(main())
