"""iTunes Search API クライアント。

Spotify quota 制約を回避するためのジャケ画像/年情報の代替ソース。

特徴:
    - 認証不要、無料
    - レート制限: 約 20 req/min/IP (公式非明記、目安)
    - J-POP カバレッジは Spotify と遜色なし(Apple Music の日本シェア大)
    - 429 で約 1 分間ロック → 控えめに 4s/req(= 15 req/min)で運用

API:
    https://itunes.apple.com/search?term=...&country=jp&media=music&entity=song&limit=5
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass

import requests

from text_match import normalize as _normalize_text
from text_match import similarity as _similarity_text

logger = logging.getLogger(__name__)

ENDPOINT = "https://itunes.apple.com/search"
REQUEST_INTERVAL_SEC = 4.0  # 15 req/min。20/min の公式目安より安全側
REQUEST_TIMEOUT_SEC = 15
MIN_SIMILARITY = 0.55  # title+artist の正規化類似度のしきい値


class ItunesRateLimited(Exception):
    """429 を受けた場合に raise される。"""


@dataclass(frozen=True)
class ItunesTrack:
    """iTunes Search から取得した最小限のメタ。"""
    track_name: str
    artist_name: str
    artwork_url_60: str | None
    artwork_url_100: str | None
    artwork_url_600: str | None  # 100 → 600x600 に書き換え
    release_year: int | None
    track_view_url: str | None
    similarity: float = 0.0


# --- 正規化 (text_match モジュールから流用) ---------------------------------

_normalize = _normalize_text
_similarity = _similarity_text


def upgrade_artwork(url: str | None, size: int = 600) -> str | None:
    """artworkUrl の URL 内の `NxNbb.jpg` を任意サイズに書き換える。

    iTunes の artwork CDN は URL 末尾の `100x100bb.jpg` を任意のピクセル数に
    書き換えるだけで対応する解像度の画像を返す(再エンコード済)。
    """
    if not url:
        return None
    return re.sub(r"/\d+x\d+(bb)?\.(jpg|png)", f"/{size}x{size}bb.\\2", url)


# 後方互換: 古い名前を残しておく(他モジュールが使っていた場合に備えて)
_upgrade_artwork = upgrade_artwork


# --- API 呼び出し ----------------------------------------------------------

class ItunesClient:
    """iTunes Search API のシンプルなクライアント。間隔制御 + 1 件最良マッチ抽出。"""

    def __init__(self, country: str = "jp", session: requests.Session | None = None):
        self.country = country
        self.session = session or requests.Session()
        self._last_request_at: float = 0.0

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request_at
        wait = REQUEST_INTERVAL_SEC - elapsed
        if wait > 0:
            time.sleep(wait)
        self._last_request_at = time.monotonic()

    def search(self, term: str, limit: int = 5) -> list[dict]:
        self._throttle()
        params = {
            "term": term,
            "country": self.country,
            "media": "music",
            "entity": "song",
            "limit": limit,
        }
        try:
            resp = self.session.get(
                ENDPOINT, params=params, timeout=REQUEST_TIMEOUT_SEC,
            )
        except (requests.Timeout, requests.ConnectionError) as e:
            logger.warning("iTunes search transient error for %r: %s", term, e)
            return []
        if resp.status_code == 429:
            logger.error("iTunes 429 rate-limited for %r", term)
            raise ItunesRateLimited(term)
        if resp.status_code != 200:
            logger.warning("iTunes %d for %r: %s", resp.status_code, term, resp.text[:200])
            return []
        try:
            data = resp.json()
        except ValueError:
            logger.warning("iTunes returned non-JSON for %r", term)
            return []
        return data.get("results", [])

    def best_match(self, title: str, artist: str) -> ItunesTrack | None:
        """`{title} {artist}` で検索し、類似度上位を返す。"""
        results = self.search(f"{title} {artist}", limit=5)
        if not results:
            # フォールバック: アーティストのみで検索 → タイトル類似度で絞る
            results = self.search(artist, limit=10)
            if not results:
                return None

        best: ItunesTrack | None = None
        best_score = 0.0
        for r in results:
            t_sim = _similarity(title, r.get("trackName", ""))
            a_sim = _similarity(artist, r.get("artistName", ""))
            score = (t_sim * 0.7) + (a_sim * 0.3)
            if score > best_score:
                best_score = score
                best = self._to_track(r, score)

        if best is None or best_score < MIN_SIMILARITY:
            return None
        return best

    def _to_track(self, r: dict, similarity: float) -> ItunesTrack:
        url100 = r.get("artworkUrl100")
        release_date = r.get("releaseDate", "")
        year: int | None = None
        if release_date and len(release_date) >= 4:
            try:
                year = int(release_date[:4])
            except ValueError:
                year = None
        return ItunesTrack(
            track_name=r.get("trackName", ""),
            artist_name=r.get("artistName", ""),
            artwork_url_60=r.get("artworkUrl60"),
            artwork_url_100=url100,
            artwork_url_600=_upgrade_artwork(url100, 600),
            release_year=year,
            track_view_url=r.get("trackViewUrl"),
            similarity=similarity,
        )
