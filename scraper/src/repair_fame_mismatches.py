"""fame_cache.jsonl の同名異記事 (例: 曲名と同名の学校・施設) 誤マッチを
検出し、修正後ロジックで再解決して書き戻す。

背景:
  旧ロジックは「裸タイトル記事 + 本文にアーティスト名」で採用していたため、
  例えば福山雅治『トモエ学園』が学校「トモエ学園」(147万 view) に誤マッチし
  fame_score が異常高騰していた。修正版は「楽曲系カテゴリ or 曲系
  disambiguator」を要求する。

手順 (Wikipedia API 負荷最小化):
  1. 曲系 disambiguator 付き記事は構造上安全 → スキップ
  2. 残り (裸タイトル等) の記事カテゴリを 50 件/req でバッチ取得
  3. 楽曲系カテゴリが無い / 曖昧さ回避ページ = 誤マッチ容疑
  4. 容疑のみ修正版 fame_for() で再解決し、変化したエントリを書き戻す

実行: cd scraper/src && uv run python -m repair_fame_mismatches [--apply]
  --apply 無し: dry-run (差分表示のみ、ファイル不変)
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import requests

from fetch_wikipedia_fame import (
    FameResult,
    SEARCH_ENDPOINT,
    TransientFetchError,
    USER_AGENT,
    WikipediaClient,
    _is_disambiguation_page,
    _is_song_article,
)

CACHE_PATH = Path(__file__).resolve().parents[1] / "output" / "fame_cache.jsonl"

# 末尾がこれなら曲系 disambiguator 付き = 構造上安全 (再検証不要)
_SAFE_SUFFIXES = ("の曲)", "の楽曲)", "のシングル)", "の歌)")

_CATEGORY_BATCH = 50
_CATEGORY_INTERVAL_SEC = 0.2

# 1 曲ずつの再解決設定。バースト下で Wikipedia が空応答/レート制限を
# 返すため、None も「一過性かも」と見なしてバックオフ再試行する。
_RESOLVE_ATTEMPTS = 4
_RESOLVE_BACKOFF_SEC = 3.0
_INTER_ENTRY_SLEEP_SEC = 1.5
_CHECKPOINT_EVERY = 20


def _load_cache() -> list[dict]:
    out: list[dict] = []
    for line in CACHE_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out


def _write_cache(cache: list[dict]) -> None:
    tmp = CACHE_PATH.with_suffix(".jsonl.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        for e in cache:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")
    tmp.replace(CACHE_PATH)


def _resolve_robust(
    client: WikipediaClient, title: str, artist: str
) -> FameResult | None:
    """fame_for を堅牢化。TransientFetchError と None (バースト下の空応答)
    をリトライ対象として指数バックオフ。記事が取れたら即返す。

    全試行で記事が取れなければ None を返す (呼び出し側が「記事なし」扱い)。
    """
    for attempt in range(_RESOLVE_ATTEMPTS):
        try:
            res = client.fame_for(title, artist)
        except TransientFetchError:
            res = None
        if res is not None and res.article is not None:
            return res
        if attempt < _RESOLVE_ATTEMPTS - 1:
            time.sleep(_RESOLVE_BACKOFF_SEC * (2 ** attempt))
    return None


def _fetch_categories_batch(
    session: requests.Session, titles: list[str]
) -> dict[str, list[str]]:
    """最大 50 記事のカテゴリ (非隠し) を 1 リクエストで取得。

    redirects/normalized を解決し、入力タイトル -> カテゴリ名リスト を返す。
    """
    params = {
        "action": "query",
        "titles": "|".join(titles),
        "redirects": "1",
        "prop": "categories",
        "cllimit": "max",
        "clshow": "!hidden",
        "format": "json",
    }
    resp = session.get(SEARCH_ENDPOINT, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    query = data.get("query", {})

    # 入力タイトル -> 解決後タイトルのエイリアス表を作る
    alias: dict[str, str] = {}
    for n in query.get("normalized", []):
        alias[n["from"]] = n["to"]
    for r in query.get("redirects", []):
        alias[r["from"]] = r["to"]

    def resolve(t: str) -> str:
        seen = set()
        while t in alias and t not in seen:
            seen.add(t)
            t = alias[t]
        return t

    by_title: dict[str, list[str]] = {}
    for page in query.get("pages", {}).values():
        by_title[page.get("title", "")] = [
            c.get("title", "") for c in page.get("categories", [])
        ]

    result: dict[str, list[str]] = {}
    for t in titles:
        result[t] = by_title.get(resolve(t), [])
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--apply",
        action="store_true",
        help="fame_cache.jsonl を実際に書き換える (無指定は dry-run)",
    )
    args = ap.parse_args()
    sys.stdout.reconfigure(line_buffering=True)

    cache = _load_cache()
    print(f"loaded {len(cache)} cache entries")

    # 再検証が必要なのは「article 非 null かつ曲系 disambiguator 無し」のみ
    suspects_idx = [
        i
        for i, e in enumerate(cache)
        if e.get("article")
        and not any(e["article"].endswith(s) for s in _SAFE_SUFFIXES)
    ]
    # 同一記事は 1 回だけ問い合わせる
    article_of_idx = {i: cache[i]["article"] for i in suspects_idx}
    unique_articles = sorted({a for a in article_of_idx.values()})
    print(
        f"  song-disambig safe skipped; "
        f"{len(suspects_idx)} entries / {len(unique_articles)} unique "
        f"articles to category-check"
    )

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    cats_by_article: dict[str, list[str]] = {}
    for b in range(0, len(unique_articles), _CATEGORY_BATCH):
        batch = unique_articles[b : b + _CATEGORY_BATCH]
        cats_by_article.update(_fetch_categories_batch(session, batch))
        done = min(b + _CATEGORY_BATCH, len(unique_articles))
        print(f"  categories fetched {done}/{len(unique_articles)}", end="\r")
        time.sleep(_CATEGORY_INTERVAL_SEC)
    print()

    # 楽曲系カテゴリ無し or 曖昧さ回避 = 誤マッチ容疑
    flagged_idx = [
        i
        for i in suspects_idx
        if _is_disambiguation_page(cats_by_article.get(article_of_idx[i], []))
        or not _is_song_article(cats_by_article.get(article_of_idx[i], []))
    ]
    print(f"  flagged {len(flagged_idx)} suspected mis-matches\n")

    if not flagged_idx:
        print("no mis-matches. nothing to do.")
        return

    client = WikipediaClient(session=session)
    changed = 0
    unresolved: list[tuple[str, str]] = []
    for n, i in enumerate(flagged_idx, 1):
        e = cache[i]
        title, artist = e["title"], e["artist"]
        old_art, old_score = e.get("article"), e.get("fame_score")

        res = _resolve_robust(client, title, artist)

        if res is None or res.article is None:
            # 旧記事はカテゴリ判定で「非楽曲」と確定済み (= flagged 理由) なので
            # 旧スコアは確実に誤り。再解決でも記事が取れない曲は、誤マッチを
            # 残すより記事なし (fame 0) に倒す。要レビュー用に記録。
            unresolved.append((title, artist))
            new = {
                "title": title,
                "artist": artist,
                "article": None,
                "total_views": 0,
                "fame_score": 0.0,
            }
        else:
            new = {
                "title": title,
                "artist": artist,
                "article": res.article,
                "total_views": res.total_views,
                "fame_score": round(res.fame_score, 4),
            }

        if new["article"] != old_art or new["fame_score"] != old_score:
            changed += 1
            print(
                f"  [{n}/{len(flagged_idx)}] {title!r} / {artist!r}\n"
                f"      {old_art!r} ({old_score}) -> "
                f"{new['article']!r} ({new['fame_score']})"
            )
        cache[i] = new

        # チェックポイント: --apply 時は途中経過を都度永続化し、中断/失敗時
        # の再実行で「楽曲記事に直った行」が flagged から自然に外れて再開可能。
        if args.apply and n % _CHECKPOINT_EVERY == 0:
            _write_cache(cache)
            print(f"  checkpoint saved at {n}/{len(flagged_idx)}")

        time.sleep(_INTER_ENTRY_SLEEP_SEC)

    print(f"\nre-resolved {len(flagged_idx)}, changed {changed}")
    if unresolved:
        print(f"unresolved (set to fame 0, 要レビュー) = {len(unresolved)}:")
        for t, a in unresolved:
            print(f"  - {t!r} / {a!r}")

    if not args.apply:
        print("dry-run: fame_cache.jsonl は変更していません (--apply で書込)")
        return

    _write_cache(cache)
    print(f"wrote {CACHE_PATH}")
    print("次: cd .. && pnpm apply:fame で DB へ反映")


if __name__ == "__main__":
    sys.exit(main())
