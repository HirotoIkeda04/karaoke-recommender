from karaoke_score.train import (
    FeatureRow,
    build_feature_matrix,
    normalized_pair,
    parse_dam_html,
    parse_joysound_table_html,
    parse_joysound_thirty_html,
)


def test_feature_matrix_marks_missing_values_and_ignores_spotify() -> None:
    row = FeatureRow(
        song_id="song-1",
        title="Title",
        artist="Artist",
        values={
            "fame_score": None,
            "fame_views": None,
            "cert_score": 0,
            "spotify_popularity": 99,
            "release_year": 2020,
            "duration_ms": None,
            "genres": [],
            "artist_genres": [],
            "range_low_midi": None,
            "range_high_midi": None,
            "falsetto_max_midi": None,
            "artist_song_count": 1,
            "artist_max_fame_score": None,
            "artist_mean_fame_score": None,
            "artist_max_cert_score": 0,
            "artist_max_spotify_popularity": 99,
            "artist_mean_spotify_popularity": 99,
        },
    )

    matrix, safe_names, _ = build_feature_matrix([row])

    assert "spotify_popularity" not in safe_names
    assert matrix[0, safe_names.index("fame_score_missing")] == 1
    assert matrix[0, safe_names.index("cert_score_missing")] == 0


def test_normalized_pair_handles_nfkc_feat_spaces_and_symbols() -> None:
    assert normalized_pair("ＡＢＣ feat. Guest", "Mrs. GREEN APPLE") == (
        "abc",
        "mrsgreenapple",
    )


def test_parse_dam_html_pairs_nearby_artist() -> None:
    page = """
    <h4 class="p-song__title">Song &amp; Me 『Anime』</h4>
    <div class="p-song__artist">Artist</div>
    """
    assert parse_dam_html(page) == [("Song & Me", "Artist")]


def test_parse_joysound_table_html() -> None:
    page = """
    <table><tr>
      <td class="jp-page-sl-cell-song"><a href="/web/search/song/1">Title</a></td>
      <td class="jp-page-sl-cell-artist"><a href="/web/search/artist/2">Artist</a></td>
    </tr></table>
    """
    assert parse_joysound_table_html(page) == [("Title", "Artist")]


def test_parse_joysound_thirty_html_deduplicates_layouts() -> None:
    page = """
    <h4 class="rank-total-title"><a>Title</a></h4>
    <p class="rank-total-artist"><a>Artist</a></p>
    <li><a href="/web/search/song/1">Title</a>
        <a href="/web/search/artist/2">Artist</a></li>
    """
    assert parse_joysound_thirty_html(page) == [("Title", "Artist")]
