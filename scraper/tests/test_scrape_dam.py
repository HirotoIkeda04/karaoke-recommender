"""scrape_dam のパーサテスト。実 HTML の fixture に対して行う。"""

from __future__ import annotations

from pathlib import Path

import pytest

from scrape_dam import parse_page

FIXTURE_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def main_html() -> str:
    return (FIXTURE_DIR / "dam_ranking_main.html").read_text(encoding="utf-8")


class TestParsePage:
    def test_returns_songs(self, main_html: str) -> None:
        songs = parse_page(main_html, "main")
        # main ページはデイリー/週間/月間 TOP50 の合算で 100 曲以上の重複前内訳
        assert len(songs) >= 50

    def test_request_no_format(self, main_html: str) -> None:
        songs = parse_page(main_html, "main")
        # DAM の requestNo は "XXXX-YY" の形式
        for s in songs:
            assert "-" in s.request_no
            head, _, tail = s.request_no.partition("-")
            assert head.isdigit() and tail.isdigit()

    def test_no_empty_fields(self, main_html: str) -> None:
        songs = parse_page(main_html, "main")
        for s in songs:
            assert s.title and s.title.strip()
            assert s.artist and s.artist.strip()
            assert s.request_no

    def test_dedup_within_page(self, main_html: str) -> None:
        songs = parse_page(main_html, "main")
        keys = [(s.title, s.artist, s.request_no) for s in songs]
        assert len(keys) == len(set(keys)), "duplicates within single page"

    def test_source_pages_set(self, main_html: str) -> None:
        songs = parse_page(main_html, "main")
        for s in songs:
            assert s.source_pages == ("main",)

    def test_empty_html(self) -> None:
        assert parse_page("", "main") == []
