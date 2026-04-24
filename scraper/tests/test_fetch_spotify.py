"""fetch_spotify のユニットテスト (Spotify API はモック)。

ネットワークに接続する smoke test は別途 ``tests/integration/`` で扱う想定。
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
import requests

from fetch_spotify import (
    SpotifyClient,
    SpotifyQuotaExceeded,
    _pick_images,
    _track_from_api,
)


def _mk_response(
    status: int,
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> MagicMock:
    resp = MagicMock(spec=requests.Response)
    resp.status_code = status
    resp.json.return_value = body or {}
    resp.headers = headers or {}
    # raise_for_status: 4xx/5xx で例外
    if status >= 400:
        resp.raise_for_status.side_effect = requests.HTTPError(f"{status}")
    else:
        resp.raise_for_status.return_value = None
    return resp


class TestPickImages:
    def test_three_standard_sizes(self) -> None:
        images = [
            {"url": "large.jpg", "height": 640, "width": 640},
            {"url": "medium.jpg", "height": 300, "width": 300},
            {"url": "small.jpg", "height": 64, "width": 64},
        ]
        large, medium, small = _pick_images(images)
        assert large == "large.jpg"
        assert medium == "medium.jpg"
        assert small == "small.jpg"

    def test_empty(self) -> None:
        assert _pick_images([]) == (None, None, None)

    def test_single_image(self) -> None:
        images = [{"url": "only.jpg", "height": 500}]
        large, medium, small = _pick_images(images)
        assert large == "only.jpg"
        assert small == "only.jpg"


class TestTrackFromApi:
    def test_full_record(self) -> None:
        item = {
            "id": "0WqIKmW4BTrj3eJFmnCKMv",
            "name": "Lemon",
            "artists": [{"name": "米津玄師"}],
            "album": {
                "release_date": "2018-03-14",
                "images": [
                    {"url": "L.jpg", "height": 640, "width": 640},
                    {"url": "M.jpg", "height": 300, "width": 300},
                    {"url": "S.jpg", "height": 64, "width": 64},
                ],
            },
        }
        track = _track_from_api(item)
        assert track.id == "0WqIKmW4BTrj3eJFmnCKMv"
        assert track.title == "Lemon"
        assert track.artists == ["米津玄師"]
        assert track.release_date == "2018-03-14"
        assert track.release_year == 2018
        assert track.image_url_large == "L.jpg"

    def test_multiple_artists(self) -> None:
        item = {
            "id": "X",
            "name": "Song",
            "artists": [{"name": "A"}, {"name": "B"}],
            "album": {"release_date": "2020", "images": []},
        }
        track = _track_from_api(item)
        assert track.artists_joined == "A, B"
        assert track.release_year == 2020

    def test_missing_fields(self) -> None:
        item = {"id": "x"}
        track = _track_from_api(item)
        assert track.title == ""
        assert track.artists == []
        assert track.release_date == ""
        assert track.release_year is None


class TestSpotifyClientConstruction:
    def test_requires_credentials(self) -> None:
        with pytest.raises(ValueError):
            SpotifyClient("", "secret")
        with pytest.raises(ValueError):
            SpotifyClient("id", "")


class TestSpotifyClientSearch:
    def _mk_client(self, session: MagicMock) -> SpotifyClient:
        return SpotifyClient("cid", "csecret", session=session)

    def _mk_token_response(self, expires_in: int = 3600) -> MagicMock:
        return _mk_response(200, {"access_token": "tok", "expires_in": expires_in})

    def test_search_builds_expected_query(self) -> None:
        session = MagicMock()
        session.post.return_value = self._mk_token_response()
        session.get.return_value = _mk_response(
            200,
            {"tracks": {"items": [
                {"id": "x", "name": "Lemon", "artists": [{"name": "米津玄師"}],
                 "album": {"release_date": "2018-03-14", "images": []}}
            ]}},
        )
        client = self._mk_client(session)
        tracks = client.search_track("Lemon", "米津玄師")
        assert len(tracks) == 1
        assert tracks[0].id == "x"
        # クエリ組み立てを検証
        _, kwargs = session.get.call_args
        assert kwargs["params"]["q"] == "track:Lemon artist:米津玄師"
        assert kwargs["params"]["market"] == "JP"
        assert kwargs["params"]["type"] == "track"
        # Authorization ヘッダ
        assert kwargs["headers"]["Authorization"] == "Bearer tok"

    def test_raw_query_override(self) -> None:
        session = MagicMock()
        session.post.return_value = self._mk_token_response()
        session.get.return_value = _mk_response(200, {"tracks": {"items": []}})
        client = self._mk_client(session)
        client.search_track("ignored", "ignored", raw_query="artist:ONE OK ROCK")
        _, kwargs = session.get.call_args
        assert kwargs["params"]["q"] == "artist:ONE OK ROCK"

    def test_token_reused(self) -> None:
        """期限内は同じ token を使い回す(POST は 1 回)。"""
        session = MagicMock()
        session.post.return_value = self._mk_token_response()
        session.get.return_value = _mk_response(200, {"tracks": {"items": []}})
        client = self._mk_client(session)
        client.search_track("A", "B")
        client.search_track("C", "D")
        assert session.post.call_count == 1

    def test_rate_limit_retry(self) -> None:
        """429 を受けたら Retry-After 秒待って再試行。"""
        session = MagicMock()
        session.post.return_value = self._mk_token_response()
        session.get.side_effect = [
            _mk_response(429, headers={"Retry-After": "0"}),
            _mk_response(200, {"tracks": {"items": []}}),
        ]
        client = self._mk_client(session)
        client.search_track("A", "B")
        assert session.get.call_count == 2

    def test_quota_exceeded_raises(self) -> None:
        """Retry-After が 120s を超えたら SpotifyQuotaExceeded を raise。"""
        session = MagicMock()
        session.post.return_value = self._mk_token_response()
        session.get.return_value = _mk_response(429, headers={"Retry-After": "85000"})
        client = self._mk_client(session)
        with pytest.raises(SpotifyQuotaExceeded) as exc_info:
            client.search_track("A", "B")
        assert exc_info.value.retry_after_sec == 85000

    def test_401_refreshes_token(self) -> None:
        session = MagicMock()
        session.post.side_effect = [
            self._mk_token_response(),  # 初回
            self._mk_token_response(),  # 401 を受けての再発行
        ]
        session.get.side_effect = [
            _mk_response(401),
            _mk_response(200, {"tracks": {"items": []}}),
        ]
        client = self._mk_client(session)
        client.search_track("A", "B")
        assert session.post.call_count == 2
        assert session.get.call_count == 2
