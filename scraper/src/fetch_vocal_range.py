"""vocal-range.com (J-POP 音域の沼) 音域データ取得モジュール。

karaoto.net が 2023 年で更新停止しており、最新ヒット曲(ライラック等)を
カバーしないため、補助ソースとして個人運営のブログ「J-POP 音域の沼」を利用。
~2000 曲規模で、karaoto と同じ表記 (mid1D, hiB 等) を使う。

スクレイピング方針:
    - 検索 `?s={title}` → `『TITLE』(ARTIST)の音域` リンク群
    - (title, artist) 類似度トップを採用
    - 詳細ページから `【地声最低音】NOTE`, `【地声最高音】NOTE`, `【裏声最高音】NOTE`
      パターンで抽出 (NOTE は karaoto と同表記)

サイト負荷配慮:
    - 4 秒/req (polite throttle)
    - User-Agent に contact email 明示
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from typing import Iterable
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup

from note_converter import karaoke_to_midi
from text_match import normalize, similarity

logger = logging.getLogger(__name__)

BASE_URL = "https://vocal-range.com"
REQUEST_INTERVAL_SEC = 4.0
REQUEST_TIMEOUT_SEC = 20

# `『曲名』(アーティスト名)の音域` または `『曲名』( アーティスト名 )の音域` 等の表記揺れに対応
_RE_LINK_TITLE = re.compile(
    r"『([^』]+)』\s*[(（]\s*([^)）]+?)\s*[)）]\s*の音域"
)
_RE_POST_HREF = re.compile(r"^https://vocal-range\.com/archives/post-\d+\.html$")

# 詳細ページの音域表記
_RE_LOW = re.compile(r"【地声最低音】\s*([A-Za-z0-9]+(?:#)?)")
_RE_HIGH = re.compile(r"【地声最高音】\s*([A-Za-z0-9]+(?:#)?)")
_RE_FALSETTO = re.compile(r"【裏声最高音】\s*([A-Za-z0-9]+(?:#)?)")

# サブスト記述: `mid1D(D3)` から `mid1D` を取る
_RE_NOTE_HEAD = re.compile(r"^([A-Za-z0-9]+(?:#)?)")


class VocalRangeRateLimited(Exception):
    """403/429 を受けた場合に raise される。"""


@dataclass(frozen=True)
class VocalRangeMatch:
    """vocal-range.com 詳細ページの音域結果。"""
    range_low_midi: int | None
    range_high_midi: int | None
    falsetto_max_midi: int | None
    source_url: str
    page_title: str
    page_artist: str
    similarity: float


@dataclass(frozen=True)
class _SearchHit:
    url: str
    title: str
    artist: str


def _build_user_agent(contact_email: str) -> str:
    return f"KaraokeRecommenderBot/0.1 (contact: {contact_email}; research/personal)"


class VocalRangeClient:
    """vocal-range.com の検索/詳細ページ取得クライアント。"""

    def __init__(self, contact_email: str, session: requests.Session | None = None):
        self.contact_email = contact_email
        self.session = session or requests.Session()
        self._last_request_at: float = 0.0

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request_at
        wait = REQUEST_INTERVAL_SEC - elapsed
        if wait > 0:
            time.sleep(wait)
        self._last_request_at = time.monotonic()

    def _get(self, url: str) -> str:
        self._throttle()
        headers = {"User-Agent": _build_user_agent(self.contact_email)}
        try:
            resp = self.session.get(url, headers=headers, timeout=REQUEST_TIMEOUT_SEC)
        except (requests.Timeout, requests.ConnectionError) as e:
            logger.warning("vocal-range transient error %s: %s", url, e)
            return ""
        if resp.status_code in (403, 429):
            logger.error("vocal-range rate limited (%d) for %s", resp.status_code, url)
            raise VocalRangeRateLimited(url)
        if resp.status_code == 404:
            logger.info("vocal-range 404 for %s", url)
            return ""
        if resp.status_code != 200:
            logger.warning("vocal-range %d for %s", resp.status_code, url)
            return ""
        return resp.text

    def search(self, query: str) -> list[_SearchHit]:
        """検索結果ページから (url, title, artist) を抽出。"""
        url = f"{BASE_URL}/?s={quote(query)}"
        html = self._get(url)
        if not html:
            return []
        soup = BeautifulSoup(html, "lxml")

        hits: list[_SearchHit] = []
        seen: set[str] = set()
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if not _RE_POST_HREF.match(href):
                continue
            if href in seen:
                continue
            text = a.get_text(strip=True)
            m = _RE_LINK_TITLE.search(text)
            if not m:
                continue
            seen.add(href)
            hits.append(_SearchHit(url=href, title=m.group(1).strip(),
                                   artist=m.group(2).strip()))
        return hits

    @staticmethod
    def _to_midi(raw: str | None) -> int | None:
        if not raw:
            return None
        m = _RE_NOTE_HEAD.match(raw)
        if not m:
            return None
        try:
            return karaoke_to_midi(m.group(1))
        except ValueError:
            return None

    def fetch_song(self, url: str) -> tuple[int | None, int | None, int | None] | None:
        """詳細ページから (low, high, falsetto) MIDI を抽出。読み取り失敗時は None。"""
        html = self._get(url)
        if not html:
            return None
        # HTML タグ除去後のテキストで検索した方が安定
        soup = BeautifulSoup(html, "lxml")
        text = soup.get_text(" ", strip=True)
        low_m = _RE_LOW.search(text)
        high_m = _RE_HIGH.search(text)
        falsetto_m = _RE_FALSETTO.search(text)
        low = self._to_midi(low_m.group(1)) if low_m else None
        high = self._to_midi(high_m.group(1)) if high_m else None
        falsetto = self._to_midi(falsetto_m.group(1)) if falsetto_m else None
        if low is None and high is None and falsetto is None:
            return None
        return (low, high, falsetto)

    def best_match(
        self, title: str, artist: str, min_similarity: float = 0.7,
    ) -> VocalRangeMatch | None:
        """`title` で検索し (title, artist) 類似度トップの詳細を取得する。"""
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

        ranges = self.fetch_song(best.url)
        if ranges is None:
            return None
        low, high, falsetto = ranges
        return VocalRangeMatch(
            range_low_midi=low,
            range_high_midi=high,
            falsetto_max_midi=falsetto,
            source_url=best.url,
            page_title=best.title,
            page_artist=best.artist,
            similarity=best_score,
        )


def find_many(
    client: VocalRangeClient,
    targets: Iterable[tuple[str, str]],
    cache: dict[tuple[str, str], dict | None] | None = None,
) -> dict[tuple[str, str], VocalRangeMatch | None]:
    """複数の (title, artist) を順次解決する(キャッシュ対応)。"""
    cache = cache if cache is not None else {}
    out: dict[tuple[str, str], VocalRangeMatch | None] = {}
    for title, artist in targets:
        key = (normalize(title), normalize(artist))
        if key in cache:
            v = cache[key]
            out[key] = VocalRangeMatch(**v) if v else None
            continue
        try:
            match = client.best_match(title, artist)
        except VocalRangeRateLimited:
            logger.error("rate limited; aborting further lookups")
            break
        out[key] = match
        cache[key] = match.__dict__ if match else None
    return out
