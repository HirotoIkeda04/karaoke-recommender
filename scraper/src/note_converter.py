"""カラオケ音域表記と MIDI note number の相互変換。

基準: hiA = A4 = MIDI 69
オクターブ境界は A (A→G#)。C 基準ではない点に注意。
"""

from __future__ import annotations

# カラオケ表記 → MIDI 番号
# lowlowA (21) = A0 から hihiG# (92) = G#6 までカバー
NOTE_TABLE: dict[str, int] = {
    # lowlow 範囲 (A0 - G#1)
    "lowlowA": 21, "lowlowA#": 22, "lowlowB": 23,
    "lowlowC": 24, "lowlowC#": 25, "lowlowD": 26, "lowlowD#": 27,
    "lowlowE": 28, "lowlowF": 29, "lowlowF#": 30, "lowlowG": 31, "lowlowG#": 32,
    # low 範囲 (A1 - G#2)
    "lowA": 33, "lowA#": 34, "lowB": 35,
    "lowC": 36, "lowC#": 37, "lowD": 38, "lowD#": 39,
    "lowE": 40, "lowF": 41, "lowF#": 42, "lowG": 43, "lowG#": 44,
    # mid1 範囲 (A2 - G#3)
    "mid1A": 45, "mid1A#": 46, "mid1B": 47,
    "mid1C": 48, "mid1C#": 49, "mid1D": 50, "mid1D#": 51,
    "mid1E": 52, "mid1F": 53, "mid1F#": 54, "mid1G": 55, "mid1G#": 56,
    # mid2 範囲 (A3 - G#4)
    "mid2A": 57, "mid2A#": 58, "mid2B": 59,
    "mid2C": 60, "mid2C#": 61, "mid2D": 62, "mid2D#": 63,
    "mid2E": 64, "mid2F": 65, "mid2F#": 66, "mid2G": 67, "mid2G#": 68,
    # hi 範囲 (A4 - G#5)
    "hiA": 69, "hiA#": 70, "hiB": 71,
    "hiC": 72, "hiC#": 73, "hiD": 74, "hiD#": 75,
    "hiE": 76, "hiF": 77, "hiF#": 78, "hiG": 79, "hiG#": 80,
    # hihi 範囲 (A5 - G#6)
    "hihiA": 81, "hihiA#": 82, "hihiB": 83,
    "hihiC": 84, "hihiC#": 85, "hihiD": 86, "hihiD#": 87,
    "hihiE": 88, "hihiF": 89, "hihiF#": 90, "hihiG": 91, "hihiG#": 92,
}

# 逆引き: MIDI → カラオケ表記
REVERSE_NOTE_TABLE: dict[int, str] = {v: k for k, v in NOTE_TABLE.items()}

MIDI_MIN = min(NOTE_TABLE.values())  # 21
MIDI_MAX = max(NOTE_TABLE.values())  # 92


# 不可視文字 (双方向制御・ゼロ幅系) を除去
_INVISIBLE_CHARS = {
    "​",  # ZERO WIDTH SPACE
    "‌",  # ZERO WIDTH NON-JOINER
    "‍",  # ZERO WIDTH JOINER
    "‎",  # LEFT-TO-RIGHT MARK
    "‏",  # RIGHT-TO-LEFT MARK
    "﻿",  # BYTE ORDER MARK
}


def normalize_notation(raw: str) -> str:
    """表記揺れを吸収。

    - 前後空白を除去
    - ♯ → #
    - 全角英字・#・スペース → 半角
    - 不可視制御文字 (LRM/BOM 等) を除去
    - ♭ は ``b`` に置換するのみ(MIDI 表には含まれないため、呼び出し側でエラーになる)
    """
    s = raw.strip()
    s = s.replace("♯", "#").replace("♭", "b")
    result: list[str] = []
    for ch in s:
        if ch in _INVISIBLE_CHARS:
            continue
        code = ord(ch)
        if 0xFF21 <= code <= 0xFF3A:  # FULLWIDTH A-Z
            result.append(chr(code - 0xFF21 + ord("A")))
        elif 0xFF41 <= code <= 0xFF5A:  # FULLWIDTH a-z
            result.append(chr(code - 0xFF41 + ord("a")))
        elif code == 0xFF03:  # FULLWIDTH #
            result.append("#")
        elif code == 0x3000:  # 全角スペース
            continue
        else:
            result.append(ch)
    return "".join(result).replace(" ", "")


def karaoke_to_midi(notation: str) -> int:
    """カラオケ表記を MIDI 番号に変換。未知の表記は ``ValueError``。"""
    normalized = normalize_notation(notation)
    if normalized not in NOTE_TABLE:
        raise ValueError(
            f"Unknown karaoke notation: {notation!r} (normalized: {normalized!r})"
        )
    return NOTE_TABLE[normalized]


def midi_to_karaoke(midi: int) -> str:
    """MIDI 番号をカラオケ表記に変換。範囲外は ``ValueError``。"""
    if midi not in REVERSE_NOTE_TABLE:
        raise ValueError(
            f"MIDI {midi} is out of supported range ({MIDI_MIN}-{MIDI_MAX})"
        )
    return REVERSE_NOTE_TABLE[midi]
