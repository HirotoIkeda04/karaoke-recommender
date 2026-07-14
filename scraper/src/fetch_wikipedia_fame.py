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
from datetime import datetime, timedelta, timezone
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
# 記事単位で直近月の系列だけ欠け、長い期間指定が 404 になる場合がある。
# 全期間の取得を諦めず、終端を最大 12 か月だけ後退させる。
PAGEVIEWS_MAX_FALLBACK_MONTHS = 12
# Search API は 200 req/sec が公称だが、こちらも 5 req/sec に。
SEARCH_INTERVAL_SEC = 0.2

# 一過性ネットワークエラー (DNS 解決失敗等) のリトライ。失敗時は raise して
# キャッシュ汚染を防ぐ (キャッシュは「確証ある結果」のみが入るべき)。
MAX_RETRIES = 3
RETRY_BACKOFF_BASE_SEC = 2.0
_TRANSIENT_HTTP_STATUSES = frozenset({429, 500, 502, 503, 504})


class TransientFetchError(Exception):
    """ネットワーク一過性エラー (リトライ後も失敗)。fame_for() からエスカレート。"""


class PageviewsUnavailableError(Exception):
    """記事は解決できたが、指定期間の Pageviews 系列を取得できない。"""

# 集計開始 (Pageviews API の下限)
PAGEVIEWS_FROM = "2015070100"

# 検証時の最低タイトル類似度 (0..1)。これ以下なら同名異曲・別作品とみなす。
MIN_TITLE_SIMILARITY = 0.5

# 記事タイトル末尾の disambiguator `(...)` を切り出す正規表現
_RE_DISAMBIG = re.compile(r"\s*[（(]([^）)]*)[）)]\s*$")


def _last_completed_month_timestamp(now: datetime | None = None) -> str:
    """月次 Pageviews API の終端として、直近の完了月初を返す。"""
    current = now or datetime.now(timezone.utc)
    first_of_current_month = current.replace(
        day=1,
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )
    previous_month = first_of_current_month - timedelta(days=1)
    return previous_month.strftime("%Y%m0100")


def _previous_month_timestamp(timestamp: str) -> str:
    """Pageviews の月初 timestamp を 1 か月前へ進める。"""
    month_start = datetime.strptime(timestamp, "%Y%m%d%H").replace(
        tzinfo=timezone.utc
    )
    previous_month = month_start - timedelta(days=1)
    return previous_month.strftime("%Y%m0100")


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

# 記事が「楽曲そのもの」であることを示す Wikipedia カテゴリのトークン。
# jawiki の楽曲/シングル記事はほぼ必ず `○年のシングル` `<artist>の楽曲`
# `楽曲 <かしら文字>` `<作品>の主題歌` 等で分類される。これらが 1 つも
# 無い記事 (例: 学校・施設・人物) に曲名が一致しても誤マッチとみなす。
_SONG_CATEGORY_TOKENS: tuple[str, ...] = (
    "楽曲",
    "シングル",
    "主題歌",
    "歌曲",
    "歌謡曲",
)

# 曖昧さ回避ページを示すカテゴリトークン。どの曲か特定不能なので採用しない。
_DISAMBIG_CATEGORY_TOKENS: tuple[str, ...] = (
    "曖昧さ回避",
    "同名の",
)


def _is_song_article(categories: list[str]) -> bool:
    """記事のカテゴリ群に楽曲系カテゴリが 1 つでもあるか。"""
    return any(
        tok in cat for cat in categories for tok in _SONG_CATEGORY_TOKENS
    )


def _is_disambiguation_page(categories: list[str]) -> bool:
    """記事が曖昧さ回避ページか (カテゴリで判定)。"""
    return any(
        tok in cat for cat in categories for tok in _DISAMBIG_CATEGORY_TOKENS
    )


# アーティスト名末尾/中の括弧読みグロス (例: `平原綾香(ひらはらあやか)`,
# `SEKAI NO OWARI(世界の終わり)`) を除去するための正規表現。曲マスタ由来の
# この表記は Wikipedia 記事タイトル `(<artist>の曲)` を壊し誤マッチ/未解決の
# 主因になるため、解決前に剥がす。
_RE_ARTIST_GLOSS = re.compile(r"[（(][^）)]*[）)]")


def _clean_artist(artist: str) -> str:
    """アーティスト名から括弧読みグロスを除去。空になる場合は原文を返す。"""
    cleaned = _RE_ARTIST_GLOSS.sub("", artist).strip()
    return cleaned or artist


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
        artist = _clean_artist(artist)

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

        3 段の検証:
            1) タイトル一致: canonical の disambig 除去後コアと input_title が
               十分似ているか
            2) アーティスト一致: disambig が `(artist の曲)` 形式 OR
               extract にアーティスト名が含まれている
            3) 楽曲記事性: 曲系 disambiguator が付いている OR カテゴリが
               楽曲系。これが無い記事 (学校・施設・人物等) に曲名が一致し、
               本文にアーティスト名がトリビアとして出るだけのケースを弾く。
        """
        canonical, extract, categories = self._fetch_canonical_and_extract(
            candidate_title,
        )
        if not canonical:
            return None

        # 曖昧さ回避ページはどの曲か特定できないので採用しない。
        if _is_disambiguation_page(categories):
            return None

        article_core, disambig = _strip_disambig(canonical)

        # (1) タイトル一致チェック (input_title vs article_core)
        if not _title_similar(input_title, article_core):
            return None

        # (2) アーティスト一致チェック
        norm_artist = _normalize_text(artist)
        if not norm_artist:
            return None
        artist_in_disambig = bool(
            disambig and norm_artist in _normalize_text(disambig)
        )
        artist_in_extract = bool(
            extract and norm_artist in _normalize_text(extract)
        )
        if not (artist_in_disambig or artist_in_extract):
            return None

        # (3) 楽曲記事であることの確証。曲系 disambiguator
        # (`(米津玄師の曲)` 等) はそれ自体が楽曲記事の証拠。無い場合は
        # カテゴリに楽曲系が 1 つでもあることを要求する。裸タイトルで
        # extract にアーティスト名が出るだけ (例: 学校記事のトリビア) は
        # 誤マッチなので弾く。
        disambig_is_song = bool(
            disambig and any(d in disambig for d in _SONG_DISAMBIGUATORS)
        )
        if disambig_is_song or _is_song_article(categories):
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
            if resp.status_code in _TRANSIENT_HTTP_STATUSES:
                wait = RETRY_BACKOFF_BASE_SEC * (2 ** attempt)
                retry_after = resp.headers.get("Retry-After")
                if retry_after and retry_after.isdigit():
                    wait = max(wait, float(retry_after))
                logger.warning(
                    "wikipedia %s HTTP %d (attempt %d/%d, sleep %.1fs)",
                    label, resp.status_code, attempt + 1, MAX_RETRIES, wait,
                )
                time.sleep(wait)
                continue
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
    ) -> tuple[str | None, str | None, list[str]]:
        """canonical title・記事抜粋・カテゴリを 1 リクエストで取得。

        `exintro` を外すと記事全体が返るが、カバー曲やコラボ表記まで拾うため
        recall が上がる。`exchars=10000` で長文記事の青天井は防ぐ。
        カテゴリ (非隠し) は「記事が楽曲か」の検証に使う。
        """
        params = {
            "action": "query",
            "titles": page_title,
            "redirects": "1",
            "prop": "extracts|categories",
            "explaintext": "1",
            "exchars": "10000",
            "cllimit": "max",
            "clshow": "!hidden",
            "format": "json",
        }
        data = self._request_with_retry(
            params, self._throttle_search, f"query {page_title!r}",
        )
        if not data:
            return None, None, []
        pages = data.get("query", {}).get("pages", {})
        for pid, page in pages.items():
            if int(pid) > 0 and "missing" not in page:
                categories = [
                    c.get("title", "") for c in page.get("categories", [])
                ]
                return page.get("title"), page.get("extract"), categories
        return None, None, []

    def _resolve_canonical(self, page_title: str) -> str | None:
        """canonical title 単独取得 (検証なし)。検索 fallback 用。"""
        canonical, _, _ = self._fetch_canonical_and_extract(page_title)
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
        """記事の全期間累計閲覧数を取得 (2015-07 〜 直近の完了月)。

        直近月の系列欠落による 404 は終端を最大 12 か月後退して再取得する。
        それでも 404 の場合は PageviewsUnavailableError を raise する。
        ConnectionError 等の一過性エラーはリトライ後 TransientFetchError を raise。
        """
        # 月次APIに当月途中の日付を渡すと、当月データがまだ無い記事だけ404に
        # なり、実在記事を views=0 と誤判定する。完了済みの前月までに固定する。
        through = _last_completed_month_timestamp()
        # Pageviews API はスペースをアンダースコアに変換した形式で要求する
        article_path = quote(article.replace(" ", "_"), safe="")
        for fallback_months in range(PAGEVIEWS_MAX_FALLBACK_MONTHS + 1):
            url = PAGEVIEWS_ENDPOINT.format(
                article=article_path,
                from_=PAGEVIEWS_FROM,
                to=through,
            )
            for attempt in range(MAX_RETRIES):
                self._throttle_pageviews()
                try:
                    resp = self.session.get(url, timeout=REQUEST_TIMEOUT_SEC)
                except (requests.ConnectionError, requests.Timeout) as e:
                    wait = RETRY_BACKOFF_BASE_SEC * (2**attempt)
                    logger.warning(
                        "pageviews transient error for %r "
                        "(attempt %d/%d, sleep %.1fs): %s",
                        article,
                        attempt + 1,
                        MAX_RETRIES,
                        wait,
                        e,
                    )
                    time.sleep(wait)
                    continue
                except requests.RequestException as e:
                    logger.warning("pageviews failed for %r: %s", article, e)
                    return 0
                if resp.status_code == 404:
                    break
                if resp.status_code in _TRANSIENT_HTTP_STATUSES:
                    wait = RETRY_BACKOFF_BASE_SEC * (2**attempt)
                    retry_after = resp.headers.get("Retry-After")
                    if retry_after and retry_after.isdigit():
                        wait = max(wait, float(retry_after))
                    logger.warning(
                        "pageviews HTTP %d for %r "
                        "(attempt %d/%d, sleep %.1fs)",
                        resp.status_code,
                        article,
                        attempt + 1,
                        MAX_RETRIES,
                        wait,
                    )
                    time.sleep(wait)
                    continue
                if resp.status_code != 200:
                    logger.warning(
                        "pageviews %d for %r: %s",
                        resp.status_code,
                        article,
                        resp.text[:200],
                    )
                    return 0
                try:
                    data = resp.json()
                except ValueError:
                    return 0
                items = data.get("items", [])
                if fallback_months:
                    logger.warning(
                        "pageviews for %r ended %d month(s) early at %s",
                        article,
                        fallback_months,
                        through,
                    )
                return sum(int(i.get("views") or 0) for i in items)
            else:
                raise TransientFetchError(
                    f"pageviews {article!r} after {MAX_RETRIES} retries"
                )

            if fallback_months == PAGEVIEWS_MAX_FALLBACK_MONTHS:
                break
            through = _previous_month_timestamp(through)

        raise PageviewsUnavailableError(
            f"pageviews unavailable for resolved article {article!r} "
            f"after {PAGEVIEWS_MAX_FALLBACK_MONTHS} fallback month(s)"
        )

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
