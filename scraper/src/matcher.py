"""カラ音の RawSong と Spotify のトラックをマッチングする。

spec §6 の段階的フォールバック戦略を実装:

1. 厳密マッチ ``track:{title} artist:{artist}`` で検索、最上位を採用
2. 緩和マッチ: 記号/括弧を除去して再検索
3. alias 辞書のアーティスト別名で順次リトライ
4. アーティスト名のみ検索して曲名類似度 ≥ threshold の最上位を採用
5. 全敗 → unmatched
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from rapidfuzz import fuzz

from fetch_spotify import SpotifyClient, SpotifyTrack
from models import RawSong

logger = logging.getLogger(__name__)

DEFAULT_SIMILARITY_THRESHOLD = 0.85

# 除去対象の括弧類(中身ごと)
_RE_BRACKETS = re.compile(r"[(\(（【\[［〜〜～][^)\)）】\]］〜〜～]*[)\)）】\]］〜〜～]")
# 記号の単純除去 (例: アポストロフィ、ピリオド、ハイフン、中黒)
_RE_SYMBOLS = re.compile(r"[\'’‘`\.．\-ー－・,，、!！?？/／&＆\"“”]")


@dataclass
class MatchResult:
    raw_song: RawSong
    track: SpotifyTrack | None
    similarity: float  # 曲名類似度 (0.0〜1.0)。artist_only 戦略以外は 1.0 扱い
    strategy: str  # "strict", "strict_alias", "relaxed", "artist_only", "unmatched"
    alias_used: str | None = None
    reason: str = ""

    @property
    def matched(self) -> bool:
        return self.track is not None


def load_aliases(path: Path) -> dict[str, list[str]]:
    if not path.exists():
        return {}
    data: dict[str, list[str]] = json.loads(path.read_text(encoding="utf-8"))
    # 正規のアーティスト名自身もエイリアスに含めて扱いを統一
    for canonical, aliases in data.items():
        if canonical not in aliases:
            aliases.insert(0, canonical)
    return data


def normalize_for_compare(s: str) -> str:
    """類似度比較用の正規化。NFKC + 小文字化 + 記号除去。"""
    s = unicodedata.normalize("NFKC", s)
    s = _RE_BRACKETS.sub("", s)
    s = _RE_SYMBOLS.sub("", s)
    return s.lower().strip()


def title_similarity(a: str, b: str) -> float:
    """rapidfuzz の ratio を 0.0〜1.0 で返す。"""
    na = normalize_for_compare(a)
    nb = normalize_for_compare(b)
    if not na or not nb:
        return 0.0
    return fuzz.ratio(na, nb) / 100.0


def _strip_symbols_for_query(s: str) -> str:
    return _RE_BRACKETS.sub("", _RE_SYMBOLS.sub(" ", s)).strip()


class Matcher:
    def __init__(
        self,
        client: SpotifyClient,
        aliases: dict[str, list[str]] | None = None,
        threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
    ) -> None:
        self._client = client
        self._aliases = aliases or {}
        self._threshold = threshold

    def _artist_candidates(self, artist: str) -> list[str]:
        """検索に使うアーティスト名候補をリストで返す。先頭が最優先。"""
        aliases = self._aliases.get(artist)
        if aliases:
            # 原文 → その他エイリアス
            return aliases
        return [artist]

    def _best_track(
        self, tracks: list[SpotifyTrack], title: str
    ) -> tuple[SpotifyTrack | None, float]:
        """類似度最大のトラックを返す。同点は短い原文(版情報が少ない)を優先。"""
        if not tracks:
            return None, 0.0
        scored = [(t, title_similarity(title, t.title)) for t in tracks]
        # 類似度 desc、次に元タイトル長 asc("Lemon" を "Lemon (Instrumental)" より優先)
        scored.sort(key=lambda pair: (-pair[1], len(pair[0].title)))
        return scored[0]

    def match(self, song: RawSong) -> MatchResult:
        # 1. 厳密マッチ(アーティスト別名順にトライ)
        for alias in self._artist_candidates(song.artist):
            tracks = self._client.search_track(song.title, alias)
            if tracks:
                best, sim = self._best_track(tracks, song.title)
                if best is not None:
                    strategy = "strict" if alias == song.artist else "strict_alias"
                    return MatchResult(
                        raw_song=song,
                        track=best,
                        similarity=sim,
                        strategy=strategy,
                        alias_used=None if alias == song.artist else alias,
                    )

        # 2. 緩和: タイトルから記号/括弧を除去
        stripped_title = _strip_symbols_for_query(song.title)
        if stripped_title and stripped_title != song.title:
            for alias in self._artist_candidates(song.artist):
                tracks = self._client.search_track(stripped_title, alias)
                if tracks:
                    best, sim = self._best_track(tracks, song.title)
                    if best is not None and sim >= self._threshold:
                        return MatchResult(
                            raw_song=song,
                            track=best,
                            similarity=sim,
                            strategy="relaxed",
                            alias_used=None if alias == song.artist else alias,
                        )

        # 3. アーティスト名のみで検索 + 曲名類似度
        for alias in self._artist_candidates(song.artist):
            tracks = self._client.search_track(
                song.title, alias, limit=10, raw_query=f"artist:{alias}"
            )
            if tracks:
                best, sim = self._best_track(tracks, song.title)
                if best is not None and sim >= self._threshold:
                    return MatchResult(
                        raw_song=song,
                        track=best,
                        similarity=sim,
                        strategy="artist_only",
                        alias_used=None if alias == song.artist else alias,
                    )

        # 4. 全敗
        return MatchResult(
            raw_song=song,
            track=None,
            similarity=0.0,
            strategy="unmatched",
            reason="no_spotify_hit_or_low_similarity",
        )
