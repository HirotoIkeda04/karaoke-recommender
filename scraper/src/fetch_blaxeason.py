"""blaxeason.com (音域解説ブログ) クライアント。

vocal-range.com / keytube.net 補完用。modern J-POP に特化したカバレッジで、
特に「両サイトに無い新譜」を救うのが目的(例: M!LK 爆裂愛してる など)。

仕様:
    - 検索: ?s={query} → 結果ページに `<a class="entry-card-wrap" title="..." />`
      title フォーマットは `「曲名」-アーティスト名 音域...`
    - 詳細ページ: meta description = `音域データ 最低音X 最高音Y 音域指数N ...`
    - 裏声情報は基本無い (地声 low/high のみ取得)

サイト負荷配慮: 3 秒/req
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup

from note_converter import karaoke_to_midi
from text_match import similarity

logger = logging.getLogger(__name__)

BASE_URL = "https://blaxeason.com"
REQUEST_INTERVAL_SEC = 3.0
REQUEST_TIMEOUT_SEC = 20

_HDR = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ja,en;q=0.9",
}

# 検索結果の各 a タグ: title="「曲名」-アーティスト名 音域..."
_RE_TITLE = re.compile(r"「([^」]+)」\s*[-‐−]\s*([^\s]+(?:\s[^\s]+)*?)\s+音域")
_RE_NOTE = re.compile(r"^(lowlow|low|mid[12]|hi|hihi)[A-G]#?$")
_NOTE_PATTERN = r"(?:lowlow|low|mid[12]|hi|hihi)[A-G]#?"
# meta description: "音域データ 最低音X 最高音Y ..." (compact)
_RE_META = re.compile(
    rf"音域データ\s*最低音\s*({_NOTE_PATTERN})\s*最高音\s*({_NOTE_PATTERN})"
)
# 本文内: 「最低音 X」(直近の note を取る)
_RE_BODY_LOW = re.compile(rf"最低音\s*({_NOTE_PATTERN})")
_RE_BODY_HIGH = re.compile(rf"最高音\s*({_NOTE_PATTERN})")


class BlaxeasonRateLimited(Exception):
    pass


@dataclass(frozen=True)
class BlaxeasonMatch:
    range_low_midi: int | None
    range_high_midi: int | None
    falsetto_max_midi: int | None  # 常に None (サイトに記載なし)
    source_url: str
    page_title: str
    page_artist: str
    similarity: float


@dataclass(frozen=True)
class _SearchHit:
    url: str
    title: str
    artist: str


def _to_midi(text: str | None) -> int | None:
    if not text or not _RE_NOTE.match(text):
        return None
    try:
        return karaoke_to_midi(text)
    except ValueError:
        return None


class BlaxeasonClient:
    """blaxeason.com の検索 + 詳細取得クライアント。"""

    def __init__(self, session: requests.Session | None = None):
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
        try:
            resp = self.session.get(url, headers=_HDR, timeout=REQUEST_TIMEOUT_SEC)
        except (requests.Timeout, requests.ConnectionError) as e:
            logger.warning("blaxeason transient error %s: %s", url, e)
            return ""
        if resp.status_code in (429, 403):
            raise BlaxeasonRateLimited(url)
        if resp.status_code != 200:
            logger.warning("blaxeason %d for %s", resp.status_code, url)
            return ""
        return resp.text

    def search(self, query: str) -> list[_SearchHit]:
        url = f"{BASE_URL}/?s={quote(query)}"
        html = self._get(url)
        if not html:
            return []
        soup = BeautifulSoup(html, "lxml")
        hits: list[_SearchHit] = []
        seen: set[str] = set()
        for a in soup.find_all("a", class_=re.compile(r"\bentry-card-wrap\b")):
            href = a.get("href", "")
            title_attr = a.get("title", "")
            if not href or not title_attr or href in seen:
                continue
            m = _RE_TITLE.search(title_attr)
            if not m:
                continue
            seen.add(href)
            hits.append(_SearchHit(
                url=href, title=m.group(1).strip(), artist=m.group(2).strip(),
            ))
        return hits

    def fetch_song(self, url: str) -> tuple[int | None, int | None] | None:
        """ページから対象曲の (最低音, 最高音) を MIDI で返す。

        重要: 関連記事カードや内部リンク先の snippet にも `音域データ最低音X最高音Y`
        フォーマットが含まれるため、HTML 内の最初の出現を狙うとそれらに当たる。
        本文を strip した後の最初の「最低音 X」「最高音 Y」(独立に検索) が
        対象曲の値である(関連記事は本文末尾に並ぶ)。
        """
        html = self._get(url)
        if not html:
            return None
        text = re.sub(r"<[^>]+>", " ", html)
        text = re.sub(r"\s+", " ", text)
        m_low = _RE_BODY_LOW.search(text)
        m_high = _RE_BODY_HIGH.search(text)
        if m_low or m_high:
            return (
                _to_midi(m_low.group(1)) if m_low else None,
                _to_midi(m_high.group(1)) if m_high else None,
            )
        return None

    def best_match(
        self,
        title: str,
        artist: str,
        min_similarity: float = 0.7,
    ) -> BlaxeasonMatch | None:
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
        low, high = ranges
        if low is None and high is None:
            return None
        return BlaxeasonMatch(
            range_low_midi=low,
            range_high_midi=high,
            falsetto_max_midi=None,
            source_url=best.url,
            page_title=best.title,
            page_artist=best.artist,
            similarity=best_score,
        )
