from karaoke_score.train import (
    normalized_pair,
    parse_dam_html,
    parse_joysound_table_html,
    parse_joysound_thirty_html,
)


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
