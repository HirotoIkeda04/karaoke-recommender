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
    "オフ・ボーカル",
    "(原曲歌手",   # 「(原曲歌手:tuki.)」← 歌っちゃ王系の最大の目印
    "[原曲歌手",
    "(ガイド",
    "ガイド無し",
    "ガイドなし",
    # instrumental 系 (本物の楽曲でも別 version として並列リリースされる)
    "(instrumental",
    "[instrumental",
    " - instrumental",
    "(inst.)",
    "(inst)",
    "(オリジナル・カラオケ)",
    "(off-vocal)",
    "オリジナル・カラオケ",
    # tv-size / movie-size / short version 等の縮小版
    "(tv size)",
    "(tv-size)",
    "(tv version)",
    "(tv ver",
    "(tvサイズ)",
    "(tv-edit)",
    "(short ver",
    "(short version)",
    "(short edit)",
    "(movie size)",
    "(movie ver",
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

    def search_and_pick(
        self,
        title: str,
        artist: str,
        expected_year: int | None = None,
    ) -> tuple[list[dict], ItunesTrack | None]:
        """検索 + 選定を行い (raw_results, picked_track) を返す。

        raw_results はキャッシュ用 (raw を持っておけば後でロジックを変えても
        再 fetch 不要)。
        """
        raw = self.search(f"{title} {artist}", limit=10)
        if not raw:
            raw = self.search(artist, limit=15)
        track = pick_best_from_raw(raw, title, artist, expected_year)
        return raw, track

    def best_match(
        self,
        title: str,
        artist: str,
        expected_year: int | None = None,
    ) -> ItunesTrack | None:
        """既存 API 互換ラッパ (raw を捨てて picked のみ返す)。"""
        _, track = self.search_and_pick(title, artist, expected_year)
        return track

    def _to_track(self, r: dict, similarity: float) -> ItunesTrack:
        return _to_track(r, similarity)


# --- raw 結果からの選定ロジック (cache-friendly) -----------------------------

def _is_single(result: dict) -> bool:
    """iTunes 結果がシングル盤かを判定する。

    - collectionName が " - Single" / " - EP" 末尾はシングル系扱い
      (本当の "EP" はシングルとは別物だが、原曲リリース時の小規模な単独
       リリースであることが多く、アルバムよりはシングルに近い)
    - trackCount が 1-2 ならシングル扱い (フォールバック)
    """
    cname = (result.get("collectionName") or "")
    if cname.endswith(" - Single"):
        return True
    if cname.endswith(" - EP"):
        return True
    track_count = result.get("trackCount", 0)
    if isinstance(track_count, int) and 1 <= track_count <= 2:
        return True
    return False


def _release_date_str(result: dict) -> str:
    """YYYY-MM-DD 形式の releaseDate (無ければ '9999-12-31' でソート末尾に)。"""
    return (result.get("releaseDate") or "9999-12-31")[:10]


def _release_year(result: dict) -> int | None:
    s = (result.get("releaseDate") or "")[:4]
    return int(s) if s.isdigit() else None


def _to_track(r: dict, similarity_score: float) -> ItunesTrack:
    url100 = r.get("artworkUrl100")
    return ItunesTrack(
        track_name=r.get("trackName", ""),
        artist_name=r.get("artistName", ""),
        artwork_url_60=r.get("artworkUrl60"),
        artwork_url_100=url100,
        artwork_url_600=upgrade_artwork(url100, 600),
        release_year=_release_year(r),
        track_view_url=r.get("trackViewUrl"),
        similarity=similarity_score,
    )


# 上位スコアと見なすしきい値 (best - SCORE_TIER_TOLERANCE 以上は同等扱い)
SCORE_TIER_TOLERANCE = 0.05


def pick_best_from_raw(
    raw_results: list[dict],
    title: str,
    artist: str,
    expected_year: int | None = None,
) -> ItunesTrack | None:
    """検索結果群 (raw) から最良の 1 件を選ぶ。

    優先順位:
        1. カラオケ/カバー/インスト盤を除外
        2. (title, artist) 類似度がしきい値以上
        3. 上位スコア群 (best - SCORE_TIER_TOLERANCE) の中で
           a. expected_year (= 元曲発売年) との差が小さいもの
           b. シングル盤 (collectionName " - Single" 等) を優先
           c. 最古の releaseDate (= 初発売)
           d. スコア降順 (タイブレーク)

    expected_year:
        曲の本来の発売年 (karaoto から取れる場合)。未指定なら top tier の
        最古 releaseDate を「初発売」と見なして自動推定する。
    """
    if not raw_results:
        return None

    # 1. カラオケ等除外
    candidates = [
        r for r in raw_results
        if not _is_karaoke_or_cover(
            r.get("artistName"), r.get("trackName"), r.get("collectionName"),
        )
    ]
    if not candidates:
        logger.info("itunes: all results filtered as karaoke/cover for %r %r",
                    title, artist)
        return None

    # 2. 類似度スコア計算
    scored: list[tuple[float, dict]] = []
    for r in candidates:
        t_sim = _similarity(title, r.get("trackName", ""))
        a_sim = _similarity(artist, r.get("artistName", ""))
        score = t_sim * 0.7 + a_sim * 0.3
        if score < MIN_SIMILARITY:
            continue
        scored.append((score, r))
    if not scored:
        return None

    # 3. 上位スコア群を抽出
    best_score = max(s for s, _ in scored)
    top_tier = [(s, r) for s, r in scored if s >= best_score - SCORE_TIER_TOLERANCE]

    # 3a. expected_year 自動推定 (top tier の最古年)
    if expected_year is None:
        years = [_release_year(r) for _, r in top_tier]
        years = [y for y in years if y is not None]
        if years:
            expected_year = min(years)

    def sort_key(item: tuple[float, dict]) -> tuple:
        score, r = item
        ryear = _release_year(r)
        year_diff = abs(ryear - expected_year) if (ryear and expected_year) else 99
        is_sing = _is_single(r)
        return (
            year_diff,                # 年の近さ (近い順)
            0 if is_sing else 1,      # シングル優先
            _release_date_str(r),     # 早い順 (タイブレーク)
            -score,                   # スコア降順 (最終タイブレーク)
        )

    top_tier.sort(key=sort_key)
    selected_score, selected_r = top_tier[0]
    return _to_track(selected_r, selected_score)
