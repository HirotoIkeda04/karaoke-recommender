"""環境変数 / 定数の集約。

Spotify 資格情報と連絡先は基本的に親 Next.js プロジェクトの ``.env.local`` に置き、
scraper/.env で上書きできる構成にする。
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

SCRAPER_ROOT = Path(__file__).resolve().parent.parent  # scraper/
PROJECT_ROOT = SCRAPER_ROOT.parent  # karaoke-recommender/

# 親の .env.local を先に読み、次に scraper/.env (override=True) で上書き
_loaded = False


def load_env() -> None:
    global _loaded
    if _loaded:
        return
    parent_env = PROJECT_ROOT / ".env.local"
    if parent_env.exists():
        load_dotenv(parent_env, override=False)
    scraper_env = SCRAPER_ROOT / ".env"
    if scraper_env.exists():
        load_dotenv(scraper_env, override=True)
    _loaded = True


def require(name: str) -> str:
    load_env()
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(
            f"Environment variable {name!r} is required. "
            f"Set it in {PROJECT_ROOT / '.env.local'} or {SCRAPER_ROOT / '.env'}."
        )
    return value


def get(name: str, default: str = "") -> str:
    load_env()
    return os.environ.get(name, default)
