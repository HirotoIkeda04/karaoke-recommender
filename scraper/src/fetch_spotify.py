"""Spotify Web API クライアント。

Client Credentials フローで認証し、``/v1/search`` で楽曲検索を行う。
トークンは期限切れまでインメモリにキャッシュし、期限超過時のみ再発行。
"""

from __future__ import annotations

import logging
import time
from base64 import b64encode
from dataclasses import dataclass
from typing import Any

import requests

logger = logging.getLogger(__name__)

TOKEN_URL = "https://accounts.spotify.com/api/token"
SEARCH_URL = "https://api.spotify.com/v1/search"
DEFAULT_MARKET = "JP"
REQUEST_TIMEOUT_SEC = 30
# Spotify は通常 60s で expire しないが安全側に 60s 前倒しで再発行
TOKEN_EXPIRY_BUFFER_SEC = 60
# これを超える Retry-After は「今日の quota 超過」とみなして即 fail
MAX_RETRY_AFTER_SEC = 120


class SpotifyQuotaExceeded(RuntimeError):
    """Spotify の日次 quota を使い切った状態。呼び出し側で特別扱いする。"""

    def __init__(self, retry_after_sec: int) -> None:
        super().__init__(
            f"Spotify returned Retry-After={retry_after_sec}s (> {MAX_RETRY_AFTER_SEC}s); "
            f"quota likely exceeded"
        )
        self.retry_after_sec = retry_after_sec


@dataclass
class SpotifyTrack:
    id: str
    title: str
    artists: list[str]
    release_date: str  # "YYYY", "YYYY-MM", or "YYYY-MM-DD"
    image_url_large: str | None  # ≥ 600 px
    image_url_medium: str | None  # ~300 px
    image_url_small: str | None  # ≤ 200 px

    @property
    def artists_joined(self) -> str:
        return ", ".join(self.artists)

    @property
    def release_year(self) -> int | None:
        if not self.release_date:
            return None
        try:
            return int(self.release_date[:4])
        except ValueError:
            return None


def _pick_images(
    images: list[dict[str, Any]],
) -> tuple[str | None, str | None, str | None]:
    """large (≥600), medium (~300), small (<=200) を選ぶ。

    Spotify は typically 640 / 300 / 64 の 3 枚を返す。欠損時は高さでベストマッチ。
    """
    if not images:
        return None, None, None

    def by_height_desc() -> list[dict[str, Any]]:
        return sorted(images, key=lambda i: i.get("height") or 0, reverse=True)

    sorted_imgs = by_height_desc()
    large = next((i for i in sorted_imgs if (i.get("height") or 0) >= 500), sorted_imgs[0])
    medium = next(
        (i for i in sorted_imgs if 200 <= (i.get("height") or 0) < 500),
        sorted_imgs[len(sorted_imgs) // 2],
    )
    small = next(
        (i for i in reversed(sorted_imgs) if (i.get("height") or 0) <= 200),
        sorted_imgs[-1],
    )
    return large.get("url"), medium.get("url"), small.get("url")


def _track_from_api(item: dict[str, Any]) -> SpotifyTrack:
    album = item.get("album") or {}
    large, medium, small = _pick_images(album.get("images") or [])
    return SpotifyTrack(
        id=item["id"],
        title=item.get("name", ""),
        artists=[a.get("name", "") for a in (item.get("artists") or [])],
        release_date=album.get("release_date", ""),
        image_url_large=large,
        image_url_medium=medium,
        image_url_small=small,
    )


class SpotifyClient:
    """最低限の Spotify クライアント。Client Credentials のみ対応。"""

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        market: str = DEFAULT_MARKET,
        session: requests.Session | None = None,
    ) -> None:
        if not client_id or not client_secret:
            raise ValueError("Spotify client_id / client_secret must be non-empty")
        self._client_id = client_id
        self._client_secret = client_secret
        self._market = market
        self._session = session or requests.Session()
        self._token: str | None = None
        self._token_expires_at: float = 0.0

    def _fetch_token(self) -> None:
        credentials = f"{self._client_id}:{self._client_secret}"
        basic = b64encode(credentials.encode("utf-8")).decode("ascii")
        resp = self._session.post(
            TOKEN_URL,
            headers={
                "Authorization": f"Basic {basic}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={"grant_type": "client_credentials"},
            timeout=REQUEST_TIMEOUT_SEC,
        )
        resp.raise_for_status()
        body = resp.json()
        self._token = body["access_token"]
        expires_in = int(body.get("expires_in", 3600))
        self._token_expires_at = time.monotonic() + expires_in - TOKEN_EXPIRY_BUFFER_SEC
        logger.info("spotify: new token (expires in %ds)", expires_in)

    def _ensure_token(self) -> str:
        if self._token is None or time.monotonic() >= self._token_expires_at:
            self._fetch_token()
        assert self._token is not None  # noqa: S101
        return self._token

    def search_track(
        self, title: str, artist: str, limit: int = 5, raw_query: str | None = None
    ) -> list[SpotifyTrack]:
        """(title, artist) で検索。raw_query を指定すると q をそのまま使う (fallback 用)。"""
        query = raw_query or f"track:{title} artist:{artist}"
        params = {
            "q": query,
            "type": "track",
            "market": self._market,
            "limit": str(limit),
        }
        # レート制限 (429) を 1 度だけリトライ
        for attempt in range(2):
            token = self._ensure_token()
            resp = self._session.get(
                SEARCH_URL,
                headers={"Authorization": f"Bearer {token}"},
                params=params,
                timeout=REQUEST_TIMEOUT_SEC,
            )
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", "2"))
                if retry_after > MAX_RETRY_AFTER_SEC:
                    logger.error(
                        "spotify: Retry-After=%ds exceeds cap; treating as quota exceeded",
                        retry_after,
                    )
                    raise SpotifyQuotaExceeded(retry_after)
                logger.warning(
                    "spotify: rate limited; sleeping %ds (attempt %d)",
                    retry_after, attempt + 1,
                )
                time.sleep(retry_after)
                continue
            if resp.status_code == 401:
                logger.warning("spotify: 401, forcing token refresh")
                self._token = None
                continue
            resp.raise_for_status()
            break
        else:
            raise RuntimeError(f"Spotify search failed after retries for q={query!r}")

        items = (resp.json().get("tracks") or {}).get("items") or []
        return [_track_from_api(i) for i in items]
