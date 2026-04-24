"""scrape_karaoto のパーサテスト。実 HTML の fixture に対して行う。"""

from __future__ import annotations

from pathlib import Path

import pytest

from scrape_karaoto import MAX_KEY_TO_MIDI, build_page_url, parse_page

FIXTURE_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def page_34_html() -> str:
    return (FIXTURE_DIR / "karaoto_max_key_34.html").read_text(encoding="utf-8")


class TestParsePage:
    def test_returns_songs(self, page_34_html: str) -> None:
        songs = parse_page(page_34_html, 34, "https://karaoto.net/max_key/34")
        assert len(songs) > 100

    def test_all_high_midi_match_page(self, page_34_html: str) -> None:
        """page 34 の曲はすべて最高音 = mid2G (MIDI 67)。"""
        songs = parse_page(page_34_html, 34, build_page_url(34))
        assert all(s.range_high_midi == MAX_KEY_TO_MIDI[34] for s in songs)

    def test_artist_attached(self, page_34_html: str) -> None:
        songs = parse_page(page_34_html, 34, build_page_url(34))
        # ASIAN KUNG-FU GENERATION の "青空と黒い猫" が含まれる
        akfg_songs = [s for s in songs if s.artist == "ASIAN KUNG-FU GENERATION"]
        assert any(s.title == "青空と黒い猫" for s in akfg_songs)

    def test_featured_flag_from_bold(self, page_34_html: str) -> None:
        songs = parse_page(page_34_html, 34, build_page_url(34))
        # "今を生きて" は <b> 囲み → 代表曲
        matched = [
            s for s in songs
            if s.artist == "ASIAN KUNG-FU GENERATION" and s.title == "今を生きて"
        ]
        assert len(matched) == 1
        assert matched[0].is_featured is True

    def test_non_featured(self, page_34_html: str) -> None:
        songs = parse_page(page_34_html, 34, build_page_url(34))
        matched = [
            s for s in songs
            if s.artist == "ASIAN KUNG-FU GENERATION" and s.title == "青空と黒い猫"
        ]
        assert len(matched) == 1
        assert matched[0].is_featured is False

    def test_low_key_parsed(self, page_34_html: str) -> None:
        songs = parse_page(page_34_html, 34, build_page_url(34))
        target = next(
            s for s in songs
            if s.artist == "ASIAN KUNG-FU GENERATION" and s.title == "青空と黒い猫"
        )
        # 地声: mid1C (MIDI 48) 〜 mid2G (MIDI 67)
        assert target.range_low_midi == 48
        assert target.range_high_midi == 67

    def test_falsetto_parsed(self, page_34_html: str) -> None:
        songs = parse_page(page_34_html, 34, build_page_url(34))
        target = next(
            s for s in songs
            if s.artist == "ASIAN KUNG-FU GENERATION" and s.title == "青空と黒い猫"
        )
        # 裏高: hiC (MIDI 72)
        assert target.falsetto_max_midi == 72

    def test_no_falsetto(self, page_34_html: str) -> None:
        """「裏声：-」は falsetto_max_midi が None。"""
        songs = parse_page(page_34_html, 34, build_page_url(34))
        target = next(
            s for s in songs
            if s.artist == "ASIAN KUNG-FU GENERATION" and s.title == "永遠に"
        )
        assert target.falsetto_max_midi is None

    def test_low_key_missing_tolerated(self, page_34_html: str) -> None:
        """min_key が空文字 (<span class="min_key"></span>) でも例外にならず None で埋める。"""
        songs = parse_page(page_34_html, 34, build_page_url(34))
        target = next(
            s for s in songs
            if s.artist == "ASIAN KUNG-FU GENERATION" and s.title == "24時"
        )
        assert target.range_low_midi is None
        assert target.range_high_midi == 67

    def test_song_info_parsed(self, page_34_html: str) -> None:
        """発売日 + 収録アルバム + ドラマ情報。"""
        songs = parse_page(page_34_html, 34, build_page_url(34))
        # "メリーアン" by THE ALFEE: 発売日:1983/06/21, 収録アルバム『ALFEE A面 コレクション』
        target = next(
            s for s in songs
            if s.artist == "THE ALFEE" and s.title == "メリーアン"
        )
        assert target.release_date == "1983/06/21"
        assert target.album == "ALFEE A面 コレクション"

    def test_tie_up_parsed(self, page_34_html: str) -> None:
        """WISH (嵐): ドラマ『花より男子』主題歌 を抜き出せる。"""
        songs = parse_page(page_34_html, 34, build_page_url(34))
        target = next(
            s for s in songs if s.artist == "嵐" and s.title == "WISH"
        )
        assert target.album == "ARASHIC"
        assert target.tie_up is not None
        assert "花より男子" in target.tie_up

    def test_invalid_max_key_raises(self) -> None:
        with pytest.raises(ValueError, match="Unknown max_key page"):
            parse_page("<html></html>", 99, "irrelevant")


class TestBuildPageUrl:
    def test_url_format(self) -> None:
        assert build_page_url(34) == "https://karaoto.net/max_key/34"
