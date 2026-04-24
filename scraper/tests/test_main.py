"""main.py の出力ヘルパーのテスト。"""

from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

from fetch_spotify import SpotifyTrack
from main import (
    _build_enriched,
    _write_report,
    _write_songs_seed,
    _write_unmatched_csv,
)
from matcher import MatchResult
from models import RawSong


def _mk_match(
    title: str = "Lemon",
    artist: str = "米津玄師",
    matched: bool = True,
    strategy: str = "strict",
) -> MatchResult:
    song = RawSong(
        title=title,
        artist=artist,
        is_featured=True,
        range_high_midi=67,
        range_low_midi=53,
        falsetto_max_midi=72,
        source_url="https://karaoto.net/max_key/34",
    )
    track = (
        SpotifyTrack(
            id="abc",
            title=title,
            artists=[artist],
            release_date="2018-03-14",
            image_url_large="L",
            image_url_medium="M",
            image_url_small="S",
        )
        if matched
        else None
    )
    return MatchResult(
        raw_song=song,
        track=track,
        similarity=1.0 if matched else 0.0,
        strategy=strategy if matched else "unmatched",
        reason="" if matched else "no_spotify_hit_or_low_similarity",
    )


class TestBuildEnriched:
    def test_all_fields_populated(self) -> None:
        enriched = _build_enriched(_mk_match())
        assert enriched.title == "Lemon"
        assert enriched.artist == "米津玄師"
        assert enriched.release_year == 2018
        assert enriched.spotify_track_id == "abc"
        assert enriched.range_low_midi == 53
        assert enriched.range_high_midi == 67
        assert enriched.falsetto_max_midi == 72
        assert enriched.source_urls == [
            "https://karaoto.net/max_key/34",
            "https://open.spotify.com/track/abc",
        ]


class TestWriteSongsSeed:
    def test_json_shape(self, tmp_path: Path) -> None:
        enriched = [_build_enriched(_mk_match())]
        path = tmp_path / "songs_seed.json"
        scraped_at = datetime(2026, 4, 25, tzinfo=timezone.utc)
        _write_songs_seed(enriched, path, scraped_at)

        data = json.loads(path.read_text(encoding="utf-8"))
        assert "songs" in data
        assert "metadata" in data
        assert len(data["songs"]) == 1
        assert data["songs"][0]["spotify_track_id"] == "abc"
        assert data["metadata"]["total_count"] == 1
        assert "karaoto.net" in data["metadata"]["sources"]
        # 日本語はエスケープされない
        assert "米津玄師" in path.read_text(encoding="utf-8")


class TestWriteUnmatchedCsv:
    def test_rows_written(self, tmp_path: Path) -> None:
        unmatched = [
            _mk_match(title="幻", artist="ヨルシカ", matched=False),
            _mk_match(title="Bogus", artist="Unknown", matched=False),
        ]
        path = tmp_path / "unmatched.csv"
        _write_unmatched_csv(unmatched, path)

        with path.open(encoding="utf-8") as f:
            rows = list(csv.reader(f))
        assert rows[0] == ["title", "artist", "karaoto_url", "reason"]
        assert rows[1][0] == "幻"
        assert rows[2][0] == "Bogus"
        assert "no_spotify" in rows[1][3]


class TestWriteReport:
    def test_report_contents(self, tmp_path: Path) -> None:
        matched = [
            _mk_match(strategy="strict"),
            _mk_match(strategy="strict"),
            _mk_match(strategy="strict_alias"),
        ]
        unmatched = [_mk_match(matched=False)]
        path = tmp_path / "report.md"
        _write_report(
            total=4,
            matched=matched,
            unmatched=unmatched,
            elapsed_sec=123.4,
            path=path,
            scraped_at=datetime(2026, 4, 25, 10, 30, 0, tzinfo=timezone.utc),
        )
        content = path.read_text(encoding="utf-8")
        assert "75.0%" in content  # 3/4
        assert "strict: 2" in content
        assert "strict_alias: 1" in content
        assert "未マッチ: 1" in content
