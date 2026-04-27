"""karaoto.net 由来の楽曲メタを (title, artist) で引ける形にインデックス化。

DAM ランキング曲には音域(地声/裏声)情報が無いが、karaoto.net には
ある。同じ曲が両方にあれば karaoto から range_*_midi を補完できる。

このモジュールは scraper/cache/karaoto/ にキャッシュ済の HTML から
全曲(代表曲フラグ無関係に ~3000 曲) を読み出し、正規化キーで dict 化する。
ネットワーク call は不要(キャッシュ前提)。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from models import RawSong
from scrape_karaoto import fetch_all_pages, parse_all
from text_match import normalize

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class KaraotoEntry:
    """karaoto から得た音域メタの最小セット。"""
    range_low_midi: int | None
    range_high_midi: int | None
    falsetto_max_midi: int | None
    source_url: str
    is_featured: bool


def _key(title: str, artist: str) -> tuple[str, str]:
    return (normalize(title), normalize(artist))


def build_index(
    cache_dir: Path,
    contact_email: str,
) -> dict[tuple[str, str], KaraotoEntry]:
    """全 karaoto 曲を (norm_title, norm_artist) でインデックス化。

    同一キーに複数曲があった場合は featured (代表曲) を優先、
    それでも複数あれば最初の 1 つを採用する。
    """
    htmls = fetch_all_pages(cache_dir, contact_email)
    songs: list[RawSong] = parse_all(htmls)
    logger.info("loaded %d karaoto raw songs from cache", len(songs))

    # featured 優先で並べ、最初に出会ったものを採用
    songs.sort(key=lambda s: (not s.is_featured,))

    index: dict[tuple[str, str], KaraotoEntry] = {}
    for song in songs:
        k = _key(song.title, song.artist)
        if k in index:
            continue
        index[k] = KaraotoEntry(
            range_low_midi=song.range_low_midi,
            range_high_midi=song.range_high_midi,
            falsetto_max_midi=song.falsetto_max_midi,
            source_url=song.source_url,
            is_featured=song.is_featured,
        )

    logger.info("karaoto index: %d unique (title, artist) keys", len(index))
    return index


def lookup(
    title: str,
    artist: str,
    index: dict[tuple[str, str], KaraotoEntry],
) -> KaraotoEntry | None:
    return index.get(_key(title, artist))
