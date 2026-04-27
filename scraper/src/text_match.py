"""タイトル/アーティスト名のマッチング用ユーティリティ。

複数モジュール (iTunes 検索、karaoto クロスリファレンス) で同一ロジックを使うため
共通化。表記ゆれの吸収方針:

- lowercase
- 半角/全角の括弧で囲まれた部分を除去 (例: "(feat.…)", "(TV size)" 等のサフィックス)
- 角括弧/隅付き括弧 [], 【】 も同様
- "feat./featuring/with X" 以降を除去
- 英数 + 日本語以外 (記号, 空白) を除去
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

_RE_PARENS = re.compile(r"[（(][^）)]*[）)]")
_RE_BRACKETS = re.compile(r"[\[【][^\]】]*[\]】]")
_RE_FEAT = re.compile(r"\b(?:feat\.?|featuring|with)\b.*", re.IGNORECASE)
_RE_NONALNUM = re.compile(r"[^\w぀-ゟ゠-ヿ一-鿿]+")


def normalize(s: str) -> str:
    """マッチング用の正規化文字列を返す。空文字も妥当な戻り値。"""
    s = s.lower()
    s = _RE_PARENS.sub("", s)
    s = _RE_BRACKETS.sub("", s)
    s = _RE_FEAT.sub("", s)
    s = _RE_NONALNUM.sub("", s)
    return s.strip()


def similarity(a: str, b: str) -> float:
    na, nb = normalize(a), normalize(b)
    if not na or not nb:
        return 0.0
    return SequenceMatcher(None, na, nb).ratio()
