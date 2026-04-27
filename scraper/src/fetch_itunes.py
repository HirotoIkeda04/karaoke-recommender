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

from difflib import SequenceMatcher

from text_match import normalize as _normalize_text

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


# --- 正規化 (text_match モジュールから流用 + iTunes 固有調整) ----------------

# 「曲名 - Romaji」のように半角ダッシュ後にラテン文字だけが続くサフィックスを除去。
# 例: "晩餐歌 - Bansanka" → "晩餐歌"
# (本物のヒット曲だとこの形式が多く、サフィックスがあると正規化後の類似度が
# カラオケ版 (parens 含み) より下がってしまう問題への対策)
_RE_ROMAJI_SUFFIX = re.compile(r"\s+-\s+[A-Za-z0-9][A-Za-z0-9\s.()\-']*$")


def _normalize(s: str) -> str:
    if not s:
        return ""
    s = _RE_ROMAJI_SUFFIX.sub("", s)
    return _normalize_text(s)


def _similarity(a: str, b: str) -> float:
    """fetch_itunes 専用 similarity (上記 _normalize で英訳サフィックスを剥がす)。"""
    na, nb = _normalize(a), _normalize(b)
    if not na or not nb:
        return 0.0
    return SequenceMatcher(None, na, nb).ratio()


# --- カラオケ・カバー・インスト盤の検出 -------------------------------------

# artistName に含まれていたら 99% カラオケ/カバー/インスト盤
_KARAOKE_ARTIST_KEYWORDS: tuple[str, ...] = (
    "歌っちゃ王",
    "カラオケ歌っちゃ王",
    "オルゴール",
    "music box",
    "piano echoes",
    "piano cover",
    "piano dreamers",
    "ピアノ生演奏",
    # 'オーケストラ' 単独は東京スカパラダイスオーケストラ等の正当な band 名と
    # 衝突するため、'オルゴール' や orchestra cover 系の専用ラベルだけ列挙
    "vega☆オーケストラ",
    "music box ensemble",
    "instrumental",
    "study music",
    "cafe music",
    "lullaby",
    "sleep music",
)

# trackName に含まれていたらカラオケ/インスト系
_KARAOKE_TRACK_KEYWORDS: tuple[str, ...] = (
    "(カラオケ)",
    "(オルゴール)",
    "(piano",
    "(off vocal)",
    "オフボーカル",
    "(原曲歌手",   # 「(原曲歌手:tuki.)」← 歌っちゃ王系の最大の目印
    "[原曲歌手",
    "(ガイド",
    "ガイド無し",
    "ガイドなし",
    "(instrumental)",
)

# collectionName / album に含まれていたらカラオケ/インスト系
_KARAOKE_COLLECTION_KEYWORDS: tuple[str, ...] = (
    "カラオケ",
    "オルゴール",
    "ピアノで聴く",
    "music box collection",
    "instrumental cover",
    "j-pop best hit",
    "ヒットメドレー",
)


def _is_karaoke_or_cover(
    artist_name: str | None,
    track_name: str | None,
    collection_name: str | None = None,
) -> bool:
    """iTunes 結果がカラオケ/オルゴール/インスト/カバー盤かを判定する。"""
    a = (artist_name or "").lower()
    t = (track_name or "").lower()
    c = (collection_name or "").lower()
    if any(k.lower() in a for k in _KARAOKE_ARTIST_KEYWORDS):
        return True
    if any(k.lower() in t for k in _KARAOKE_TRACK_KEYWORDS):
        return True
    if any(k.lower() in c for k in _KARAOKE_COLLECTION_KEYWORDS):
        return True
    return False


def is_cached_track_karaoke(track: dict | "ItunesTrack" | None) -> bool:
    """既存キャッシュエントリが汚染されているかの判定 (cache invalidation 用)。

    キャッシュは ItunesTrack の dataclass フィールドのみを保存しているため
    collection 情報は無い。artist + track だけで判定する。
    """
    if track is None:
        return False
    if isinstance(track, dict):
        return _is_karaoke_or_cover(
            track.get("artist_name"), track.get("track_name"), None,
        )
    return _is_karaoke_or_cover(track.artist_name, track.track_name, None)


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
        """`{title} {artist}` で検索し、類似度上位を返す。

        カラオケ練習版/オルゴール/インスト盤/カバー盤は collection/artist/track の
        キーワードで明示的に除外する。Apple Music JP には「歌っちゃ王」のような
        カラオケ練習レーベルが正式に流通しており、タイトルが完全一致するため
        本物より高スコアで選ばれてしまう (例: tuki. 「晩餐歌」が
        「歌っちゃ王」版で取られる) のを防ぐため。
        """
        # iTunes は1度の検索結果が限定的なので、widely 検索し filter して残す
        raw = self.search(f"{title} {artist}", limit=10)
        if not raw:
            raw = self.search(artist, limit=15)
            if not raw:
                return None

        # カラオケ/カバー/インスト/オルゴール盤を除外
        results = [r for r in raw if not _is_karaoke_or_cover(
            r.get("artistName"), r.get("trackName"), r.get("collectionName"),
        )]
        if not results:
            logger.info("itunes: all results filtered as karaoke/cover for %r %r",
                        title, artist)
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
