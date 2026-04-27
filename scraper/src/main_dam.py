"""DAM ランキング × iTunes ジャケ画像のパイプライン。

実行:
    cd scraper
    uv run python src/main_dam.py
    uv run python src/main_dam.py --no-itunes  # ジャケ画像取得をスキップ

出力:
    output/dam_songs.json: 全曲(ジャケ取得結果込み)
    output/dam_itunes_cache.jsonl: iTunes クエリ結果の incremental cache
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from config import SCRAPER_ROOT, require
from fetch_itunes import ItunesClient, ItunesRateLimited, ItunesTrack, upgrade_artwork
from fetch_vocal_range import (
    VocalRangeClient,
    VocalRangeMatch,
    VocalRangeRateLimited,
)
from match_karaoto import KaraotoEntry, build_index as build_karaoto_index, lookup as karaoto_lookup
from scrape_dam import DamSong, fetch_all_rankings

logger = logging.getLogger("scraper.dam")


def _load_itunes_cache(path: Path) -> dict[str, dict]:
    """request_no -> iTunes 結果(またはマッチ無しのマーカ)。"""
    cache: dict[str, dict] = {}
    if not path.exists():
        return cache
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            cache[entry["request_no"]] = entry
    return cache


def _append_itunes_cache(path: Path, request_no: str, track: ItunesTrack | None) -> None:
    entry: dict = {"request_no": request_no}
    if track is not None:
        entry["track"] = dataclasses.asdict(track)
    else:
        entry["track"] = None
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False))
        f.write("\n")


def _load_vocal_range_cache(path: Path) -> dict[str, dict | None]:
    """request_no -> match dict (or None)。"""
    cache: dict[str, dict | None] = {}
    if not path.exists():
        return cache
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            cache[entry["request_no"]] = entry["match"]
    return cache


def _append_vocal_range_cache(
    path: Path, request_no: str, match: VocalRangeMatch | None,
) -> None:
    entry = {"request_no": request_no, "match": match.__dict__ if match else None}
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False))
        f.write("\n")


def _enrich_vocal_range(
    songs: list[DamSong],
    karaoto_index: dict,
    contact: str,
    cache_path: Path,
) -> dict[str, VocalRangeMatch | None]:
    """karaoto に無い曲のみ vocal-range.com を引いて結果を返す(request_no キー)。"""
    cache = _load_vocal_range_cache(cache_path)
    logger.info("vocal-range cache: %d entries", len(cache))

    # karaoto に無いものだけ対象
    targets = [
        s for s in songs
        if karaoto_lookup(s.title, s.artist, karaoto_index) is None
    ]
    logger.info("vocal-range targets (no karaoto match): %d/%d", len(targets), len(songs))

    client = VocalRangeClient(contact)
    out: dict[str, VocalRangeMatch | None] = {}
    hits = 0
    misses = 0
    cache_used = 0
    rate_limited = False

    for i, song in enumerate(targets, start=1):
        if song.request_no in cache:
            cached = cache[song.request_no]
            match = VocalRangeMatch(**cached) if cached else None
            cache_used += 1
        elif rate_limited:
            match = None
        else:
            try:
                match = client.best_match(song.title, song.artist)
            except VocalRangeRateLimited:
                logger.error(
                    "vocal-range rate limited at %d/%d; remaining will be left empty",
                    i, len(targets),
                )
                rate_limited = True
                match = None
            _append_vocal_range_cache(cache_path, song.request_no, match)

        out[song.request_no] = match
        if match:
            hits += 1
        else:
            misses += 1

        if i % 25 == 0:
            logger.info(
                "vocal-range progress: %d/%d (hits=%d, misses=%d, cache_used=%d)",
                i, len(targets), hits, misses, cache_used,
            )

    logger.info(
        "vocal-range done: hits=%d, misses=%d, cached_used=%d, rate_limited=%s",
        hits, misses, cache_used, rate_limited,
    )
    return out


def _build_payload(
    song: DamSong,
    track: ItunesTrack | None,
    karaoto: KaraotoEntry | None,
    vocal_range: VocalRangeMatch | None,
) -> dict:
    """1 曲分の出力 payload (seed-dam-songs.ts が読み込む形)。

    range の優先度: karaoto > vocal-range.com (karaoto は手動キュレーションで
    精度が高いため。vocal-range は補助フォールバック)。
    """
    range_low = karaoto.range_low_midi if karaoto else None
    range_high = karaoto.range_high_midi if karaoto else None
    falsetto = karaoto.falsetto_max_midi if karaoto else None
    if vocal_range is not None:
        if range_low is None:
            range_low = vocal_range.range_low_midi
        if range_high is None:
            range_high = vocal_range.range_high_midi
        if falsetto is None:
            falsetto = vocal_range.falsetto_max_midi

    base: dict = {
        "title": song.title,
        "artist": song.artist,
        "dam_request_no": song.request_no,
        "source_pages": list(song.source_pages),
        "range_low_midi": range_low,
        "range_high_midi": range_high,
        "falsetto_max_midi": falsetto,
        "karaoto_source_url": karaoto.source_url if karaoto else None,
        "vocal_range_source_url": vocal_range.source_url if vocal_range else None,
    }
    if track is not None:
        # サイズ方針:
        #   small  = 100x100 (リスト thumbnail 48px native ≈ 96 retina)
        #   medium = 600x600 (スワイプカード 22rem ≈ 352 native ≈ 700 retina)
        #   large  = 1200x1200 (詳細ページ全画面 + retina)
        # iTunes は URL 末尾の `100x100bb` を任意サイズに書き換えれば再エンコード
        # 済みの解像度を返すため、追加 API call なしで取得できる。
        base.update({
            "release_year": track.release_year,
            "image_url_small": track.artwork_url_100,
            "image_url_medium": upgrade_artwork(track.artwork_url_100, 600),
            "image_url_large": upgrade_artwork(track.artwork_url_100, 1200),
            "itunes_track_view_url": track.track_view_url,
            "itunes_similarity": track.similarity,
        })
    else:
        base.update({
            "release_year": None,
            "image_url_small": None,
            "image_url_medium": None,
            "image_url_large": None,
            "itunes_track_view_url": None,
            "itunes_similarity": None,
        })
    return base


def run(*, fetch_itunes: bool = True) -> int:
    contact = require("SCRAPER_CONTACT_EMAIL")

    cache_dir = SCRAPER_ROOT / "cache" / "dam"
    output_dir = SCRAPER_ROOT / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    # Step 1: DAM ランキングページから全曲取得
    songs = fetch_all_rankings(cache_dir, contact)
    logger.info("DAM rankings yielded %d unique songs", len(songs))

    # Step 1.5: karaoto キャッシュから (title, artist) インデックスを構築
    # → DAM 曲のうち karaoto にも載っている曲は range_*_midi を補完できる
    karaoto_cache_dir = SCRAPER_ROOT / "cache" / "karaoto"
    karaoto_index = build_karaoto_index(karaoto_cache_dir, contact)
    karaoto_hits = sum(
        1 for s in songs if karaoto_lookup(s.title, s.artist, karaoto_index)
    )
    logger.info(
        "karaoto cross-ref: %d/%d DAM songs have range data",
        karaoto_hits, len(songs),
    )

    # Step 1.6: karaoto に無い曲は vocal-range.com (J-POP 音域の沼) を試す
    # ここはネット呼び出しが発生するためキャッシュ前提。--no-vocal-range で skip 可。
    vocal_range_cache_path = output_dir / "dam_vocal_range_cache.jsonl"
    vocal_range_lookups: dict[str, VocalRangeMatch | None] = _enrich_vocal_range(
        songs, karaoto_index, contact, vocal_range_cache_path,
    )

    # Step 2: iTunes でジャケ + 年情報を補完
    payloads: list[dict] = []
    if not fetch_itunes:
        logger.info("--no-itunes specified, skipping artwork enrichment")
        payloads = [
            _build_payload(
                s, None,
                karaoto_lookup(s.title, s.artist, karaoto_index),
                vocal_range_lookups.get(s.request_no),
            )
            for s in songs
        ]
    else:
        cache_path = output_dir / "dam_itunes_cache.jsonl"
        cache = _load_itunes_cache(cache_path)
        logger.info("itunes cache: %d entries", len(cache))

        client = ItunesClient()
        hits = 0
        misses = 0
        cached_used = 0
        rate_limited = False
        for i, song in enumerate(songs, start=1):
            track: ItunesTrack | None = None
            if song.request_no in cache:
                cached = cache[song.request_no]["track"]
                if cached:
                    track = ItunesTrack(**cached)
                cached_used += 1
            elif rate_limited:
                # 429 検知後はそれ以降の API call を行わない(キャッシュ無しは未取得扱い)
                pass
            else:
                try:
                    track = client.best_match(song.title, song.artist)
                except ItunesRateLimited:
                    logger.error(
                        "iTunes rate limited at %d/%d; remaining will be saved without artwork",
                        i, len(songs),
                    )
                    rate_limited = True
                _append_itunes_cache(cache_path, song.request_no, track)

            if track is not None:
                hits += 1
            else:
                misses += 1

            if i % 25 == 0:
                logger.info(
                    "progress: %d/%d (hits=%d, misses=%d, cache_used=%d)",
                    i, len(songs), hits, misses, cached_used,
                )

            payloads.append(_build_payload(
                song, track,
                karaoto_lookup(song.title, song.artist, karaoto_index),
                vocal_range_lookups.get(song.request_no),
            ))

        logger.info(
            "iTunes done: hits=%d, misses=%d, cached_used=%d, rate_limited=%s",
            hits, misses, cached_used, rate_limited,
        )

    # Step 3: JSON 出力
    out_path = output_dir / "dam_songs.json"
    payload = {
        "songs": payloads,
        "metadata": {
            "scraped_at": datetime.now(timezone.utc).isoformat(),
            "total_count": len(payloads),
            "sources": ["clubdam.com", "itunes.apple.com"] if fetch_itunes else ["clubdam.com"],
        },
    }
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info("wrote %d songs to %s", len(payloads), out_path)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="DAM ランキング × iTunes 取り込み")
    parser.add_argument(
        "--no-itunes", action="store_true",
        help="iTunes での画像/年補完をスキップ(高速確認用)",
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

    return run(fetch_itunes=not args.no_itunes)


if __name__ == "__main__":
    sys.exit(main())
