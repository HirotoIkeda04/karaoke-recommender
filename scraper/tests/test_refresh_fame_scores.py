from refresh_fame_scores import _merge_records


def test_merge_records_replaces_by_song_id_without_duplicates() -> None:
    existing = [
        {
            "song_id": "song-1",
            "title": "A・RA・SHI",
            "artist": "嵐",
            "fame_score": 0,
        },
        {"song_id": "song-2", "title": "Other", "artist": "Artist"},
    ]
    updates = [
        {
            "song_id": "song-1",
            "title": "A・RA・SHI",
            "artist": "嵐",
            "fame_score": 5.9,
        }
    ]

    merged = _merge_records(existing, updates)

    assert len(merged) == 2
    assert merged[0]["fame_score"] == 5.9
    assert merged[1]["song_id"] == "song-2"


def test_merge_records_falls_back_to_normalized_title_artist_key() -> None:
    existing = [{"title": "One Love", "artist": "嵐", "fame_score": 0}]
    updates = [{"title": "Ｏｎｅ Ｌｏｖｅ", "artist": "嵐", "fame_score": 5.6}]

    merged = _merge_records(existing, updates)

    assert len(merged) == 1
    assert merged[0]["fame_score"] == 5.6
