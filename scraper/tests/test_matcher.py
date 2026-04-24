"""matcher のテスト (Spotify クライアントはモック)。"""

from __future__ import annotations

from unittest.mock import MagicMock

from fetch_spotify import SpotifyTrack
from matcher import (
    Matcher,
    normalize_for_compare,
    title_similarity,
)
from models import RawSong


def _mk_track(
    id_: str,
    title: str,
    artist: str = "米津玄師",
    release_date: str = "2018-03-14",
) -> SpotifyTrack:
    return SpotifyTrack(
        id=id_,
        title=title,
        artists=[artist],
        release_date=release_date,
        image_url_large="L",
        image_url_medium="M",
        image_url_small="S",
    )


def _mk_song(title: str, artist: str = "米津玄師") -> RawSong:
    return RawSong(
        title=title,
        artist=artist,
        is_featured=False,
        range_high_midi=67,
    )


class TestNormalizeForCompare:
    def test_nfkc_fullwidth(self) -> None:
        assert normalize_for_compare("Ｌｅｍｏｎ") == "lemon"

    def test_brackets_removed(self) -> None:
        assert normalize_for_compare("ひまわりの約束 (アニメ版)") == "ひまわりの約束"

    def test_symbols_removed(self) -> None:
        assert normalize_for_compare("B'z") == "bz"
        assert normalize_for_compare("Mr.Children") == "mrchildren"


class TestTitleSimilarity:
    def test_identical(self) -> None:
        assert title_similarity("Lemon", "Lemon") == 1.0

    def test_case_insensitive(self) -> None:
        assert title_similarity("Lemon", "LEMON") == 1.0

    def test_completely_different(self) -> None:
        assert title_similarity("Lemon", "Pretender") < 0.5

    def test_subtitle_tolerated(self) -> None:
        # 類似度は 0.85 以上を期待 (括弧内は正規化で除去される)
        sim = title_similarity("ひまわりの約束", "ひまわりの約束 (映画ドラえもんver.)")
        assert sim >= 0.85


class TestMatcherStrict:
    def test_strict_hit(self) -> None:
        client = MagicMock()
        client.search_track.return_value = [_mk_track("a", "Lemon")]
        m = Matcher(client)
        result = m.match(_mk_song("Lemon"))
        assert result.matched
        assert result.strategy == "strict"
        assert result.track.id == "a"
        assert result.alias_used is None

    def test_best_from_multiple_results(self) -> None:
        client = MagicMock()
        client.search_track.return_value = [
            _mk_track("noise", "Lemon (Instrumental Version)"),
            _mk_track("target", "Lemon"),
        ]
        m = Matcher(client)
        result = m.match(_mk_song("Lemon"))
        assert result.track.id == "target"


class TestMatcherAlias:
    def test_alias_tried_after_primary(self) -> None:
        """原文で hit しなかったら alias でリトライ。"""
        client = MagicMock()
        client.search_track.side_effect = [
            [],  # 原文では 0 件
            [_mk_track("a", "Lemon", artist="Kenshi Yonezu")],
        ]
        aliases = {"米津玄師": ["米津玄師", "Kenshi Yonezu"]}
        m = Matcher(client, aliases=aliases)
        result = m.match(_mk_song("Lemon"))
        assert result.matched
        assert result.strategy == "strict_alias"
        assert result.alias_used == "Kenshi Yonezu"


class TestMatcherRelaxed:
    def test_falls_back_to_symbol_stripped(self) -> None:
        """原文で 0 件 → 記号除去クエリ ("R Y U S E I") で hit → relaxed で採用。"""
        client = MagicMock()
        client.search_track.side_effect = [
            [],  # strict: "R.Y.U.S.E.I." / 三代目
            [_mk_track("x", "R.Y.U.S.E.I.", artist="三代目")],  # relaxed: "R Y U S E I"
        ]
        m = Matcher(client)
        result = m.match(_mk_song("R.Y.U.S.E.I.", artist="三代目"))
        assert result.matched
        assert result.strategy == "relaxed"
        assert result.similarity >= 0.85


class TestMatcherArtistOnly:
    def test_artist_only_threshold_met(self) -> None:
        """strict + relaxed いずれも 0 件 → artist 検索 + 類似度で採用。"""
        client = MagicMock()
        # 最初の 2 ラウンド (strict, relaxed) は全部 0 件
        # 3 ラウンド目 (artist-only) で類似タイトルが 1 件ある
        client.search_track.side_effect = [
            [],  # strict
            [],  # relaxed (title に記号があれば呼ばれる)
            [_mk_track("y", "迷子犬と雨のビート", artist="ASIAN KUNG-FU GENERATION")],
        ]
        m = Matcher(client)
        song = _mk_song("迷子犬と雨のビート", artist="ASIAN KUNG-FU GENERATION")
        # title に除去対象記号がないので relaxed はスキップされる
        # side_effect は使われた分だけ消費される
        result = m.match(song)
        assert result.matched
        # strict で見つかるはず
        assert result.track.id == "y"

    def test_low_similarity_unmatched(self) -> None:
        """全戦略で low-similarity only → unmatched。"""
        client = MagicMock()
        # strict は空。relaxed は発動しない(記号なし)。artist_only は無関係なトラック。
        client.search_track.side_effect = [
            [],  # strict
            [_mk_track("wrong", "全く違う曲", artist="X")],  # artist_only
        ]
        m = Matcher(client)
        result = m.match(_mk_song("存在しない曲"))
        assert not result.matched
        assert result.strategy == "unmatched"


class TestMatcherEmpty:
    def test_all_empty_unmatched(self) -> None:
        client = MagicMock()
        client.search_track.return_value = []
        m = Matcher(client)
        result = m.match(_mk_song("どこにもない"))
        assert not result.matched
        assert result.strategy == "unmatched"
        assert result.track is None
