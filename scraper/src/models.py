"""スクレイパ共通のデータモデル。"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class RawSong:
    """カラ音から取得した生データ。Spotify 連携前の状態。"""

    title: str
    artist: str
    is_featured: bool  # カラ音ページで <b> 囲みの代表曲フラグ
    range_high_midi: int  # 地声最高音(カラ音ページの N 値と一致)
    range_low_midi: int | None = None  # 地声最低音(省略される場合あり)
    falsetto_max_midi: int | None = None  # 裏声最高音(「裏声：-」なら None)
    release_date: str | None = None  # "YYYY/MM/DD" のまま保持
    album: str | None = None
    tie_up: str | None = None  # ドラマ/映画/アニメ主題歌等の原文
    source_url: str = ""


@dataclass
class EnrichedSong:
    """Spotify マッチ後の完全な楽曲レコード。songs_seed.json の 1 要素に対応。"""

    title: str
    artist: str
    release_year: int | None
    range_low_midi: int | None
    range_high_midi: int
    falsetto_max_midi: int | None
    spotify_track_id: str | None
    image_url_large: str | None
    image_url_medium: str | None
    image_url_small: str | None
    source_urls: list[str] = field(default_factory=list)
