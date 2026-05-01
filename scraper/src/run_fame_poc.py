"""有名度スコア PoC の実行スクリプト。

songs_seed.json から無作為サンプルを取って Wikipedia 由来の
fame_score を計算し、結果を JSONL とサマリで出力する。

Usage:
    python -m run_fame_poc --sample 50
    python -m run_fame_poc --sample 50 --seed 42
    python -m run_fame_poc --all  # 全件
"""

from __future__ import annotations

import argparse
import json
import logging
import random
import sys
import time
from pathlib import Path

from fetch_wikipedia_fame import FameResult, WikipediaClient

SCRAPER_ROOT = Path(__file__).resolve().parent.parent
SOURCES = {
    "seed": SCRAPER_ROOT / "output" / "songs_seed.json",
    "dam": SCRAPER_ROOT / "output" / "dam_songs.json",
}
OUT_PATH = SCRAPER_ROOT / "output" / "fame_poc_results.jsonl"
CACHE_PATH = SCRAPER_ROOT / "output" / "fame_cache.jsonl"


def _load_songs(source: str) -> list[dict]:
    path = SOURCES[source]
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        return data.get("songs", [])
    return data


def _load_cache() -> dict[tuple[str, str], dict]:
    """既存キャッシュを (title, artist) → 結果 dict で返す。"""
    if not CACHE_PATH.exists():
        return {}
    cache: dict[tuple[str, str], dict] = {}
    with CACHE_PATH.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            cache[(d["title"], d["artist"])] = d
    return cache


def _dict_to_result(d: dict) -> FameResult:
    return FameResult(
        title=d["title"],
        artist=d["artist"],
        article=d.get("article"),
        total_views=int(d.get("total_views") or 0),
        fame_score=float(d.get("fame_score") or 0.0),
    )


def _result_to_dict(r: FameResult) -> dict:
    return {
        "title": r.title,
        "artist": r.artist,
        "article": r.article,
        "total_views": r.total_views,
        "fame_score": round(r.fame_score, 4),
    }


def _summarize(results: list[FameResult]) -> None:
    n = len(results)
    if n == 0:
        print("no results")
        return
    resolved = [r for r in results if r.article]
    print(f"\n=== summary ===")
    print(f"  total: {n}")
    print(f"  resolved articles: {len(resolved)}/{n} = {len(resolved)/n:.1%}")

    if not resolved:
        return

    scores = sorted((r.fame_score for r in resolved), reverse=True)
    print(f"  fame_score median: {scores[len(scores)//2]:.2f}")
    print(f"  fame_score max:    {scores[0]:.2f}")
    print(f"  fame_score min:    {scores[-1]:.2f}")

    buckets = {"超有名 (>=5.0)": 0, "有名 (4.0-5.0)": 0,
               "中堅 (3.0-4.0)": 0, "マイナー (<3.0)": 0, "記事なし": 0}
    for r in results:
        if not r.article:
            buckets["記事なし"] += 1
        elif r.fame_score >= 5.0:
            buckets["超有名 (>=5.0)"] += 1
        elif r.fame_score >= 4.0:
            buckets["有名 (4.0-5.0)"] += 1
        elif r.fame_score >= 3.0:
            buckets["中堅 (3.0-4.0)"] += 1
        else:
            buckets["マイナー (<3.0)"] += 1
    print("\n  bucket distribution:")
    for label, count in buckets.items():
        bar = "█" * int(count * 30 / max(n, 1))
        print(f"    {label:20s} {count:4d} {bar}")

    print("\n=== top 10 by fame_score ===")
    top = sorted(results, key=lambda r: r.fame_score, reverse=True)[:10]
    for r in top:
        print(f"  {r.fame_score:5.2f} ({r.total_views:>7,}) "
              f"{r.title} / {r.artist} → {r.article}")

    print("\n=== bottom 5 (with article) ===")
    bottom = sorted(
        (r for r in results if r.article),
        key=lambda r: r.fame_score,
    )[:5]
    for r in bottom:
        print(f"  {r.fame_score:5.2f} ({r.total_views:>7,}) "
              f"{r.title} / {r.artist} → {r.article}")

    print("\n=== unresolved (sample 5) ===")
    unresolved = [r for r in results if not r.article][:5]
    for r in unresolved:
        print(f"  {r.title} / {r.artist}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--source", choices=SOURCES.keys(), default="seed",
                   help="入力ソース (seed=karaoto, dam=DAM scrape)")
    p.add_argument("--sample", type=int, default=50,
                   help="無作為サンプル件数 (--all のとき無視)")
    p.add_argument("--seed", type=int, default=42, help="サンプル用 RNG seed")
    p.add_argument("--all", action="store_true", help="全件処理")
    p.add_argument("--no-cache", action="store_true",
                   help="キャッシュを使わず全件再取得")
    args = p.parse_args()

    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")

    songs = _load_songs(args.source)
    if not args.all:
        rng = random.Random(args.seed)
        songs = rng.sample(songs, min(args.sample, len(songs)))

    cache = {} if args.no_cache else _load_cache()
    print(f"processing {len(songs)} songs (cache: {len(cache)} entries)...")

    client = WikipediaClient()
    results: list[FameResult] = []
    started = time.monotonic()
    fetched = 0

    out_mode = "w" if args.no_cache else "w"  # 結果は毎回書き直し
    with OUT_PATH.open(out_mode, encoding="utf-8") as out_f, \
         CACHE_PATH.open("a", encoding="utf-8") as cache_f:
        for i, s in enumerate(songs, 1):
            title = s.get("title", "")
            artist = s.get("artist", "")
            key = (title, artist)
            if key in cache:
                r = _dict_to_result(cache[key])
            else:
                try:
                    r = client.fame_for(title, artist)
                except Exception as e:
                    logging.error("error for %r/%r: %s", title, artist, e)
                    continue
                fetched += 1
                cache_f.write(
                    json.dumps(_result_to_dict(r), ensure_ascii=False) + "\n",
                )
                cache_f.flush()
            results.append(r)
            out_f.write(json.dumps(_result_to_dict(r), ensure_ascii=False) + "\n")
            if fetched > 0 and fetched % 25 == 0:
                elapsed = time.monotonic() - started
                rate = fetched / elapsed
                remaining = sum(
                    1 for x in songs[i:]
                    if (x.get("title", ""), x.get("artist", "")) not in cache
                )
                eta = remaining / rate if rate > 0 else 0
                print(f"  [{i}/{len(songs)}] fetched={fetched} "
                      f"rate={rate:.1f}/s eta_remaining={eta:.0f}s",
                      file=sys.stderr)

    _summarize(results)
    print(f"\nresults written to: {OUT_PATH}")
    print(f"cache: {CACHE_PATH} (now {len(cache) + fetched} entries)")


if __name__ == "__main__":
    main()
