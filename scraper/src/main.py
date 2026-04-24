"""オーケストレーション: カラ音取得 → Spotify マッチ → 成果物出力。

使い方:
    cd scraper
    uv run python src/main.py               # 代表曲 (is_featured=True) のみ
    uv run python src/main.py --all         # 全 3000+ 曲
    uv run python src/main.py --limit 20    # 20 曲だけ (動作確認用)
"""

from __future__ import annotations

import argparse
import csv
import dataclasses
import json
import logging
import sys
import time
import warnings
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from config import SCRAPER_ROOT, require
from fetch_spotify import SpotifyClient, SpotifyQuotaExceeded, SpotifyTrack
from matcher import Matcher, MatchResult, load_aliases
from models import EnrichedSong, RawSong
from scrape_karaoto import fetch_all_pages, parse_all

# urllib3 の LibreSSL 警告を抑制
warnings.filterwarnings("ignore", message="urllib3 v2 only supports OpenSSL")

logger = logging.getLogger("scraper")

SPOTIFY_REQUEST_INTERVAL_SEC = 0.5  # Spotify への間隔 (1 曲あたり複数 call する場合あり)


def _match_cache_key(song: RawSong) -> str:
    return f"{song.title}\t{song.artist}"


def _load_match_cache(path: Path) -> dict[str, dict]:
    """前回までに取れた matched の結果をロード。キーは (title, artist)。"""
    cache: dict[str, dict] = {}
    if not path.exists():
        return cache
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            cache[f"{entry['title']}\t{entry['artist']}"] = entry
    return cache


def _append_match_cache(path: Path, result: MatchResult) -> None:
    """確定した match 結果を jsonl 形式で逐次追記。"""
    track = result.track
    if track is None:
        return
    entry = {
        "title": result.raw_song.title,
        "artist": result.raw_song.artist,
        "strategy": result.strategy,
        "similarity": result.similarity,
        "track": dataclasses.asdict(track),
    }
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False))
        f.write("\n")


def _result_from_cache(song: RawSong, entry: dict) -> MatchResult:
    track = SpotifyTrack(**entry["track"])
    return MatchResult(
        raw_song=song,
        track=track,
        similarity=entry.get("similarity", 1.0),
        strategy=entry.get("strategy", "cached"),
    )


def _build_enriched(result: MatchResult) -> EnrichedSong:
    """MatchResult から EnrichedSong (= 最終出力 1 行) を組み立てる。"""
    song = result.raw_song
    track = result.track
    assert track is not None, "build only after matched=True"  # noqa: S101
    return EnrichedSong(
        title=song.title,
        artist=song.artist,
        release_year=track.release_year,
        range_low_midi=song.range_low_midi,
        range_high_midi=song.range_high_midi,
        falsetto_max_midi=song.falsetto_max_midi,
        spotify_track_id=track.id,
        image_url_large=track.image_url_large,
        image_url_medium=track.image_url_medium,
        image_url_small=track.image_url_small,
        source_urls=[
            song.source_url,
            f"https://open.spotify.com/track/{track.id}",
        ],
    )


def _write_songs_seed(
    enriched: list[EnrichedSong], path: Path, scraped_at: datetime
) -> None:
    payload = {
        "songs": [dataclasses.asdict(s) for s in enriched],
        "metadata": {
            "scraped_at": scraped_at.isoformat(),
            "total_count": len(enriched),
            "sources": ["karaoto.net", "spotify"],
        },
    }
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info("wrote %d songs to %s", len(enriched), path)


def _write_unmatched_csv(unmatched: list[MatchResult], path: Path) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["title", "artist", "karaoto_url", "reason"])
        for r in unmatched:
            writer.writerow(
                [r.raw_song.title, r.raw_song.artist, r.raw_song.source_url, r.reason]
            )
    logger.info("wrote %d unmatched rows to %s", len(unmatched), path)


def _write_report(
    total: int,
    matched: list[MatchResult],
    unmatched: list[MatchResult],
    elapsed_sec: float,
    path: Path,
    scraped_at: datetime,
    partial: bool = False,
) -> None:
    strategies = Counter(r.strategy for r in matched)
    pct = (len(matched) / total * 100) if total else 0.0
    title = "スクレイピングレポート"
    if partial:
        title += " [中断: Spotify quota 超過]"
    lines = [
        f"# {title} {scraped_at.strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "## 取得結果",
        f"- カラ音: 14 ページ / {total} 曲 処理",
        f"- Spotify マッチ成功: {len(matched)} 曲 ({pct:.1f}%)",
        f"- 未マッチ: {len(unmatched)} 曲 (unmatched.csv)",
        "",
        "## 採用戦略内訳",
    ]
    for strategy, count in strategies.most_common():
        lines.append(f"- {strategy}: {count}")
    lines += [
        "",
        "## 所要時間",
        f"- 合計: {elapsed_sec / 60:.1f} 分 ({elapsed_sec:.1f} 秒)",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")
    logger.info("wrote report to %s", path)


def run(
    *,
    featured_only: bool = True,
    limit: int | None = None,
    output_dir: Path | None = None,
    cache_dir: Path | None = None,
) -> int:
    started_at = time.monotonic()
    scraped_at = datetime.now(timezone.utc)

    cache_dir = cache_dir or (SCRAPER_ROOT / "cache" / "karaoto")
    output_dir = output_dir or (SCRAPER_ROOT / "output")
    output_dir.mkdir(parents=True, exist_ok=True)

    contact = require("SCRAPER_CONTACT_EMAIL")
    spotify_id = require("SPOTIFY_CLIENT_ID")
    spotify_secret = require("SPOTIFY_CLIENT_SECRET")

    logger.info("step 1-2: fetch + parse karaoto pages")
    htmls = fetch_all_pages(cache_dir, contact)
    all_songs: list[RawSong] = parse_all(htmls)
    logger.info("parsed %d raw songs", len(all_songs))

    songs = [s for s in all_songs if s.is_featured] if featured_only else all_songs
    logger.info(
        "filter featured=%s -> %d songs",
        featured_only, len(songs),
    )
    if limit is not None:
        songs = songs[:limit]
        logger.info("limited to first %d songs", limit)

    logger.info("step 3: spotify matching")
    aliases = load_aliases(SCRAPER_ROOT / "artist_alias.json")
    client = SpotifyClient(spotify_id, spotify_secret)
    matcher = Matcher(client, aliases=aliases)

    cache_path = output_dir / "match_cache.jsonl"
    match_cache = _load_match_cache(cache_path)
    if match_cache:
        logger.info("resume: loaded %d cached matches", len(match_cache))

    matched: list[MatchResult] = []
    unmatched: list[MatchResult] = []
    quota_hit = False
    processed = 0
    for i, song in enumerate(songs, start=1):
        cached = match_cache.get(_match_cache_key(song))
        if cached is not None:
            matched.append(_result_from_cache(song, cached))
            continue

        try:
            result = matcher.match(song)
        except SpotifyQuotaExceeded as e:
            logger.error(
                "spotify quota exceeded at song %d/%d (retry_after=%ds); "
                "writing partial results",
                i, len(songs), e.retry_after_sec,
            )
            quota_hit = True
            break

        if result.matched:
            matched.append(result)
            _append_match_cache(cache_path, result)
        else:
            unmatched.append(result)
        processed += 1
        if i % 50 == 0:
            logger.info(
                "progress: %d/%d (matched=%d, unmatched=%d)",
                i, len(songs), len(matched), len(unmatched),
            )
        time.sleep(SPOTIFY_REQUEST_INTERVAL_SEC)

    logger.info("step 4-5: write outputs (partial=%s)", quota_hit)
    enriched = [_build_enriched(r) for r in matched]
    _write_songs_seed(enriched, output_dir / "songs_seed.json", scraped_at)
    _write_unmatched_csv(unmatched, output_dir / "unmatched.csv")

    elapsed = time.monotonic() - started_at
    _write_report(
        len(songs), matched, unmatched, elapsed,
        output_dir / "scraping_report.md", scraped_at,
        partial=quota_hit,
    )
    logger.info(
        "done: %d matched / %d unmatched / %.1f sec (new_calls=%d, partial=%s)",
        len(matched), len(unmatched), elapsed, processed, quota_hit,
    )
    return 2 if quota_hit else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="カラオケ楽曲マスタ収集")
    parser.add_argument(
        "--all", action="store_true",
        help="代表曲に限定せず全曲を処理",
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="先頭 N 曲だけ処理 (動作確認用)",
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

    return run(featured_only=not args.all, limit=args.limit)


if __name__ == "__main__":
    sys.exit(main())
