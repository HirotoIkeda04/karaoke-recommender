"""note_converter のテスト。"""

from __future__ import annotations

import pytest

from note_converter import (
    MIDI_MAX,
    MIDI_MIN,
    NOTE_TABLE,
    karaoke_to_midi,
    midi_to_karaoke,
    normalize_notation,
)


class TestKaraokeToMidi:
    """カラオケ表記 → MIDI 番号。"""

    @pytest.mark.parametrize(
        ("notation", "expected"),
        [
            # 基準点
            ("hiA", 69),
            # mid2 範囲(spec 資料にある代表値)
            ("mid2C", 60),
            ("mid2G", 67),
            # lowG (C 基準だと G2 = 43)
            ("lowG", 43),
            # 両端
            ("lowlowA", 21),
            ("hihiG#", 92),
            # オクターブ境界: mid2G# の次は hiA
            ("mid2G#", 68),
            ("hiA", 69),
            # シャープ
            ("mid1C#", 49),
            ("hiF#", 78),
        ],
    )
    def test_basic_conversions(self, notation: str, expected: int) -> None:
        assert karaoke_to_midi(notation) == expected

    def test_fullwidth_sharp(self) -> None:
        """全角 ♯ が # に正規化される。"""
        assert karaoke_to_midi("mid2F♯") == 66

    def test_fullwidth_letters(self) -> None:
        """全角英字が半角に正規化される。"""
        assert karaoke_to_midi("ｈｉＡ") == 69

    def test_surrounding_whitespace(self) -> None:
        """前後の空白は無視。"""
        assert karaoke_to_midi("  mid2G  ") == 67

    def test_unknown_notation_raises(self) -> None:
        with pytest.raises(ValueError, match="Unknown karaoke notation"):
            karaoke_to_midi("bogusX")

    def test_flat_notation_raises(self) -> None:
        """♭ は現状サポート外 (NOTE_TABLE に無いため ValueError)。"""
        with pytest.raises(ValueError):
            karaoke_to_midi("hiA♭")


class TestMidiToKaraoke:
    """MIDI 番号 → カラオケ表記。"""

    @pytest.mark.parametrize(
        ("midi", "expected"),
        [
            (21, "lowlowA"),
            (43, "lowG"),
            (60, "mid2C"),
            (67, "mid2G"),
            (68, "mid2G#"),
            (69, "hiA"),
            (72, "hiC"),
            (77, "hiF"),
            (92, "hihiG#"),
        ],
    )
    def test_basic_conversions(self, midi: int, expected: str) -> None:
        assert midi_to_karaoke(midi) == expected

    def test_below_range(self) -> None:
        with pytest.raises(ValueError, match="out of supported range"):
            midi_to_karaoke(MIDI_MIN - 1)

    def test_above_range(self) -> None:
        with pytest.raises(ValueError, match="out of supported range"):
            midi_to_karaoke(MIDI_MAX + 1)


class TestRoundTrip:
    """NOTE_TABLE の全エントリが可逆であることを保証。"""

    def test_all_notations_roundtrip(self) -> None:
        for notation, midi in NOTE_TABLE.items():
            assert karaoke_to_midi(notation) == midi
            assert midi_to_karaoke(midi) == notation

    def test_consecutive_midi_numbers(self) -> None:
        """MIDI 番号が連続していることを確認(抜けが無い)。"""
        midis = sorted(NOTE_TABLE.values())
        assert midis == list(range(MIDI_MIN, MIDI_MAX + 1))

    def test_octave_boundary_at_a(self) -> None:
        """G# の次が A にジャンプする(C 基準ではない)。"""
        # mid2G# (68) の次の半音は hiA (69)
        assert midi_to_karaoke(68) == "mid2G#"
        assert midi_to_karaoke(69) == "hiA"
        # hiG# (80) の次の半音は hihiA (81)
        assert midi_to_karaoke(80) == "hiG#"
        assert midi_to_karaoke(81) == "hihiA"


class TestNormalizeNotation:
    """表記正規化単体のテスト。spec 5.2 は英字と # のみ正規化対象。"""

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("hiA", "hiA"),
            ("mid2F♯", "mid2F#"),
            ("ｈｉＡ", "hiA"),  # 全角英字 → 半角
            ("  hiC  ", "hiC"),  # 前後空白
            ("hi A", "hiA"),  # 内部の半角スペース除去
            ("hi　A", "hiA"),  # 全角スペース除去
            ("mid2F＃", "mid2F#"),  # 全角 # → 半角 #
            ("‎mid1D#", "mid1D#"),  # LRM 混入 (karaoto 実データに存在)
            ("﻿hiA", "hiA"),  # BOM 混入
        ],
    )
    def test_normalize(self, raw: str, expected: str) -> None:
        assert normalize_notation(raw) == expected
