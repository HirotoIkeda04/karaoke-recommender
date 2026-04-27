"""DAM (clubdam.com) ランキングスクレイパ。

カラ音 (karaoto.net) と並列の二次ソース。DAM ランキング上位曲の
タイトル/アーティスト/DAM ID (requestNo) を取得する。

DAM のページ自体は SSR で title/artist が HTML に直接含まれるため
JS 実行は不要。robots.txt は /ranking/ を許可している(2026-04 確認)。

注意:
    - 音域(キー)情報は DAM の公開ページからは取得不可
      → DAM 由来曲は range_*_midi が NULL のまま DB に入る
    - title/artist のみで識別、DAM ID は dedup 用
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

BASE_URL = "https://www.clubdam.com"
REQUEST_INTERVAL_SEC = 2.0
REQUEST_TIMEOUT_SEC = 30


# ランキングページの一覧。複数を組み合わせて重複排除することで
# 単発で 300〜500 曲規模のカバレッジを確保する。
RANKING_PAGES: dict[str, str] = {
    "main":         "/ranking/",                       # デイリー/週間/月間 総合
    "year":         "/ranking/year.html",              # 年間
    "firsthalf":    "/ranking/firsthalf.html",         # 上半期
    "secondhalf":   "/ranking/secondhalf.html",        # 下半期
    "anime_monthly":    "/app/dam/ranking/anime-monthly.html",
    "vocaloid_monthly": "/app/dam/ranking/vocaloid-monthly.html",
    "vtuber_monthly":   "/app/dam/ranking/vtuber-monthly.html",
    "enka_monthly":     "/app/dam/ranking/enka-monthly.html",
    "duet_monthly":     "/app/dam/ranking/duet-monthly.html",
    "foreign_monthly":  "/app/dam/ranking/foreign-monthly.html",
}


@dataclass(frozen=True)
class DamSong:
    """DAM ランキングから取得した楽曲メタ。"""
    title: str
    artist: str
    request_no: str  # DAM の楽曲 ID。例 "1268-85"
    source_pages: tuple[str, ...] = ()  # どのランキングページに登場したか


def _build_user_agent(contact_email: str) -> str:
    return f"KaraokeRecommenderBot/0.1 (contact: {contact_email}; research/personal)"


def fetch_page(
    slug: str,
    path: str,
    cache_dir: Path,
    contact_email: str,
    session: requests.Session | None = None,
    force_refresh: bool = False,
) -> str:
    """1 ページを取得(キャッシュ優先)。"""
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = cache_dir / f"{slug}.html"
    if cache_file.exists() and not force_refresh:
        logger.info("cache hit: %s", cache_file)
        return cache_file.read_text(encoding="utf-8")

    url = urljoin(BASE_URL, path)
    sess = session or requests.Session()
    headers = {"User-Agent": _build_user_agent(contact_email)}

    last_exc: Exception | None = None
    for attempt in range(3):
        if attempt > 0:
            backoff = 2 ** (attempt + 1)
            logger.warning("retrying %s after %ds (attempt %d)", url, backoff, attempt + 1)
            time.sleep(backoff)
        else:
            time.sleep(REQUEST_INTERVAL_SEC)
        try:
            start = time.monotonic()
            resp = sess.get(url, headers=headers, timeout=REQUEST_TIMEOUT_SEC)
            elapsed = time.monotonic() - start
            logger.info(
                "GET %s -> %d (%d bytes) [%.2fs]",
                url, resp.status_code, len(resp.content), elapsed,
            )
            if resp.status_code == 404:
                logger.warning("404 for %s, skipping", url)
                return ""
            if 500 <= resp.status_code < 600:
                last_exc = requests.HTTPError(f"{resp.status_code} server error")
                continue
            resp.raise_for_status()
            cache_file.write_text(resp.text, encoding="utf-8")
            return resp.text
        except (requests.Timeout, requests.ConnectionError) as e:
            last_exc = e

    raise RuntimeError(f"Failed to fetch {url} after 3 attempts") from last_exc


_RE_REQUEST_NO = re.compile(r"requestNo=([\w\-]+)")


def parse_page(html: str, page_slug: str) -> list[DamSong]:
    """ランキング HTML から DamSong のリストを抽出(同一ページ内で重複排除済)。"""
    if not html:
        return []
    soup = BeautifulSoup(html, "lxml")
    items = soup.select("li.p-ranking-list__item")

    seen: set[tuple[str, str, str]] = set()
    songs: list[DamSong] = []
    for li in items:
        a = li.select_one("a.p-song--song")
        if a is None:
            continue
        href = a.get("href", "")
        m = _RE_REQUEST_NO.search(href)
        if not m:
            continue
        request_no = m.group(1)

        title_el = a.select_one(".p-song__title")
        artist_el = a.select_one(".p-song__artist")
        if not (title_el and artist_el):
            continue
        title = title_el.get_text(strip=True)
        artist = artist_el.get_text(strip=True)
        if not title or not artist:
            continue

        key = (title, artist, request_no)
        if key in seen:
            continue
        seen.add(key)
        songs.append(DamSong(title=title, artist=artist, request_no=request_no,
                             source_pages=(page_slug,)))
    return songs


def fetch_all_rankings(cache_dir: Path, contact_email: str) -> list[DamSong]:
    """全ランキングページを取得し、(title, artist, request_no) でユニーク化。

    同一曲が複数ランキングに登場する場合は source_pages にマージして 1 件にまとめる。
    """
    session = requests.Session()
    by_key: dict[tuple[str, str, str], DamSong] = {}
    for slug, path in RANKING_PAGES.items():
        try:
            html = fetch_page(slug, path, cache_dir, contact_email, session=session)
        except RuntimeError:
            logger.exception("failed to fetch %s, skipping", slug)
            continue
        page_songs = parse_page(html, slug)
        logger.info("page %s: %d unique songs", slug, len(page_songs))
        for song in page_songs:
            key = (song.title, song.artist, song.request_no)
            if key in by_key:
                merged = DamSong(
                    title=song.title,
                    artist=song.artist,
                    request_no=song.request_no,
                    source_pages=by_key[key].source_pages + (slug,),
                )
                by_key[key] = merged
            else:
                by_key[key] = song

    songs = list(by_key.values())
    logger.info("total unique songs across %d pages: %d",
                len(RANKING_PAGES), len(songs))
    return songs
