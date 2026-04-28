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
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from config import SCRAPER_ROOT, require
from fetch_itunes import (
    ItunesClient,
    ItunesRateLimited,
    ItunesTrack,
    is_cached_track_karaoke,
    pick_best_from_raw,
    upgrade_artwork,
)
from fetch_vocal_range import (
    VocalRangeClient,
    VocalRangeMatch,
    VocalRangeRateLimited,
)
from match_karaoto import KaraotoEntry, build_index as build_karaoto_index, lookup as karaoto_lookup
from scrape_dam import DamSong, fetch_all_rankings
from scrape_dam_generation import (
    DEFAULT_YEAR_RANGE,
    GENRE_CODES,
    fetch_all_generations,
)

logger = logging.getLogger("scraper.dam")


def _load_itunes_cache(path: Path) -> dict[str, dict]:
    """request_no -> エントリ全体 (raw_results を持つ場合とレガシー含む)。

    キャッシュ schema (新):
        {"request_no": "...", "raw_results": [...iTunes raw...]}
        → 読み込み後にローカルで pick_best_from_raw を再評価する。
        ロジック変更時に再 fetch 不要。

    キャッシュ schema (旧):
        {"request_no": "...", "track": {...選定済 ItunesTrack dict...}}
        → raw を持たないため、新ロジックで再評価できない。skip して再 fetch。

    また、artistName/trackName でカラオケ判定されるエントリも skip (ロジック
    更新前に汚染データが入っていた場合の自動修正)。
    """
    cache: dict[str, dict] = {}
    legacy_skipped = 0
    karaoke_invalidated = 0
    if not path.exists():
        return cache
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            if "raw_results" not in entry:
                # レガシー schema → 再 fetch
                legacy_skipped += 1
                continue
            track = entry.get("track")
            if track is not None and is_cached_track_karaoke(track):
                karaoke_invalidated += 1
                continue
            cache[entry["request_no"]] = entry
    if legacy_skipped:
        logger.info(
            "itunes cache: skipped %d legacy entries (will be refetched with raw schema)",
            legacy_skipped,
        )
    if karaoke_invalidated:
        logger.info(
            "itunes cache: invalidated %d entries detected as karaoke/cover",
            karaoke_invalidated,
        )
    return cache


def _append_itunes_cache(
    path: Path,
    request_no: str,
    raw_results: list[dict],
    track: ItunesTrack | None,
) -> None:
    """raw 結果と選定済 track を保存。schema 変更時の再 fetch を不要にする。"""
    entry: dict = {
        "request_no": request_no,
        "raw_results": raw_results,
        "track": dataclasses.asdict(track) if track else None,
    }
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


_RE_GEN_YEAR = re.compile(r"^gen_(\d{4})_")


def _latest_year(song: DamSong) -> int:
    """source_pages から最新の generation 年を返す。

    rankings のみの曲 (gen_YYYY_NNN を含まない) は 9999 を返し、
    年降順ソートで先頭に来るようにする(= 最も新しい扱い)。
    """
    years: list[int] = []
    for p in song.source_pages:
        m = _RE_GEN_YEAR.match(p)
        if m:
            years.append(int(m.group(1)))
    return max(years) if years else 9999


def _write_dam_songs_json(
    payloads: list[dict],
    out_path: Path,
    scraped_at: datetime,
    fetch_itunes: bool,
) -> None:
    payload = {
        "songs": payloads,
        "metadata": {
            "scraped_at": scraped_at.isoformat(),
            "total_count": len(payloads),
            "sources": (
                ["clubdam.com", "itunes.apple.com"] if fetch_itunes else ["clubdam.com"]
            ),
        },
    }
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _merge_song_lists(*lists: list[DamSong]) -> list[DamSong]:
    """複数の DamSong list を (title, artist, request_no) でユニーク化、source_pages を統合。"""
    by_key: dict[tuple[str, str, str], DamSong] = {}
    for songs in lists:
        for s in songs:
            key = (s.title, s.artist, s.request_no)
            if key in by_key:
                by_key[key] = DamSong(
                    title=s.title,
                    artist=s.artist,
                    request_no=s.request_no,
                    source_pages=by_key[key].source_pages + s.source_pages,
                )
            else:
                by_key[key] = s
    return list(by_key.values())


def run(
    *,
    fetch_itunes: bool = True,
    fetch_vocal_range: bool = True,
    generation_genres: list[str] | None = None,
    generation_years: list[int] | None = None,
) -> int:
    """DAM ランキング + (任意で) /generation/ ページをマージ取得し、
    karaoto/vocal-range で音域、iTunes でジャケを補完して JSON 出力する。

    Args:
        generation_genres: 取得する genreCode のリスト (例: ['001', '005'])。
            None なら /generation/ は skip。
        generation_years: 取得する年のリスト。None なら DEFAULT_YEAR_RANGE (1949-2025) 全部。
    """
    contact = require("SCRAPER_CONTACT_EMAIL")

    cache_dir = SCRAPER_ROOT / "cache" / "dam"
    output_dir = SCRAPER_ROOT / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    # Step 1a: DAM 既存ランキングページから取得
    rankings_songs = fetch_all_rankings(cache_dir, contact)
    logger.info("DAM rankings yielded %d unique songs", len(rankings_songs))

    # Step 1b: /generation/ から年×ジャンル網羅取得 (オプション)
    if generation_genres:
        gen_cache_dir = SCRAPER_ROOT / "cache" / "dam" / "generation"
        years = generation_years if generation_years else DEFAULT_YEAR_RANGE
        logger.info(
            "fetching DAM /generation/: %d years × %d genres = %d pages",
            len(years), len(generation_genres), len(years) * len(generation_genres),
        )
        gen_songs = fetch_all_generations(
            gen_cache_dir, contact, years=years, genre_codes=generation_genres,
        )
        logger.info("DAM generation yielded %d unique songs", len(gen_songs))
        songs = _merge_song_lists(rankings_songs, gen_songs)
        logger.info("merged total: %d unique songs", len(songs))
    else:
        songs = rankings_songs

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
    vocal_range_lookups: dict[str, VocalRangeMatch | None]
    if fetch_vocal_range:
        vocal_range_cache_path = output_dir / "dam_vocal_range_cache.jsonl"
        vocal_range_lookups = _enrich_vocal_range(
            songs, karaoto_index, contact, vocal_range_cache_path,
        )
    else:
        logger.info("--no-vocal-range specified, skipping vocal-range.com fallback")
        vocal_range_lookups = {}

    # Step 2: iTunes でジャケ + 年情報を補完
    # 年降順 (新しい順) でソートし、年が変わるたびに dam_songs.json を
    # チェックポイント書き出しすることで、長時間 run の途中で
    # `pnpm seed:dam --keep-orphans` で部分的に DB 反映できる。
    out_path = output_dir / "dam_songs.json"
    scraped_at = datetime.now(timezone.utc)

    songs_sorted = sorted(songs, key=lambda s: -_latest_year(s))

    payloads: list[dict] = []
    if not fetch_itunes:
        logger.info("--no-itunes specified, skipping artwork enrichment")
        for s in songs_sorted:
            payloads.append(_build_payload(
                s, None,
                karaoto_lookup(s.title, s.artist, karaoto_index),
                vocal_range_lookups.get(s.request_no),
            ))
        _write_dam_songs_json(payloads, out_path, scraped_at, fetch_itunes=False)
        logger.info("wrote %d songs to %s", len(payloads), out_path)
        return 0

    cache_path = output_dir / "dam_itunes_cache.jsonl"
    cache = _load_itunes_cache(cache_path)
    logger.info("itunes cache: %d entries", len(cache))

    client = ItunesClient()
    hits = 0
    misses = 0
    cached_used = 0
    rate_limited = False
    prev_year: int | None = None
    for i, song in enumerate(songs_sorted, start=1):
        cur_year = _latest_year(song)
        if prev_year is not None and cur_year != prev_year:
            # 年境界 → チェックポイント書き出し
            _write_dam_songs_json(payloads, out_path, scraped_at, fetch_itunes=True)
            year_label = "rankings" if prev_year == 9999 else str(prev_year)
            logger.info(
                "CHECKPOINT: year %s done. dam_songs.json: %d songs (incremental seed:dam --keep-orphans が安全)",
                year_label, len(payloads),
            )

        track: ItunesTrack | None = None
        karaoto_entry = karaoto_lookup(song.title, song.artist, karaoto_index)
        expected_year: int | None = None
        if karaoto_entry and karaoto_entry.source_url:
            pass

        if song.request_no in cache:
            cached = cache[song.request_no]
            raw_results = cached.get("raw_results", [])
            track = pick_best_from_raw(
                raw_results, song.title, song.artist, expected_year,
            )
            cached_used += 1
        elif rate_limited:
            pass
        else:
            try:
                raw_results, track = client.search_and_pick(
                    song.title, song.artist, expected_year,
                )
            except ItunesRateLimited:
                raw_results = []
                track = None
                logger.error(
                    "iTunes rate limited at %d/%d; remaining will be saved without artwork",
                    i, len(songs_sorted),
                )
                rate_limited = True
            _append_itunes_cache(cache_path, song.request_no, raw_results, track)

        if track is not None:
            hits += 1
        else:
            misses += 1

        if i % 25 == 0:
            logger.info(
                "progress: %d/%d (hits=%d, misses=%d, cache_used=%d)",
                i, len(songs_sorted), hits, misses, cached_used,
            )

        payloads.append(_build_payload(
            song, track, karaoto_entry,
            vocal_range_lookups.get(song.request_no),
        ))
        prev_year = cur_year

    # 最後の年もチェックポイントとして書き出す (= 最終 JSON)
    _write_dam_songs_json(payloads, out_path, scraped_at, fetch_itunes=True)
    logger.info(
        "iTunes done: hits=%d, misses=%d, cached_used=%d, rate_limited=%s",
        hits, misses, cached_used, rate_limited,
    )
    logger.info("wrote %d songs to %s (final)", len(payloads), out_path)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="DAM ランキング × iTunes 取り込み")
    parser.add_argument(
        "--no-itunes", action="store_true",
        help="iTunes での画像/年補完をスキップ(高速確認用)",
    )
    parser.add_argument(
        "--no-vocal-range", action="store_true",
        help="vocal-range.com での音域フォールバックをスキップ(古い曲ばかりの run で時間節約)",
    )
    parser.add_argument(
        "--generation-genres",
        default="",
        help=(
            "DAM /generation/ から取得するジャンルコード (カンマ区切り)。"
            "例: '001' でヒット曲のみ、'001,002,003,004,005' で全 5 ジャンル。"
            "未指定なら /generation/ は skip。"
            f"利用可能: {', '.join(f'{k}={v}' for k, v in GENRE_CODES.items())}"
        ),
    )
    parser.add_argument(
        "--generation-years",
        default="",
        help="取得年範囲 (カンマ区切り or START-END)。例: '1949-2025' or '2010,2015,2020'。未指定なら 1949-2025 全部。",
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

    genres: list[str] | None = None
    if args.generation_genres:
        genres = [g.strip() for g in args.generation_genres.split(",") if g.strip()]
        unknown = [g for g in genres if g not in GENRE_CODES]
        if unknown:
            parser.error(f"unknown generation genre code(s): {unknown}. "
                         f"valid: {list(GENRE_CODES.keys())}")

    years: list[int] | None = None
    if args.generation_years:
        spec = args.generation_years.strip()
        if "-" in spec and "," not in spec:
            start, end = spec.split("-", 1)
            years = list(range(int(start), int(end) + 1))
        else:
            years = [int(y) for y in spec.split(",") if y.strip()]

    return run(
        fetch_itunes=not args.no_itunes,
        fetch_vocal_range=not args.no_vocal_range,
        generation_genres=genres,
        generation_years=years,
    )


if __name__ == "__main__":
    sys.exit(main())
