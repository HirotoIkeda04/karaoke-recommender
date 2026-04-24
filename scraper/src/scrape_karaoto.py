"""カラ音 (karaoto.net) スクレイパ。

HTTP 取得とパースを分離しており、``parse_page`` はキャッシュ済み HTML から
``RawSong`` のリストを構築する純粋関数。``fetch_page`` は間隔制御付きで
HTTP 取得 + ローカルキャッシュを行う。
"""

from __future__ import annotations

import logging
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup, Tag

from models import RawSong
from note_converter import karaoke_to_midi

logger = logging.getLogger(__name__)

BASE_URL = "https://karaoto.net"
MAX_KEY_PAGES: list[int] = list(range(31, 45))  # 31..44 (mid2E 〜 hiF)
REQUEST_INTERVAL_SEC = 2.0
REQUEST_TIMEOUT_SEC = 30

# カラ音ページの max_key パラメータ → MIDI 番号の対応
# spec に沿って NOTE_TABLE 参照ではなく明示的にマップを置く(将来ページ追加時の変更が明確になる)
MAX_KEY_TO_MIDI: dict[int, int] = {
    31: 64,  # mid2E
    32: 65,  # mid2F
    33: 66,  # mid2F#
    34: 67,  # mid2G
    35: 68,  # mid2G#
    36: 69,  # hiA
    37: 70,  # hiA#
    38: 71,  # hiB
    39: 72,  # hiC
    40: 73,  # hiC#
    41: 74,  # hiD
    42: 75,  # hiD#
    43: 76,  # hiE
    44: 77,  # hiF
}

# song_info ブロック内の表記ゆれパターン
_RE_RELEASE_DATE = re.compile(r"発売日[:：]\s*(\d{4}/\d{2}/\d{2})")
_RE_ALBUM = re.compile(r"収録アルバム『([^』]+)』")
_RE_TIEUP = re.compile(r"(?:ドラマ|映画|アニメ|ゲーム)『[^』]+』[^<\n]*")


def build_page_url(max_key_n: int) -> str:
    return urljoin(BASE_URL + "/", f"max_key/{max_key_n}")


def _parse_key_line(text: str) -> tuple[str | None, str | None]:
    """「地声：(low)〜(high)」の一行からテキストを抽出。

    HTML 側では ``<span class="min_key">`` / ``<span class="max_key">`` に
    分かれているので通常そちらを使う。このヘルパは fallback 用。
    """
    # 全角/半角/U+301C の波ダッシュ類をまとめて ~ に正規化してから split
    normalized = re.sub(r"[〜～~]", "~", text)
    if "~" not in normalized:
        return None, None
    low, _, high = normalized.partition("~")
    return (low.strip() or None), (high.strip() or None)


# 「データなし」を意味する既知のトークン(警告せず None として扱う)
_NO_DATA_TOKENS = {"", "-", "ー", "−", "－", "~", "〜", "～"}


def _to_midi_opt(raw: str | None) -> int | None:
    if raw is None or raw.strip() in _NO_DATA_TOKENS:
        return None
    try:
        return karaoke_to_midi(raw)
    except ValueError:
        logger.warning("unparseable note notation: %r", raw)
        return None


def _parse_song_item(
    item: Tag, artist: str, expected_max_midi: int, source_url: str
) -> RawSong | None:
    """<div class="song_item"> 1 つをパース。必須情報が揃わなければ None。"""
    name_el = item.select_one(".song_name")
    if name_el is None:
        return None
    title = name_el.get_text(strip=True)
    if not title:
        return None
    is_featured = name_el.find("b") is not None

    min_key_el = item.select_one(".song_key .min_key")
    max_key_el = item.select_one(".song_key .max_key")
    falsetto_el = item.select_one(".song_key .max_f_key")

    if max_key_el is None:
        # 地声最高が取れない場合はページ N から補う
        range_high_midi = expected_max_midi
    else:
        parsed = _to_midi_opt(max_key_el.get_text(strip=True))
        range_high_midi = parsed if parsed is not None else expected_max_midi

    range_low_midi = _to_midi_opt(min_key_el.get_text(strip=True)) if min_key_el else None
    falsetto_max_midi = (
        _to_midi_opt(falsetto_el.get_text(strip=True)) if falsetto_el else None
    )

    release_date: str | None = None
    album: str | None = None
    tie_up: str | None = None
    info_el = item.select_one(".song_info")
    if info_el is not None:
        info_text = info_el.get_text("\n", strip=True)
        if m := _RE_RELEASE_DATE.search(info_text):
            release_date = m.group(1)
        if m := _RE_ALBUM.search(info_text):
            album = m.group(1)
        if m := _RE_TIEUP.search(info_text):
            tie_up = m.group(0).strip()

    return RawSong(
        title=title,
        artist=artist,
        is_featured=is_featured,
        range_high_midi=range_high_midi,
        range_low_midi=range_low_midi,
        falsetto_max_midi=falsetto_max_midi,
        release_date=release_date,
        album=album,
        tie_up=tie_up,
        source_url=source_url,
    )


def parse_page(html: str, max_key_n: int, source_url: str) -> list[RawSong]:
    """1 ページの HTML をパースして RawSong のリストを返す。"""
    if max_key_n not in MAX_KEY_TO_MIDI:
        raise ValueError(f"Unknown max_key page: {max_key_n}")
    expected_max_midi = MAX_KEY_TO_MIDI[max_key_n]

    soup = BeautifulSoup(html, "lxml")
    article = soup.find("article")
    if article is None:
        logger.warning("<article> not found in page N=%d", max_key_n)
        return []

    songs: list[RawSong] = []
    # <h2> アーティスト名 → 直後の <div class="song_container"> 内の song_item 群
    for h2 in article.find_all("h2"):
        artist = h2.get_text(strip=True)
        if not artist:
            continue
        container = h2.find_next_sibling("div", class_="song_container")
        if container is None:
            continue
        for item in container.select(".song_item"):
            song = _parse_song_item(item, artist, expected_max_midi, source_url)
            if song is not None:
                songs.append(song)
    return songs


def _build_user_agent(contact_email: str) -> str:
    return (
        f"KaraokeRecommenderBot/0.1 (contact: {contact_email}; research/personal)"
    )


def fetch_page(
    max_key_n: int,
    cache_dir: Path,
    contact_email: str,
    session: requests.Session | None = None,
    force_refresh: bool = False,
) -> str:
    """キャッシュ優先で 1 ページを取得。spec の間隔/タイムアウト/リトライ規則を満たす。"""
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = cache_dir / f"max_key_{max_key_n}.html"
    if cache_file.exists() and not force_refresh:
        logger.info("cache hit: %s", cache_file)
        return cache_file.read_text(encoding="utf-8")

    url = build_page_url(max_key_n)
    sess = session or requests.Session()
    headers = {"User-Agent": _build_user_agent(contact_email)}

    # 指数バックオフ: 2, 4, 8 秒
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
            if 500 <= resp.status_code < 600:
                last_exc = requests.HTTPError(f"{resp.status_code} server error")
                continue
            resp.raise_for_status()
            cache_file.write_text(resp.text, encoding="utf-8")
            return resp.text
        except (requests.Timeout, requests.ConnectionError) as e:
            last_exc = e

    raise RuntimeError(f"Failed to fetch {url} after 3 attempts") from last_exc


def fetch_all_pages(cache_dir: Path, contact_email: str) -> dict[int, str]:
    """14 ページすべてをキャッシュ + 取得。"""
    session = requests.Session()
    out: dict[int, str] = {}
    for n in MAX_KEY_PAGES:
        out[n] = fetch_page(n, cache_dir, contact_email, session=session)
    return out


def parse_all(htmls: dict[int, str]) -> list[RawSong]:
    songs: list[RawSong] = []
    for n, html in htmls.items():
        url = build_page_url(n)
        songs.extend(parse_page(html, n, url))
    return songs
