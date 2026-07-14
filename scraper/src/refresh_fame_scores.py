"""Wikipedia fame を対象曲だけ安全に再取得し、JSONL キャッシュを更新する。

`fame_score=0` や NULL は過去の解決失敗を含むため、永続キャッシュから自動的に
除外せず、artist/title フィルタで明示的に再取得できるようにする。既存出力は
追記ではなくキー単位で置換し、一時ファイルから atomic replace する。

例:
  cd scraper
  uv run python src/refresh_fame_scores.py --artist 嵐 \
    --output /tmp/arashi_fame.jsonl
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import unicodedata
from collections.abc import Iterable
from pathlib import Path

from fetch_wikipedia_fame import (
    FameResult,
    PageviewsUnavailableError,
    WikipediaClient,
)

SCRAPER_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT_PATH = SCRAPER_ROOT / "output" / "karaoke_features.jsonl"
DEFAULT_OUTPUT_PATH = SCRAPER_ROOT / "output" / "fame_cache.jsonl"


def _load_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    if not path.exists():
        return rows
    with path.open(encoding="utf-8") as input_file:
        for line_number, line in enumerate(input_file, start=1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"{path}:{line_number}: invalid JSON") from error
            if not isinstance(row, dict):
                raise ValueError(f"{path}:{line_number}: JSON object required")
            rows.append(row)
    return rows


def _normalize(value: str) -> str:
    return unicodedata.normalize("NFKC", value).casefold().strip()


def _cache_key(row: dict) -> str:
    song_id = row.get("song_id")
    if isinstance(song_id, str) and song_id:
        return f"id:{song_id}"
    return f"name:{_normalize(str(row.get('artist', '')))}|{_normalize(str(row.get('title', '')))}"


def _merge_records(existing: Iterable[dict], updates: Iterable[dict]) -> list[dict]:
    """既存順を保ったまま更新行を置換し、新規行だけ末尾に追加する。"""
    update_by_key = {_cache_key(row): row for row in updates}
    merged: list[dict] = []
    consumed: set[str] = set()
    for row in existing:
        key = _cache_key(row)
        if key in update_by_key:
            if key not in consumed:
                merged.append(update_by_key[key])
                consumed.add(key)
            continue
        merged.append(row)
    for key, row in update_by_key.items():
        if key not in consumed:
            merged.append(row)
    return merged


def _write_jsonl_atomic(path: Path, rows: Iterable[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    with temporary_path.open("w", encoding="utf-8") as output_file:
        for row in rows:
            output_file.write(json.dumps(row, ensure_ascii=False) + "\n")
    os.replace(temporary_path, path)


def _to_record(source: dict, result: FameResult) -> dict:
    record = {
        "title": result.title,
        "artist": result.artist,
        "article": result.article,
        "total_views": result.total_views,
        "fame_score": round(result.fame_score, 4),
    }
    song_id = source.get("song_id")
    if isinstance(song_id, str) and song_id:
        record["song_id"] = song_id
    return record


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT_PATH)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH)
    parser.add_argument("--artist", action="append", default=[])
    parser.add_argument("--title", action="append", default=[])
    parser.add_argument("--all", action="store_true", help="全入力曲を再取得する")
    parser.add_argument("--dry-run", action="store_true", help="取得するが出力しない")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.all and not args.artist and not args.title:
        raise SystemExit("--artist / --title / --all のいずれかを指定してください")

    artist_filters = {_normalize(value) for value in args.artist}
    title_filters = {_normalize(value) for value in args.title}
    input_rows = _load_jsonl(args.input)
    selected: list[dict] = []
    for row in input_rows:
        title = row.get("title")
        artist = row.get("artist")
        if not isinstance(title, str) or not isinstance(artist, str):
            continue
        if artist_filters and _normalize(artist) not in artist_filters:
            continue
        if title_filters and _normalize(title) not in title_filters:
            continue
        selected.append(row)

    if not selected:
        raise SystemExit("条件に一致する曲がありません")

    logging.info("selected %d/%d songs", len(selected), len(input_rows))
    client = WikipediaClient()
    updates: list[dict] = []
    skipped = 0
    for index, row in enumerate(selected, start=1):
        try:
            result = client.fame_for(row["title"], row["artist"])
        except PageviewsUnavailableError as error:
            skipped += 1
            print(
                f"[{index}/{len(selected)}] {row['title']} / {row['artist']} "
                f"-> SKIP ({error})"
            )
            continue
        updates.append(_to_record(row, result))
        print(
            f"[{index}/{len(selected)}] {result.title} / {result.artist} -> "
            f"{result.article!r} views={result.total_views} score={result.fame_score:.4f}"
        )

    resolved = sum(1 for row in updates if row["article"])
    print(
        f"resolved={resolved}/{len(updates)} ({resolved / len(updates):.1%}), "
        f"skipped={skipped}"
    )
    if args.dry_run:
        print("dry-run: output was not written")
        return

    existing = _load_jsonl(args.output)
    merged = _merge_records(existing, updates)
    _write_jsonl_atomic(args.output, merged)
    print(f"wrote {args.output}: {len(updates)} updated, {len(merged)} total")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
