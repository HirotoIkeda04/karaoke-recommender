"""KeyTube (keytube.net) クライアント。

vocal-range.com 補完。検索結果ページに 地声最低/最高 が露出しているため
1 リクエストで取得できる。裏声最高が必要な場合は別途詳細ページを取得。

サイト固有の癖:
    - User-Agent をブラウザ風にしないとタイムアウト
    - Referer ヘッダ必須(無いと 0 byte レスポンス)
    - 表記は karaoto と同じ (mid1D, hiB 等) → karaoke_to_midi 流用可

サイト負荷配慮: 3 秒/req
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from typing import Iterable
from urllib.parse import urlencode

import requests
from bs4 import BeautifulSoup

from note_converter import karaoke_to_midi
from text_match import normalize, similarity

logger = logging.getLogger(__name__)

BASE_URL = "https://keytube.net"
REQUEST_INTERVAL_SEC = 3.0
REQUEST_TIMEOUT_SEC = 20

_HDR = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ja,en;q=0.9",
    "Referer": f"{BASE_URL}/",
}

_RE_SONG_ID = re.compile(r"/song/detail/(\d+)")
_RE_NOTE = re.compile(r"^(lowlow|low|mid[12]|hi|hihi)[A-G]#?$")


class KeyTubeRateLimited(Exception):
    pass


@dataclass(frozen=True)
class KeyTubeMatch:
    """KeyTube 詳細ページから取得した音域メタ。"""
    range_low_midi: int | None
    range_high_midi: int | None
    falsetto_max_midi: int | None
    source_url: str
    page_title: str
    page_artist: str
    similarity: float


@dataclass(frozen=True)
class _SearchHit:
    song_id: str
    title: str
    artist: str
    range_low_text: str | None  # "mid1G" 等
    range_high_text: str | None


def _to_midi(text: str | None) -> int | None:
    if not text:
        return None
    if not _RE_NOTE.match(text):
        return None
    try:
        return karaoke_to_midi(text)
    except ValueError:
        return None


class KeyTubeClient:
    """KeyTube クライアント。

    KeyTube は session 単位で過剰アクセスを検知すると 400 を返し、
    その session からは復旧しないことが実測された。
    対策として SESSION_REFRESH_EVERY 件ごとに session を作り直す。
    """

    SESSION_REFRESH_EVERY = 50

    def __init__(self, session: requests.Session | None = None):
        self.session = session or requests.Session()
        self._last_request_at: float = 0.0
        self._requests_since_refresh = 0

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request_at
        wait = REQUEST_INTERVAL_SEC - elapsed
        if wait > 0:
            time.sleep(wait)
        self._last_request_at = time.monotonic()

    def _refresh_session_if_needed(self) -> None:
        if self._requests_since_refresh >= self.SESSION_REFRESH_EVERY:
            self.session.close()
            self.session = requests.Session()
            self._requests_since_refresh = 0
            logger.info("keytube: session refreshed")

    def _get(self, url: str) -> str:
        self._refresh_session_if_needed()
        self._throttle()
        try:
            resp = self.session.get(url, headers=_HDR, timeout=REQUEST_TIMEOUT_SEC)
        except (requests.Timeout, requests.ConnectionError) as e:
            logger.warning("keytube transient error %s: %s", url, e)
            return ""
        finally:
            self._requests_since_refresh += 1

        if resp.status_code == 429:
            raise KeyTubeRateLimited(url)
        if resp.status_code == 400:
            # 400 が連続したら session の過剰アクセス検知。次回 refresh で回復
            logger.warning("keytube 400 for %s (will refresh session)", url)
            self._requests_since_refresh = self.SESSION_REFRESH_EVERY  # 即時 refresh
            return ""
        if resp.status_code != 200:
            logger.warning("keytube %d for %s", resp.status_code, url)
            return ""
        return resp.text

    def search(self, query: str) -> list[_SearchHit]:
        url = f"{BASE_URL}/search/?" + urlencode({"word": query, "type": ""})
        html = self._get(url)
        if not html:
            return []

        soup = BeautifulSoup(html, "lxml")
        # 検索結果の各行: <div class="t" id="r...">...
        # その中に: t3 (title 含む a), t4 (artist 含む a), t6 (range_low span), t7 (range_high span)
        hits: list[_SearchHit] = []
        for row in soup.select("div.t[id^='r']"):
            t3 = row.select_one(".t3 a")
            t4 = row.select_one(".t4 a")
            t6 = row.select_one(".t6 span")
            t7 = row.select_one(".t7 span")
            if not (t3 and t4):
                continue
            href = t3.get("href", "")
            m = _RE_SONG_ID.search(href)
            if not m:
                continue
            sid = m.group(1)
            title = t3.get_text(strip=True)
            artist = t4.get_text(strip=True)
            low_text = t6.get_text(strip=True) if t6 else None
            high_text = t7.get_text(strip=True) if t7 else None
            hits.append(_SearchHit(
                song_id=sid, title=title, artist=artist,
                range_low_text=low_text, range_high_text=high_text,
            ))
        return hits

    def fetch_falsetto(self, song_id: str) -> int | None:
        """詳細ページから 裏声最高音 を取得 (任意)。"""
        url = f"{BASE_URL}/song/detail/{song_id}"
        html = self._get(url)
        if not html:
            return None
        # 「裏声最高音」ラベル → 直近の note 表記
        m = re.search(r"裏声最高音[^<]*?\s*((?:lowlow|low|mid[12]|hi|hihi)[A-G]#?)", html)
        if not m:
            return None
        return _to_midi(m.group(1))

    def best_match(
        self,
        title: str,
        artist: str,
        min_similarity: float = 0.7,
        fetch_falsetto: bool = True,
    ) -> KeyTubeMatch | None:
        """`title` で検索し (title, artist) 類似度最良を返す。"""
        hits = self.search(title)
        if not hits:
            return None

        scored: list[tuple[float, _SearchHit]] = []
        for h in hits:
            t_sim = similarity(title, h.title)
            a_sim = similarity(artist, h.artist)
            score = t_sim * 0.6 + a_sim * 0.4
            scored.append((score, h))
        scored.sort(key=lambda x: x[0], reverse=True)

        best_score, best = scored[0]
        if best_score < min_similarity:
            return None

        low = _to_midi(best.range_low_text)
        high = _to_midi(best.range_high_text)
        falsetto: int | None = None
        if fetch_falsetto:
            try:
                falsetto = self.fetch_falsetto(best.song_id)
            except KeyTubeRateLimited:
                # 詳細取得失敗は致命的でない (range_low/high はある)
                pass

        return KeyTubeMatch(
            range_low_midi=low,
            range_high_midi=high,
            falsetto_max_midi=falsetto,
            source_url=f"{BASE_URL}/song/detail/{best.song_id}",
            page_title=best.title,
            page_artist=best.artist,
            similarity=best_score,
        )
