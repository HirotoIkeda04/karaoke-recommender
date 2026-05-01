"""日本語 Wikipedia Pageviews API から楽曲の有名度スコアを取得する。

設計方針 (2026-04-30 議論より):
    - 「有名曲かそれ以外か」を濃淡で表す連続スコア。
    - 単一シグナル (日本語 Wikipedia 記事の累計閲覧数) のみを使う。
    - 記事が無い曲は score = 0 (= マイナー曲扱い)。
    - 集計期間は API 公開下限 (2015-07) から today までの全期間。

法的判断:
    - Pageviews API が返すのは {timestamp, views} の数値のみで記事本文を含まない。
    - 数値・統計データは著作権の対象外 → CC BY-SA は適用されず attribution 不要。
    - Wikimedia Foundation 公式の開放 API で商用利用 OK。

API:
    https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/
        ja.wikipedia/all-access/all-agents/{article}/monthly/{from}/{to}
"""

from __future__ import annotations

import logging
import math
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from urllib.parse import quote

import requests

from text_match import normalize as _normalize_text

logger = logging.getLogger(__name__)

# --- API 定数 ---------------------------------------------------------------

USER_AGENT = "karaoke-recommender-research/0.1 (hiroto.lalapalooza.ikeda@gmail.com)"

PAGEVIEWS_ENDPOINT = (
    "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article"
    "/ja.wikipedia/all-access/all-agents/{article}/monthly/{from_}/{to}"
)
SEARCH_ENDPOINT = "https://ja.wikipedia.org/w/api.php"

REQUEST_TIMEOUT_SEC = 15
# Pageviews API は 100 req/sec まで許容されるが、行儀よく 5 req/sec に。
PAGEVIEWS_INTERVAL_SEC = 0.2
# Search API は 200 req/sec が公称だが、こちらも 5 req/sec に。
SEARCH_INTERVAL_SEC = 0.2

# 一過性ネットワークエラー (DNS 解決失敗等) のリトライ。失敗時は raise して
# キャッシュ汚染を防ぐ (キャッシュは「確証ある結果」のみが入るべき)。
MAX_RETRIES = 3
RETRY_BACKOFF_BASE_SEC = 2.0


class TransientFetchError(Exception):
    """ネットワーク一過性エラー (リトライ後も失敗)。fame_for() からエスカレート。"""

# 集計開始 (Pageviews API の下限)
PAGEVIEWS_FROM = "2015070100"

# 検証時の最低タイトル類似度 (0..1)。これ以下なら同名異曲・別作品とみなす。
MIN_TITLE_SIMILARITY = 0.5

# 記事タイトル末尾の disambiguator `(...)` を切り出す正規表現
_RE_DISAMBIG = re.compile(r"\s*[（(]([^）)]*)[）)]\s*$")


def _strip_disambig(article_title: str) -> tuple[str, str | None]:
    """`Lemon (米津玄師の曲)` → ("Lemon", "米津玄師の曲") を返す。

    disambiguator が無い場合は (元タイトル, None)。
    """
    m = _RE_DISAMBIG.search(article_title)
    if m:
        core = article_title[: m.start()].strip()
        disambig = m.group(1).strip()
        return core, disambig
    return article_title, None


def _title_similar(input_title: str, article_core: str) -> bool:
    """入力タイトルと article のコアタイトル (disambig 除去後) が十分似ているか。"""
    a = _normalize_text(input_title)
    b = _normalize_text(article_core)
    if not a or not b:
        return False
    if a == b:
        return True
    # 片方が他方に完全包含 (e.g. 余計なサブタイトル付き両 A 面など)
    if a in b or b in a:
        return True
    return SequenceMatcher(None, a, b).ratio() >= MIN_TITLE_SIMILARITY


# --- データ型 ---------------------------------------------------------------

@dataclass(frozen=True)
class FameResult:
    """有名度スコアの算出結果。"""

    title: str           # 入力タイトル
    artist: str          # 入力アーティスト
    article: str | None  # 解決された Wikipedia 記事タイトル (URL-decoded)
    total_views: int     # 全期間累計閲覧数
    fame_score: float    # log10(total_views), 0 if no article


# --- 記事タイトル解決 -------------------------------------------------------

# Wikipedia 楽曲記事の慣習的な disambiguator。
# 候補スコアリング時に「この suffix が付いていたら曲記事の確度が高い」と判定。
_SONG_DISAMBIGUATORS: tuple[str, ...] = (
    "の曲",
    "の楽曲",
    "のシングル",
    "の歌",
)
# 避けたい disambiguator (アルバム/映画/同名異曲などの誤マッチ防止)
_NEGATIVE_DISAMBIGUATORS: tuple[str, ...] = (
    "のアルバム",
    "の映画",
    "の小説",
    "のテレビドラマ",
    "の漫画",
    "曖昧さ回避",
)


def _candidate_titles(title: str, artist: str) -> list[str]:
    """Wikipedia 記事タイトルの候補を生成。「曲名 (アーティスト名の曲)」を優先。"""
    return [
        f"{title} ({artist}の曲)",
        f"{title} ({artist}の楽曲)",
        f"{title} ({artist}のシングル)",
        f"{title}",  # disambiguation の無い独占的な記事タイトル
    ]


class WikipediaClient:
    """Wikipedia 検索 + Pageviews API のクライアント。"""

    def __init__(self, session: requests.Session | None = None) -> None:
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT})
        self._last_search_at = 0.0
        self._last_pageviews_at = 0.0

    # -- 内部: スロットリング ------------------------------------------------

    def _throttle_search(self) -> None:
        elapsed = time.monotonic() - self._last_search_at
        wait = SEARCH_INTERVAL_SEC - elapsed
        if wait > 0:
            time.sleep(wait)
        self._last_search_at = time.monotonic()

    def _throttle_pageviews(self) -> None:
        elapsed = time.monotonic() - self._last_pageviews_at
        wait = PAGEVIEWS_INTERVAL_SEC - elapsed
        if wait > 0:
            time.sleep(wait)
        self._last_pageviews_at = time.monotonic()

    # -- 公開メソッド --------------------------------------------------------

    def resolve_article(self, title: str, artist: str) -> str | None:
        """(title, artist) から日本語 Wikipedia の記事タイトルを解決する。

        返り値は Wikipedia のカノニカルタイトル (例: "Lemon (米津玄師の曲)")。
        normalize/redirect 後の正式名なので Pageviews API にそのまま渡せる。
        記事が見つからない/アーティスト不一致の場合は None。
        """
        # 1. 候補タイトルから既存記事を探し、アーティスト・タイトル一致を検証
        for candidate in _candidate_titles(title, artist):
            canonical = self._resolve_with_verification(candidate, title, artist)
            if canonical:
                return canonical

        # 2. 全文検索 fallback
        return self._search_best_match(title, artist)

    def _resolve_with_verification(
        self,
        candidate_title: str,
        input_title: str,
        artist: str,
    ) -> str | None:
        """candidate_title を解決し、入力 (title, artist) と整合するか検証。

        Wikipedia は先頭文字大文字化やリダイレクトを内部で吸収。
        Pageviews API は厳密一致なので必ず canonical title を返す。

        2 段の検証:
            1) タイトル一致: canonical の disambig 除去後コアと input_title が
               十分似ているか
            2) アーティスト一致: disambig が `(artist の曲)` 形式 OR
               extract にアーティスト名が含まれている
        """
        canonical, extract = self._fetch_canonical_and_extract(candidate_title)
        if not canonical:
            return None

        article_core, disambig = _strip_disambig(canonical)

        # (1) タイトル一致チェック (input_title vs article_core)
        if not _title_similar(input_title, article_core):
            return None

        # (2) アーティスト一致チェック
        norm_artist = _normalize_text(artist)
        if not norm_artist:
            return None
        # 2a. disambig に artist が含まれる (`Lemon (米津玄師の曲)` 等の典型)
        if disambig and norm_artist in _normalize_text(disambig):
            return canonical
        # 2b. extract 冒頭にアーティスト名が含まれる
        if extract and norm_artist in _normalize_text(extract):
            return canonical

        return None

    def _request_with_retry(
        self, params: dict, throttle: callable, label: str,
    ) -> dict | None:
        """search/extract endpoint を叩く共通ラッパ (リトライ + 例外昇格)。

        connection/DNS/timeout 系のエラーは MAX_RETRIES まで指数バックオフ。
        全リトライ失敗時は TransientFetchError を raise する (キャッシュ汚染防止)。
        404 等の HTTP エラーは None を返す (legit な「記事なし」と区別不能だが
        運用上は記事なしと同じ扱いにしてよい)。
        """
        for attempt in range(MAX_RETRIES):
            throttle()
            try:
                resp = self.session.get(
                    SEARCH_ENDPOINT, params=params, timeout=REQUEST_TIMEOUT_SEC,
                )
            except (requests.ConnectionError, requests.Timeout) as e:
                wait = RETRY_BACKOFF_BASE_SEC * (2 ** attempt)
                logger.warning(
                    "wikipedia %s transient error (attempt %d/%d, sleep %.1fs): %s",
                    label, attempt + 1, MAX_RETRIES, wait, e,
                )
                time.sleep(wait)
                continue
            except requests.RequestException as e:
                logger.warning("wikipedia %s failed: %s", label, e)
                return None
            if resp.status_code != 200:
                return None
            try:
                return resp.json()
            except ValueError:
                return None
        # MAX_RETRIES 全部失敗 → 一過性エラーとして昇格
        raise TransientFetchError(f"{label} after {MAX_RETRIES} retries")

    def _fetch_canonical_and_extract(
        self, page_title: str,
    ) -> tuple[str | None, str | None]:
        """canonical title と記事プレーンテキスト抜粋を 1 リクエストで取得。

        `exintro` を外すと記事全体が返るが、カバー曲やコラボ表記まで拾うため
        recall が上がる。`exchars=10000` で長文記事の青天井は防ぐ。
        """
        params = {
            "action": "query",
            "titles": page_title,
            "redirects": "1",
            "prop": "extracts",
            "explaintext": "1",
            "exchars": "10000",
            "format": "json",
        }
        data = self._request_with_retry(
            params, self._throttle_search, f"query {page_title!r}",
        )
        if not data:
            return None, None
        pages = data.get("query", {}).get("pages", {})
        for pid, page in pages.items():
            if int(pid) > 0 and "missing" not in page:
                return page.get("title"), page.get("extract")
        return None, None

    def _resolve_canonical(self, page_title: str) -> str | None:
        """canonical title 単独取得 (検証なし)。検索 fallback 用。"""
        canonical, _ = self._fetch_canonical_and_extract(page_title)
        return canonical

    def _search_best_match(self, title: str, artist: str) -> str | None:
        """全文検索で楽曲記事を探す。

        スコア順に candidate を並べ、verify を通った最初のものを採用する。
        単一 candidate のスコア最大化ではなく、検証可能性を優先する設計。
        """
        params = {
            "action": "query",
            "list": "search",
            "srsearch": f'"{title}" {artist}',
            "srlimit": 10,
            "format": "json",
        }
        data = self._request_with_retry(
            params, self._throttle_search, f"search {title!r} {artist!r}",
        )
        if not data:
            return None
        results = data.get("query", {}).get("search", [])
        if not results:
            return None

        norm_title = _normalize_text(title)
        norm_artist = _normalize_text(artist)

        scored: list[tuple[float, str]] = []
        for r in results:
            page_title: str = r.get("title", "")
            snippet: str = r.get("snippet", "")
            score = self._score_candidate(
                page_title, snippet, norm_title, norm_artist,
            )
            if score >= 1.0:
                scored.append((score, page_title))

        scored.sort(key=lambda x: -x[0])
        for _score, page_title in scored:
            verified = self._resolve_with_verification(page_title, title, artist)
            if verified:
                return verified
        return None

    @staticmethod
    def _score_candidate(
        page_title: str,
        snippet: str,
        norm_title: str,
        norm_artist: str,
    ) -> float:
        """候補ページのマッチスコア。簡易ヒューリスティック。"""
        norm_page = _normalize_text(page_title)
        norm_snippet = _normalize_text(snippet)
        score = 0.0

        # 楽曲系 disambiguator は強いシグナル
        if any(d in page_title for d in _SONG_DISAMBIGUATORS):
            score += 3.0
        # ネガティブ disambiguator はペナルティ
        if any(d in page_title for d in _NEGATIVE_DISAMBIGUATORS):
            score -= 5.0

        # タイトル一致 (page_title 中に title が含まれるか)
        if norm_title and norm_title in norm_page:
            score += 2.0

        # アーティスト名がページタイトル or snippet に含まれるか
        if norm_artist and (norm_artist in norm_page or norm_artist in norm_snippet):
            score += 1.5

        return score

    # -- Pageviews ----------------------------------------------------------

    def total_pageviews(self, article: str) -> int:
        """記事の全期間累計閲覧数を取得 (2015-07 〜 今日)。

        404 や空レスポンスは 0 を返す。
        ConnectionError 等の一過性エラーはリトライ後 TransientFetchError を raise。
        """
        today = datetime.now(timezone.utc).strftime("%Y%m%d00")
        # Pageviews API はスペースをアンダースコアに変換した形式で要求する
        article_path = quote(article.replace(" ", "_"), safe="")
        url = PAGEVIEWS_ENDPOINT.format(
            article=article_path,
            from_=PAGEVIEWS_FROM,
            to=today,
        )
        for attempt in range(MAX_RETRIES):
            self._throttle_pageviews()
            try:
                resp = self.session.get(url, timeout=REQUEST_TIMEOUT_SEC)
            except (requests.ConnectionError, requests.Timeout) as e:
                wait = RETRY_BACKOFF_BASE_SEC * (2 ** attempt)
                logger.warning(
                    "pageviews transient error for %r (attempt %d/%d, sleep %.1fs): %s",
                    article, attempt + 1, MAX_RETRIES, wait, e,
                )
                time.sleep(wait)
                continue
            except requests.RequestException as e:
                logger.warning("pageviews failed for %r: %s", article, e)
                return 0
            if resp.status_code == 404:
                return 0
            if resp.status_code != 200:
                logger.warning(
                    "pageviews %d for %r: %s",
                    resp.status_code, article, resp.text[:200],
                )
                return 0
            try:
                data = resp.json()
            except ValueError:
                return 0
            items = data.get("items", [])
            return sum(int(i.get("views") or 0) for i in items)
        raise TransientFetchError(f"pageviews {article!r} after {MAX_RETRIES} retries")

    # -- 高水準 API ----------------------------------------------------------

    def fame_for(self, title: str, artist: str) -> FameResult:
        """1曲分の有名度スコアを取得する。"""
        article = self.resolve_article(title, artist)
        if not article:
            return FameResult(title, artist, None, 0, 0.0)
        views = self.total_pageviews(article)
        score = math.log10(views) if views > 0 else 0.0
        return FameResult(title, artist, article, views, score)


# --- CLI: PoC 用 -----------------------------------------------------------

def _main() -> None:
    """簡易 CLI: 引数から (title, artist) を読んでスコアを表示。

    `python -m fetch_wikipedia_fame "Lemon" "米津玄師"`
    """
    import sys

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if len(sys.argv) != 3:
        print("usage: fetch_wikipedia_fame.py <title> <artist>", file=sys.stderr)
        sys.exit(2)
    client = WikipediaClient()
    result = client.fame_for(sys.argv[1], sys.argv[2])
    print(
        f"title={result.title!r} artist={result.artist!r} "
        f"article={result.article!r} views={result.total_views} "
        f"fame_score={result.fame_score:.3f}"
    )


if __name__ == "__main__":
    _main()
