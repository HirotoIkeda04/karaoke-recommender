"""日本語 Wikipedia から RIAJ 認定 (ゴールド/プラチナ/ミリオン/ダイヤモンド) を抽出する。

設計方針 (2026-05-04 議論より):
    - fame_cache.jsonl で解決済みの article 名を再利用する (再探索しない)。
    - 抽出元: 記事末の認定テーブル (例: "!認定 (RIAJ)" 表) と
              {{Single}} infobox の Certification フィールド。
    - 連続値ではなく 0..6 の段階値 (cert_score) を出力する。
        0 = 認定なし
        1 = ゴールド (10万)
        2 = プラチナ (25万)
        3 = ダブル・プラチナ (50万)
        4 = トリプル・プラチナ (75万)
        5 = ミリオン (100万) または ダイヤモンド (1億ストリーム)
        6 = マルチミリオン (3ミリオン超)

法的判断:
    - 数値・統計データ (認定段階) は著作権の対象外。
    - Wikipedia API 経由の wikitext 取得は CC BY-SA だが、抽出する数値は事実情報。

出力: scraper/output/cert_cache.jsonl
    {"title": ..., "artist": ..., "article": ..., "cert_score": int,
     "cert_label": str}
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

USER_AGENT = (
    "karaoke-recommender-research/0.1 "
    "(RIAJ certification extraction; mailto:hiroto.lalapalooza.ikeda@gmail.com)"
)
WIKI_API = "https://ja.wikipedia.org/w/api.php"
REQUEST_TIMEOUT_SEC = 15
RATE_LIMIT_SEC = 0.3  # 行儀よく ~3 req/sec

SCRAPER_ROOT = Path(__file__).resolve().parent.parent
FAME_CACHE_PATH = SCRAPER_ROOT / "output" / "fame_cache.jsonl"
CERT_CACHE_PATH = SCRAPER_ROOT / "output" / "cert_cache.jsonl"


# (パターン, スコア)。CERT_RULES は重複マッチ可、最強を採用。
CERT_RULES: list[tuple[str, int]] = [
    (r"ダイヤモンド", 5),
    (r"トリプル[・\s]?ミリオン|3ミリオン", 6),
    (r"ダブル[・\s]?ミリオン|2ミリオン", 6),  # 2x ミリオン = 200万 → cert_score 6
    (r"ミリオン", 5),
    (r"クインティプル[・\s]?プラチナ|5x[\s]?プラチナ", 5),
    (r"クアドラプル[・\s]?プラチナ|4x[\s]?プラチナ", 4),
    (r"トリプル[・\s]?プラチナ", 4),
    (r"ダブル[・\s]?プラチナ", 3),
    (r"プラチナ", 2),
    (r"ゴールド", 1),
]


@dataclass
class CertResult:
    title: str
    artist: str
    article: str | None
    cert_score: int
    cert_label: str
    song_id: str | None = None


# ---------- Cache I/O ----------

def _load_fame_cache(path: Path = FAME_CACHE_PATH) -> list[dict]:
    if not path.exists():
        return []
    out: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def _load_cert_cache(path: Path = CERT_CACHE_PATH) -> dict[tuple[str, str], CertResult]:
    if not path.exists():
        return {}
    out: dict[tuple[str, str], CertResult] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        out[(d["title"], d["artist"])] = CertResult(
            title=d["title"],
            artist=d["artist"],
            article=d.get("article"),
            cert_score=int(d.get("cert_score", 0)),
            cert_label=d.get("cert_label", ""),
            song_id=d.get("song_id"),
        )
    return out


def _cert_record(result: CertResult) -> dict:
    record = {
        "title": result.title,
        "artist": result.artist,
        "article": result.article,
        "cert_score": result.cert_score,
        "cert_label": result.cert_label,
    }
    if result.song_id:
        record["song_id"] = result.song_id
    return record


def _write_cert_cache(path: Path, results: Iterable[CertResult]) -> None:
    """重複のない cert cache を一時ファイル経由で置換する。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    ordered = sorted(results, key=lambda row: (row.artist, row.title, row.song_id or ""))
    with temporary_path.open("w", encoding="utf-8") as output_file:
        for result in ordered:
            output_file.write(json.dumps(_cert_record(result), ensure_ascii=False) + "\n")
    os.replace(temporary_path, path)


# ---------- Extraction ----------

def _haystacks(wikitext: str) -> list[str]:
    """認定が記載されうるセクションを抽出。

    A) Certification = ... のインフォボックスフィールド
    B) 「認定」または "RIAJ" の見出し / 表ヘッダ周辺 ±2000 文字
    C) {{Certification ja|...}} などのテンプレート展開行
    """
    result: list[str] = []
    for m in re.finditer(
        r"\|\s*[Cc]ertification\s*=\s*([\s\S]*?)(?:\n\s*\||\n\}\})",
        wikitext,
    ):
        result.append(m.group(1))
    for m in re.finditer(r"(認定|RIAJ|日本レコード協会)", wikitext):
        start = max(0, m.start() - 100)
        end = min(len(wikitext), m.end() + 2000)
        result.append(wikitext[start:end])
    for m in re.finditer(r"\{\{[Cc]ertification[^}]+\}\}", wikitext):
        result.append(m.group(0))
    return result


def extract_cert(wikitext: str) -> tuple[int, str]:
    """RIAJ 認定の最強レベルを抽出。"""
    if not wikitext:
        return 0, ""
    haystacks = _haystacks(wikitext)
    best, label = 0, ""
    for haystack in haystacks:
        for pat, score in CERT_RULES:
            m = re.search(pat, haystack)
            if m and score > best:
                best = score
                label = m.group(0)
    return best, label


# ---------- Wikipedia API ----------

MAX_RETRIES = 3
RETRY_BACKOFF_BASE_SEC = 2.0
BATCH_SIZE = 50  # action=query は最大 50 タイトル/call


def _request_with_retry(session: requests.Session, params: dict) -> dict | None:
    """Wikipedia API を叩く。一過性エラーはリトライ。最終失敗で None。"""
    for attempt in range(MAX_RETRIES):
        try:
            r = session.get(
                WIKI_API,
                params=params,
                headers={"User-Agent": USER_AGENT},
                timeout=REQUEST_TIMEOUT_SEC,
            )
            if r.status_code == 200:
                return r.json()
            logger.warning(
                "HTTP %d (attempt %d): %s",
                r.status_code,
                attempt + 1,
                params.get("titles") or params.get("page"),
            )
        except (requests.Timeout, requests.ConnectionError) as e:
            logger.warning(
                "transient error (attempt %d): %s",
                attempt + 1,
                type(e).__name__,
            )
        if attempt < MAX_RETRIES - 1:
            time.sleep(RETRY_BACKOFF_BASE_SEC * (2 ** attempt))
    return None


def fetch_wikitexts_batch(articles: list[str], session: requests.Session) -> dict[str, str]:
    """最大 50 件の wikitext を 1 リクエストでまとめて取得する。

    action=query&prop=revisions&rvprop=content は ?titles=A|B|C... 形式で 50 件まで。
    Returns: {requested_article_title: wikitext}. 取得失敗 / 記事なしのキーは欠落。
    """
    if not articles:
        return {}
    out: dict[str, str] = {}
    titles_param = "|".join(articles)
    data = _request_with_retry(
        session,
        {
            "action": "query",
            "prop": "revisions",
            "rvprop": "content",
            "rvslots": "main",
            "titles": titles_param,
            "format": "json",
            "formatversion": "2",
            "redirects": "1",
        },
    )
    if not data:
        raise RuntimeError("Wikipedia API returned no certification data")
    # redirects[]: {from: requested_title, to: canonical_title}
    redirects = {r["from"]: r["to"] for r in data.get("query", {}).get("redirects", [])}
    # 正規化された title -> wikitext
    canonical_to_wt: dict[str, str] = {}
    for page in data.get("query", {}).get("pages", []):
        title = page.get("title", "")
        if "missing" in page:
            continue
        revs = page.get("revisions", [])
        if revs and "slots" in revs[0]:
            wt = revs[0]["slots"].get("main", {}).get("content")
            if wt:
                canonical_to_wt[title] = wt
    # 元の article 名で引けるよう、リダイレクト元 -> wt も登録
    for requested in articles:
        canonical = redirects.get(requested, requested)
        if canonical in canonical_to_wt:
            out[requested] = canonical_to_wt[canonical]
    return out


# ---------- Driver ----------

def _normalize(value: str) -> str:
    return unicodedata.normalize("NFKC", value).casefold().strip()


def run(
    *,
    limit: int | None = None,
    force: bool = False,
    fame_cache_path: Path = FAME_CACHE_PATH,
    cert_cache_path: Path = CERT_CACHE_PATH,
    artists: Sequence[str] = (),
    titles: Sequence[str] = (),
    dry_run: bool = False,
) -> None:
    fame_entries = _load_fame_cache(fame_cache_path)
    if not fame_entries:
        logger.error("fame cache not found or empty: %s", fame_cache_path)
        sys.exit(1)
    logger.info("loaded %d fame entries", len(fame_entries))

    artist_filters = {_normalize(value) for value in artists}
    title_filters = {_normalize(value) for value in titles}
    if artist_filters:
        fame_entries = [
            entry
            for entry in fame_entries
            if _normalize(str(entry.get("artist", ""))) in artist_filters
        ]
    if title_filters:
        fame_entries = [
            entry
            for entry in fame_entries
            if _normalize(str(entry.get("title", ""))) in title_filters
        ]
    if not fame_entries:
        raise ValueError("filters matched no fame entries")

    existing = _load_cert_cache(cert_cache_path)
    logger.info("existing cert_cache: %d entries", len(existing))

    # フィルタ: 未処理 (or force) のものだけ
    todo: list[dict] = []
    for entry in fame_entries:
        key = (entry["title"], entry["artist"])
        if not force and key in existing:
            continue
        todo.append(entry)
    logger.info("todo: %d entries (force=%s)", len(todo), force)

    if limit is not None:
        todo = todo[:limit]

    # 記事なしは即決 (API 不要)
    no_article: list[dict] = [e for e in todo if not e.get("article")]
    with_article: list[dict] = [e for e in todo if e.get("article")]
    logger.info(
        "split: no_article=%d (cert=0 即決), with_article=%d (要 API)",
        len(no_article), len(with_article),
    )

    session = requests.Session()
    processed = 0
    cert_positive = 0

    for entry in no_article:
        result = CertResult(
            entry["title"],
            entry["artist"],
            None,
            0,
            "",
            song_id=entry.get("song_id"),
        )
        existing[(entry["title"], entry["artist"])] = result
        processed += 1

    # article 名重複の dedupe (同じ article を 2 度引かない)
    article_to_entries: dict[str, list[dict]] = {}
    for e in with_article:
        article_to_entries.setdefault(e["article"], []).append(e)
    unique_articles = list(article_to_entries.keys())

    for batch_start in range(0, len(unique_articles), BATCH_SIZE):
        batch = unique_articles[batch_start : batch_start + BATCH_SIZE]
        wt_map = fetch_wikitexts_batch(batch, session)
        time.sleep(RATE_LIMIT_SEC)
        for article in batch:
            wt = wt_map.get(article)
            if wt is None:
                logger.warning("certification wikitext unavailable; skip: %s", article)
                continue
            score, label = extract_cert(wt)
            for entry in article_to_entries[article]:
                result = CertResult(
                    entry["title"],
                    entry["artist"],
                    article,
                    score,
                    label,
                    song_id=entry.get("song_id"),
                )
                existing[(entry["title"], entry["artist"])] = result
                processed += 1
                if score > 0:
                    cert_positive += 1
        logger.info(
            "batch %d/%d done: processed=%d, cert>0=%d",
            (batch_start // BATCH_SIZE) + 1,
            (len(unique_articles) + BATCH_SIZE - 1) // BATCH_SIZE,
            processed,
            cert_positive,
        )

    logger.info(
        "done. todo=%d, processed=%d, cert>0_this_run=%d, total_in_cache=%d",
        len(todo), processed, cert_positive, len(existing),
    )
    if dry_run:
        logger.info("dry-run: cert cache was not written")
        return
    _write_cert_cache(cert_cache_path, existing.values())
    logger.info("wrote %s", cert_cache_path)


def main() -> None:
    p = argparse.ArgumentParser(
        description="日本語 Wikipedia から RIAJ 認定を抽出して cert_cache.jsonl に出力する"
    )
    p.add_argument("--limit", type=int, default=None, help="最大処理件数 (テスト用)")
    p.add_argument("--force", action="store_true", help="既存キャッシュを無視して再取得")
    p.add_argument("--fame-cache", type=Path, default=FAME_CACHE_PATH)
    p.add_argument("--cert-cache", type=Path, default=CERT_CACHE_PATH)
    p.add_argument("--artist", action="append", default=[])
    p.add_argument("--title", action="append", default=[])
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    run(
        limit=args.limit,
        force=args.force,
        fame_cache_path=args.fame_cache,
        cert_cache_path=args.cert_cache,
        artists=args.artist,
        titles=args.title,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
