"""DAM /generation/ ページから年×ジャンルで楽曲を網羅取得する。

DAM の `/generation/?searchYear=YYYY&genreCode=NNN` は 1949〜2025 (77年) の
各年について 5 ジャンル (ヒット曲/紅白/洋楽/ドラマ・映画/アニメ・特撮)
ごとに 100〜数百曲の人気曲を返す。年×ジャンルの全組合せで 12,000-25,000
ユニーク曲が取れる、現状最大規模のソース。

ranking 系 (scrape_dam.py) との関係:
    - rankings: 「直近のランキング」中心、頻繁更新あり
    - generation: 「年代別の歴代ヒット」中心、長期的・安定的
    - 両方とも DamSong 形式で返すので main_dam.py で merge 可能

robots.txt は /generation/ を許可、ただし負荷配慮で 2s/req throttle。
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from scrape_dam import DamSong, _RE_REQUEST_NO  # 既存の正規表現を再利用

logger = logging.getLogger(__name__)

BASE_URL = "https://www.clubdam.com"
REQUEST_INTERVAL_SEC = 2.0
REQUEST_TIMEOUT_SEC = 30


# DAM /generation/ ページの genreCode → 表示名
GENRE_CODES: dict[str, str] = {
    "001": "hits",          # ヒット曲
    "002": "kohaku",        # 紅白歌合戦
    "003": "foreign",       # 洋楽
    "004": "drama",         # ドラマ・映画
    "005": "anime",         # アニメ・特撮ヒーロー
}

# select 要素の選択肢から実測した完全な年範囲
DEFAULT_YEAR_RANGE: list[int] = list(range(1949, 2026))


def _build_user_agent(contact_email: str) -> str:
    return f"KaraokeRecommenderBot/0.1 (contact: {contact_email}; research/personal)"


def _cache_path(cache_dir: Path, year: int, genre_code: str) -> Path:
    return cache_dir / f"y{year}_g{genre_code}.html"


def fetch_page(
    year: int,
    genre_code: str,
    cache_dir: Path,
    contact_email: str,
    session: requests.Session | None = None,
    force_refresh: bool = False,
) -> str:
    """1 ページ (年, ジャンル) を取得 (キャッシュ優先)。"""
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = _cache_path(cache_dir, year, genre_code)
    if cache_file.exists() and not force_refresh:
        return cache_file.read_text(encoding="utf-8")

    url = urljoin(BASE_URL, f"/generation/?searchYear={year}&genreCode={genre_code}")
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
            resp = sess.get(url, headers=headers, timeout=REQUEST_TIMEOUT_SEC)
            if resp.status_code == 404:
                logger.info("404 for year=%d genre=%s", year, genre_code)
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


def parse_page(html: str, year: int, genre_code: str) -> list[DamSong]:
    """generation HTML から DamSong リストを抽出 (ページ内重複排除済)。

    ranking ページと違い、<li> のクラスは `p-newrelease-list__item`。
    `a.p-song--song` の中身は ranking と同じ構造 (p-song__title / p-song__artist)。
    """
    if not html:
        return []
    soup = BeautifulSoup(html, "lxml")
    items = soup.select("li.p-newrelease-list__item")

    page_slug = f"gen_{year}_{genre_code}"
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
        songs.append(DamSong(
            title=title, artist=artist, request_no=request_no,
            source_pages=(page_slug,),
        ))
    return songs


def fetch_all_generations(
    cache_dir: Path,
    contact_email: str,
    years: Iterable[int] | None = None,
    genre_codes: Iterable[str] | None = None,
) -> list[DamSong]:
    """指定範囲の (年, ジャンル) 全組合せを取得し、source_pages にマージしてユニーク化。"""
    years = list(years) if years is not None else DEFAULT_YEAR_RANGE
    genre_codes = list(genre_codes) if genre_codes is not None else list(GENRE_CODES.keys())

    session = requests.Session()
    by_key: dict[tuple[str, str, str], DamSong] = {}
    total_pages = len(years) * len(genre_codes)
    page_n = 0
    for year in years:
        for gc in genre_codes:
            page_n += 1
            try:
                html = fetch_page(year, gc, cache_dir, contact_email, session=session)
            except RuntimeError:
                logger.exception("failed to fetch year=%d genre=%s", year, gc)
                continue
            page_songs = parse_page(html, year, gc)
            if page_songs:
                logger.debug(
                    "page %d/%d (y=%d g=%s): %d songs",
                    page_n, total_pages, year, gc, len(page_songs),
                )
            for song in page_songs:
                key = (song.title, song.artist, song.request_no)
                if key in by_key:
                    merged = DamSong(
                        title=song.title,
                        artist=song.artist,
                        request_no=song.request_no,
                        source_pages=by_key[key].source_pages + song.source_pages,
                    )
                    by_key[key] = merged
                else:
                    by_key[key] = song
            if page_n % 50 == 0:
                logger.info(
                    "generation progress: %d/%d pages, %d unique songs so far",
                    page_n, total_pages, len(by_key),
                )

    songs = list(by_key.values())
    logger.info(
        "generation total: %d unique songs (%d years × %d genres = %d pages)",
        len(songs), len(years), len(genre_codes), total_pages,
    )
    return songs
