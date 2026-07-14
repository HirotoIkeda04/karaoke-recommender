"""fetch_wikipedia_fame の記事解決ロジックのユニットテスト。

Wikipedia API はモックする。重点は「曲名が別主題の有名記事 (学校等) と
一致し、本文にアーティスト名がトリビアとして出るだけ」の誤マッチを
弾けること (= fame_score の異常高騰防止)。
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from fetch_wikipedia_fame import (
    WikipediaClient,
    _candidate_titles,
    _clean_artist,
    _is_disambiguation_page,
    _is_song_article,
    _last_completed_month_timestamp,
    _title_similar,
)


class TestCleanArtist:
    def test_strips_reading_gloss(self) -> None:
        assert _clean_artist("平原綾香(ひらはらあやか)") == "平原綾香"
        assert _clean_artist("SEKAI NO OWARI(世界の終わり)") == "SEKAI NO OWARI"
        assert _clean_artist("THE 虎舞竜(THE TRA-BRYU)") == "THE 虎舞竜"

    def test_fullwidth_parens(self) -> None:
        assert _clean_artist("嵐（アラシ）") == "嵐"

    def test_no_gloss_unchanged(self) -> None:
        assert _clean_artist("米津玄師") == "米津玄師"
        assert _clean_artist("Mr.Children") == "Mr.Children"

    def test_all_parens_falls_back_to_original(self) -> None:
        # 剥がすと空になるケースは原文を返す (情報を失わない)
        assert _clean_artist("(なにか)") == "(なにか)"


class TestCategoryHelpers:
    def test_song_article_detected_by_category(self) -> None:
        assert _is_song_article(
            ["Category:2013年のシングル", "Category:乃木坂46の楽曲"]
        )

    def test_song_article_detected_by_kana_index(self) -> None:
        assert _is_song_article(["Category:楽曲 き"])

    def test_song_article_detected_by_theme_song(self) -> None:
        assert _is_song_article(["Category:TBS金曜ドラマの主題歌"])

    def test_school_article_is_not_song(self) -> None:
        # トモエ学園 (黒柳徹子の母校) の実カテゴリ抜粋
        assert not _is_song_article(
            [
                "Category:日本の旧制小学校",
                "Category:目黒区の歴史",
                "Category:黒柳徹子",
            ]
        )

    def test_disambiguation_page_detected(self) -> None:
        assert _is_disambiguation_page(["Category:曖昧さ回避"])
        assert _is_disambiguation_page(["Category:同名の作品"])

    def test_normal_page_is_not_disambiguation(self) -> None:
        assert not _is_disambiguation_page(["Category:2018年のシングル"])


class TestTitleVariants:
    def test_pageviews_period_ends_at_last_completed_month(self) -> None:
        now = datetime(2026, 7, 14, 12, 0, tzinfo=timezone.utc)
        assert _last_completed_month_timestamp(now) == "2026060100"

    def test_dual_a_side_article_contains_catalog_title(self) -> None:
        assert _title_similar("truth", "Truth/風の向こうへ")

    def test_middle_dot_is_ignored_for_matching(self) -> None:
        assert _title_similar("A・RA・SHI", "A・RA・SHI")

    def test_artist_qualified_candidates_precede_bare_title(self) -> None:
        candidates = _candidate_titles("One Love", "嵐")
        assert candidates[0] == "One Love (嵐の曲)"
        assert candidates[-1] == "One Love"


class TestResolveWithVerification:
    def _client_returning(
        self,
        monkeypatch: pytest.MonkeyPatch,
        canonical: str | None,
        extract: str | None,
        categories: list[str],
    ) -> WikipediaClient:
        client = WikipediaClient()
        monkeypatch.setattr(
            client,
            "_fetch_canonical_and_extract",
            lambda _t: (canonical, extract, categories),
        )
        return client

    def test_school_collision_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """曲名が学校記事と一致し、本文に作者名がトリビアで出るだけ → 不採用。"""
        client = self._client_returning(
            monkeypatch,
            canonical="トモエ学園",
            extract=(
                "トモエ学園は、かつて東京都目黒区にあった私立学校。"
                "2017年発表の福山雅治の楽曲『トモエ学園』は…"
            ),
            categories=["Category:日本の旧制小学校", "Category:黒柳徹子"],
        )
        assert (
            client._resolve_with_verification(
                "トモエ学園", "トモエ学園", "福山雅治"
            )
            is None
        )

    def test_legit_bare_title_song_accepted(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """disambiguator 無しでも楽曲カテゴリがあれば採用 (recall 維持)。"""
        client = self._client_returning(
            monkeypatch,
            canonical="君の名は希望",
            extract="「君の名は希望」は、乃木坂46の7thシングル。",
            categories=["Category:2013年のシングル", "Category:乃木坂46の楽曲"],
        )
        assert (
            client._resolve_with_verification(
                "君の名は希望", "君の名は希望", "乃木坂46"
            )
            == "君の名は希望"
        )

    def test_song_disambiguator_accepted_without_categories(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """曲系 disambiguator が付いていればカテゴリ無しでも採用。"""
        client = self._client_returning(
            monkeypatch,
            canonical="Lemon (米津玄師の曲)",
            extract="「Lemon」は、米津玄師の楽曲。",
            categories=[],
        )
        assert (
            client._resolve_with_verification("Lemon", "Lemon", "米津玄師")
            == "Lemon (米津玄師の曲)"
        )

    def test_disambiguation_page_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client = self._client_returning(
            monkeypatch,
            canonical="家族になろうよ",
            extract="家族になろうよ",
            categories=["Category:曖昧さ回避"],
        )
        assert (
            client._resolve_with_verification(
                "家族になろうよ", "家族になろうよ", "福山雅治"
            )
            is None
        )

    def test_artist_absent_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """タイトル一致・楽曲カテゴリありでも、アーティスト不一致なら不採用。"""
        client = self._client_returning(
            monkeypatch,
            canonical="Lemon",
            extract="「Lemon」は、別のアーティストの楽曲。",
            categories=["Category:楽曲 れ"],
        )
        assert (
            client._resolve_with_verification("Lemon", "Lemon", "米津玄師")
            is None
        )

    def test_dual_a_side_canonical_title_accepted(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client = self._client_returning(
            monkeypatch,
            canonical="Truth/風の向こうへ",
            extract="『truth/風の向こうへ』は、嵐の通算23枚目となるシングル。",
            categories=["Category:2008年のダブルA面シングル", "Category:嵐の楽曲"],
        )
        assert (
            client._resolve_with_verification("truth", "truth", "嵐")
            == "Truth/風の向こうへ"
        )
