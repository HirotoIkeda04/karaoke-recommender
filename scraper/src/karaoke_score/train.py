"""DAM / JOYSOUND 掲載実績からカラオケ人気予測モデルを学習する。

法務上の境界:
  - ランキング HTML、順位、掲載有無、サービス固有 ID はファイルにも DB にも保存しない。
  - 取得した HTML と教師ラベルは、このプロセスのメモリ内だけで扱う。
  - 永続化するのは LightGBM の重みと全曲の予測スコアだけ。

実行:
  cd scraper
  uv run python src/karaoke_score/train.py
"""

from __future__ import annotations

import argparse
import html as html_module
import json
import math
import os
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import lightgbm as lgb
import numpy as np
import requests
from bs4 import BeautifulSoup
from scipy.stats import spearmanr
from sklearn.metrics import ndcg_score

SRC_ROOT = Path(__file__).resolve().parents[1]
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from text_match import normalize  # noqa: E402

SCRAPER_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FEATURES_PATH = SCRAPER_ROOT / "output" / "karaoke_features.jsonl"
DEFAULT_SCORES_PATH = SCRAPER_ROOT / "output" / "karaoke_scores.jsonl"
DEFAULT_MODEL_PATH = SCRAPER_ROOT / "output" / "karaoke_model.txt"

USER_AGENT = (
    "karaoke-recommender-research/0.1 "
    "(hiroto.lalapalooza.ikeda@gmail.com)"
)
FETCH_INTERVAL_SECONDS = 2.0
REQUEST_TIMEOUT_SECONDS = 30
MAX_GENRES_PER_SCOPE = 64
RANDOM_SEED = 42

RankingPair = tuple[str, str]
Parser = Callable[[str], list[RankingPair]]

DAM_URLS = [
    "https://www.clubdam.com/ranking/",
    "https://www.clubdam.com/ranking/firsthalf.html",
    "https://www.clubdam.com/ranking/secondhalf.html",
    "https://www.clubdam.com/ranking/year.html",
    "https://www.clubdam.com/ranking/kensaku/",
    "https://www.clubdam.com/ranking/burst/",
    "https://www.clubdam.com/ranking/duet/",
    "https://www.clubdam.com/genre/anison/ranking_year.html",
    "https://www.clubdam.com/genre/anison/ranking_firsthalf.html",
    "https://www.clubdam.com/genre/anison/ranking_secondhalf.html",
    "https://www.clubdam.com/genre/enka/ranking_year.html",
    "https://www.clubdam.com/genre/enka/ranking_firsthalf.html",
    "https://www.clubdam.com/genre/enka/ranking_secondhalf.html",
    "https://www.clubdam.com/genre/foreign/ranking_year.html",
    "https://www.clubdam.com/genre/foreign/ranking_firsthalf.html",
    "https://www.clubdam.com/genre/foreign/ranking_secondhalf.html",
    "https://www.clubdam.com/genre/vocaloid/ranking_year.html",
    "https://www.clubdam.com/genre/vocaloid/ranking_firsthalf.html",
    "https://www.clubdam.com/genre/vocaloid/ranking_secondhalf.html",
    "https://www.clubdam.com/genre/vtuber/ranking_firsthalf.html",
    "https://www.clubdam.com/feature/standard/winter_anime_ranking_2025.html",
    "https://www.clubdam.com/feature/standard/spring_anime_ranking_2025.html",
    "https://www.clubdam.com/feature/standard/summer_anime_ranking_2025.html",
    "https://www.clubdam.com/feature/standard/winter_anime_ranking_2024.html",
    "https://www.clubdam.com/feature/standard/spring_anime_ranking_2024.html",
    "https://www.clubdam.com/feature/standard/summer_anime_ranking_2024.html",
    "https://www.clubdam.com/feature/standard/autumn_anime_ranking_2024.html",
    "https://www.clubdam.com/feature/standard/winter_anime_ranking_2023.html",
    "https://www.clubdam.com/feature/standard/spring_anime_ranking_2023.html",
    "https://www.clubdam.com/feature/standard/summer_anime_ranking_2023.html",
    "https://www.clubdam.com/feature/standard/autumn_anime_ranking_2023.html",
    "https://www.clubdam.com/feature/standard/winter_anime_ranking_2022.html",
    "https://www.clubdam.com/feature/standard/spring_anime_ranking_2022.html",
    "https://www.clubdam.com/feature/standard/summer_anime_ranking_2022.html",
    "https://www.clubdam.com/feature/standard/autumn_anime_ranking_2022.html",
    "https://www.clubdam.com/feature/standard/winter_anime_ranking_2021.html",
    "https://www.clubdam.com/feature/standard/spring_anime_ranking_2021.html",
    "https://www.clubdam.com/feature/standard/summer_anime_ranking_2021.html",
]

JOYSOUND_TABLE_URLS = [
    "https://www.joysound.com/web/s/karaoke/contents/annual_ranking/2025",
    "https://www.joysound.com/web/s/karaoke/contents/annual_ranking/2024",
    "https://www.joysound.com/web/s/karaoke/contents/annual_ranking/2023",
    "https://www.joysound.com/web/s/karaoke/contents/annual_ranking/2022",
    "https://www.joysound.com/web/s/karaoke/contents/annual_ranking/2021",
    "https://www.joysound.com/web/s/karaoke/contents/annual_ranking/2020",
    "https://www.joysound.com/web/s/karaoke/contents/ranking/2025-02",
    "https://www.joysound.com/web/s/karaoke/contents/ranking/2024-02",
    "https://www.joysound.com/web/s/karaoke/contents/ranking/2023-02",
    "https://www.joysound.com/web/s/karaoke/contents/ranking/2022-02",
    "https://www.joysound.com/web/s/karaoke/contents/ranking/2021-02",
    "https://www.joysound.com/web/s/karaoke/feature/annual_age_2025",
    "https://www.joysound.com/web/s/karaoke/feature/annual_age_2024",
    "https://www.joysound.com/web/s/karaoke/feature/annual_age_2023",
    "https://www.joysound.com/web/s/karaoke/feature/annual_age_2022",
    "https://www.joysound.com/web/s/karaoke/feature/annual_age_2021",
    "https://www.joysound.com/web/s/karaoke/feature/annual_age_2020",
    "https://www.joysound.com/web/s/karaoke/feature/annual_age_2019",
]
JOYSOUND_THIRTY_URL = "https://www.joysound.com/web/s/30th/ranking"

_ANIME_SUFFIX_RE = re.compile(r"[ \u3000]*『[^』]*』[ \u3000]*$")
_TAG_RE = re.compile(r"<[^>]+>")
_FORBIDDEN_FEATURE_KEYS = {
    "rank",
    "ranking",
    "is_listed",
    "listed",
    "label",
    "dam_request_no",
}


@dataclass(frozen=True)
class FeatureRow:
    song_id: str
    title: str
    artist: str
    values: dict[str, object]


@dataclass(frozen=True)
class EvaluationRow:
    direction: str
    scorer: str
    spearman: float
    ndcg50: float


def strip_anime_suffix(title: str) -> str:
    return _ANIME_SUFFIX_RE.sub("", title).strip()


def clean_html_text(value: str) -> str:
    return html_module.unescape(_TAG_RE.sub("", value)).strip()


def parse_dam_html(page_html: str) -> list[RankingPair]:
    title_pattern = re.compile(r'<h4 class="p-song__title">([\s\S]*?)</h4>')
    artist_pattern = re.compile(
        r'<div class="p-song__artist">([\s\S]*?)</div>'
    )
    songs: list[RankingPair] = []
    for title_match in title_pattern.finditer(page_html):
        nearby = page_html[title_match.end() : title_match.end() + 600]
        artist_match = artist_pattern.search(nearby)
        if not artist_match:
            continue
        title = strip_anime_suffix(clean_html_text(title_match.group(1)))
        artist = clean_html_text(artist_match.group(1))
        if title and artist:
            songs.append((title, artist))
    return songs


def parse_joysound_table_html(page_html: str) -> list[RankingPair]:
    soup = BeautifulSoup(page_html, "lxml")
    songs: list[RankingPair] = []
    for title_cell in soup.select("td.jp-page-sl-cell-song"):
        artist_cell = title_cell.find_next_sibling(
            "td", class_="jp-page-sl-cell-artist"
        )
        if artist_cell is None:
            continue
        title = strip_anime_suffix(title_cell.get_text(" ", strip=True))
        artist = artist_cell.get_text(" ", strip=True)
        if title and artist:
            songs.append((title, artist))
    return songs


def parse_joysound_thirty_html(page_html: str) -> list[RankingPair]:
    soup = BeautifulSoup(page_html, "lxml")
    songs: list[RankingPair] = []
    seen: set[RankingPair] = set()

    def add(title: str, artist: str) -> None:
        pair = (strip_anime_suffix(title.strip()), artist.strip())
        if pair[0] and pair[1] and pair not in seen:
            seen.add(pair)
            songs.append(pair)

    for title_node in soup.select("h4.rank-total-title"):
        artist_node = title_node.find_next("p", class_="rank-total-artist")
        if artist_node is not None:
            add(
                title_node.get_text(" ", strip=True),
                artist_node.get_text(" ", strip=True),
            )

    for title_link in soup.select('a[href^="/web/search/song/"]'):
        parent = title_link.find_parent("li")
        if parent is None:
            continue
        artist_link = parent.select_one('a[href^="/web/search/artist/"]')
        if artist_link is not None:
            add(
                title_link.get_text(" ", strip=True),
                artist_link.get_text(" ", strip=True),
            )
    return songs


def normalized_match_value(value: str) -> str:
    return normalize(unicodedata.normalize("NFKC", value))


def normalized_pair(title: str, artist: str) -> RankingPair:
    return (
        normalized_match_value(strip_anime_suffix(title)),
        normalized_match_value(artist),
    )


def fetch_appearances(
    service: str,
    pages: Sequence[tuple[str, Parser]],
) -> Counter[RankingPair]:
    """URL ごとの掲載を1回として数える。戻り値はプロセス外に保存しない。"""
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    appearances: Counter[RankingPair] = Counter()

    for index, (url, parser) in enumerate(pages):
        print(f"fetching {service} {index + 1}/{len(pages)} ...", end="", flush=True)
        try:
            response = session.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
            if not response.ok:
                print(f" HTTP {response.status_code} (skip)")
            else:
                page_pairs = {
                    normalized_pair(title, artist)
                    for title, artist in parser(response.text)
                }
                page_pairs.discard(("", ""))
                for pair in page_pairs:
                    if pair[0] and pair[1]:
                        appearances[pair] += 1
                print(f" {len(page_pairs)} songs")
        except requests.RequestException as error:
            print(f" error: {error}")

        if index + 1 < len(pages):
            time.sleep(FETCH_INTERVAL_SECONDS)

    if not appearances:
        raise RuntimeError(f"{service}: no ranking songs could be fetched")
    print(f"{service}: {len(appearances)} unique normalized songs in memory")
    return appearances


def load_features(path: Path) -> list[FeatureRow]:
    rows: list[FeatureRow] = []
    seen_ids: set[str] = set()
    with path.open(encoding="utf-8") as input_file:
        for line_number, line in enumerate(input_file, start=1):
            if not line.strip():
                continue
            raw = json.loads(line)
            forbidden = _FORBIDDEN_FEATURE_KEYS.intersection(raw)
            if forbidden:
                names = ", ".join(sorted(forbidden))
                raise ValueError(f"line {line_number}: forbidden label fields: {names}")
            song_id = raw.get("song_id")
            title = raw.get("title")
            artist = raw.get("artist")
            if not all(isinstance(value, str) and value for value in (song_id, title, artist)):
                raise ValueError(f"line {line_number}: song_id/title/artist are required")
            if song_id in seen_ids:
                raise ValueError(f"line {line_number}: duplicate song_id {song_id}")
            seen_ids.add(song_id)
            rows.append(
                FeatureRow(
                    song_id=song_id,
                    title=title,
                    artist=artist,
                    values=raw,
                )
            )
    if not rows:
        raise ValueError(f"feature file is empty: {path}")
    return rows


def match_appearances(
    rows: Sequence[FeatureRow], appearances: Counter[RankingPair]
) -> tuple[np.ndarray, int]:
    catalog_index: dict[RankingPair, list[int]] = defaultdict(list)
    for index, row in enumerate(rows):
        catalog_index[normalized_pair(row.title, row.artist)].append(index)

    counts = np.zeros(len(rows), dtype=np.float64)
    matched_ranking_pairs = 0
    for pair, appearance_count in appearances.items():
        indexes = catalog_index.get(pair, [])
        if not indexes:
            continue
        matched_ranking_pairs += 1
        for index in indexes:
            counts[index] += appearance_count
    return counts, matched_ranking_pairs


def optional_number(row: FeatureRow, key: str) -> float:
    value = row.values.get(key)
    if value is None:
        return math.nan
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{row.song_id}: {key} must be numeric or null")
    return float(value)


def genre_vocabulary(
    rows: Sequence[FeatureRow], key: str
) -> list[str]:
    counter: Counter[str] = Counter()
    for row in rows:
        values = row.values.get(key, [])
        if not isinstance(values, list):
            raise ValueError(f"{row.song_id}: {key} must be an array")
        counter.update(value for value in set(values) if isinstance(value, str))
    return [
        value
        for value, _ in sorted(counter.items(), key=lambda item: (-item[1], item[0]))[
            :MAX_GENRES_PER_SCOPE
        ]
    ]


def build_feature_matrix(
    rows: Sequence[FeatureRow],
) -> tuple[np.ndarray, list[str], list[str]]:
    numeric_keys = [
        "fame_score",
        "cert_score",
        "spotify_popularity",
        "release_year",
        "duration_ms",
        "range_low_midi",
        "range_high_midi",
        "falsetto_max_midi",
        "artist_song_count",
        "artist_max_fame_score",
        "artist_mean_fame_score",
        "artist_max_cert_score",
        "artist_max_spotify_popularity",
        "artist_mean_spotify_popularity",
    ]
    song_genres = genre_vocabulary(rows, "genres")
    artist_genres = genre_vocabulary(rows, "artist_genres")

    safe_feature_names = [
        *numeric_keys,
        "fame_views_log1p",
        "song_age",
        "range_width",
        *[f"song_genre_{index:02d}" for index in range(len(song_genres))],
        *[f"artist_genre_{index:02d}" for index in range(len(artist_genres))],
    ]
    display_feature_names = [
        *numeric_keys,
        "fame_views_log1p",
        "song_age",
        "range_width",
        *[f"song_genre:{genre}" for genre in song_genres],
        *[f"artist_genre:{genre}" for genre in artist_genres],
    ]

    matrix: list[list[float]] = []
    current_year = date.today().year
    for row in rows:
        values = [optional_number(row, key) for key in numeric_keys]
        fame_views = optional_number(row, "fame_views")
        values.append(math.log1p(fame_views) if not math.isnan(fame_views) else math.nan)
        release_year = optional_number(row, "release_year")
        values.append(current_year - release_year if not math.isnan(release_year) else math.nan)
        low = optional_number(row, "range_low_midi")
        high = optional_number(row, "range_high_midi")
        values.append(high - low if not math.isnan(low) and not math.isnan(high) else math.nan)
        row_song_genres = set(row.values.get("genres", []))
        row_artist_genres = set(row.values.get("artist_genres", []))
        values.extend(float(genre in row_song_genres) for genre in song_genres)
        values.extend(float(genre in row_artist_genres) for genre in artist_genres)
        matrix.append(values)
    return np.asarray(matrix, dtype=np.float64), safe_feature_names, display_feature_names


def train_model(
    matrix: np.ndarray,
    relevance: np.ndarray,
    feature_names: Sequence[str],
) -> lgb.LGBMRanker:
    labels = relevance > 0
    positive_count = int(labels.sum())
    negative_count = len(labels) - positive_count
    if positive_count == 0 or negative_count == 0:
        raise ValueError(
            f"training needs both classes: positive={positive_count}, negative={negative_count}"
        )
    max_relevance = int(relevance.max())
    model = lgb.LGBMRanker(
        objective="lambdarank",
        metric="ndcg",
        eval_at=(50,),
        label_gain=[float(value) for value in range(max_relevance + 1)],
        n_estimators=450,
        learning_rate=0.025,
        num_leaves=15,
        min_child_samples=20,
        subsample=0.9,
        colsample_bytree=0.9,
        reg_lambda=1.0,
        lambdarank_truncation_level=100,
        random_state=RANDOM_SEED,
        n_jobs=-1,
        verbosity=-1,
        deterministic=True,
        force_col_wise=True,
    )
    model.fit(
        matrix,
        relevance.astype(np.int32),
        group=[len(relevance)],
        feature_name=list(feature_names),
    )
    return model


def prediction_scores(model: lgb.LGBMRanker, matrix: np.ndarray) -> np.ndarray:
    return np.asarray(model.booster_.predict(matrix), dtype=np.float64)


def calculate_metrics(truth: np.ndarray, scores: np.ndarray) -> tuple[float, float]:
    correlation = spearmanr(truth, scores).statistic
    spearman = float(correlation) if np.isfinite(correlation) else 0.0
    k = min(50, len(truth))
    ndcg = float(ndcg_score(truth.reshape(1, -1), scores.reshape(1, -1), k=k))
    return spearman, ndcg


def evaluate_direction(
    direction: str,
    matrix: np.ndarray,
    feature_names: Sequence[str],
    train_relevance: np.ndarray,
    truth_relevance: np.ndarray,
    fame_scores: np.ndarray,
    cert_scores: np.ndarray,
) -> list[EvaluationRow]:
    model = train_model(matrix, train_relevance, feature_names)
    scorers = {
        "model": prediction_scores(model, matrix),
        "fame_score": fame_scores,
        "fame_score + cert_score": fame_scores + cert_scores,
    }
    results: list[EvaluationRow] = []
    for name, scores in scorers.items():
        spearman, ndcg50 = calculate_metrics(truth_relevance, scores)
        results.append(EvaluationRow(direction, name, spearman, ndcg50))
    return results


def print_evaluation_table(results: Iterable[EvaluationRow]) -> None:
    print("\nHoldout evaluation (graded relevance = ranking-page appearance count)")
    print("| direction | scorer | Spearman | NDCG@50 |")
    print("|---|---|---:|---:|")
    for result in results:
        print(
            f"| {result.direction} | {result.scorer} | "
            f"{result.spearman:+.4f} | {result.ndcg50:.4f} |"
        )


def evaluation_passed(results: Sequence[EvaluationRow]) -> bool:
    by_direction: dict[str, dict[str, EvaluationRow]] = defaultdict(dict)
    for result in results:
        by_direction[result.direction][result.scorer] = result
    for scorers in by_direction.values():
        model = scorers["model"]
        for baseline_name in ("fame_score", "fame_score + cert_score"):
            baseline = scorers[baseline_name]
            if model.spearman <= baseline.spearman or model.ndcg50 <= baseline.ndcg50:
                return False
    return True


def print_feature_importance(
    model: lgb.LGBMRanker,
    display_feature_names: Sequence[str],
    limit: int = 15,
) -> None:
    importances = model.booster_.feature_importance(importance_type="gain")
    ranked = sorted(
        zip(display_feature_names, importances),
        key=lambda item: item[1],
        reverse=True,
    )
    total = float(sum(importances)) or 1.0
    print("\nTop feature importance (gain)")
    for name, importance in ranked[:limit]:
        print(f"  {name}: {importance / total:.2%}")


def write_outputs(
    rows: Sequence[FeatureRow],
    model: lgb.LGBMRanker,
    matrix: np.ndarray,
    scores_path: Path,
    model_path: Path,
) -> None:
    raw_scores = prediction_scores(model, matrix)
    score_min = float(raw_scores.min())
    score_range = float(raw_scores.max()) - score_min
    scores = (
        (raw_scores - score_min) / score_range
        if score_range > 0
        else np.zeros(len(raw_scores), dtype=np.float64)
    )
    scores_path.parent.mkdir(parents=True, exist_ok=True)
    model_path.parent.mkdir(parents=True, exist_ok=True)
    scores_tmp = scores_path.with_suffix(scores_path.suffix + ".tmp")
    model_tmp = model_path.with_suffix(model_path.suffix + ".tmp")
    try:
        with scores_tmp.open("w", encoding="utf-8") as output_file:
            for row, score in zip(rows, scores):
                output_file.write(
                    json.dumps(
                        {
                            "song_id": row.song_id,
                            "karaoke_score": round(float(score), 8),
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
        model.booster_.save_model(str(model_tmp))
        os.replace(scores_tmp, scores_path)
        os.replace(model_tmp, model_path)
    finally:
        scores_tmp.unlink(missing_ok=True)
        model_tmp.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--features", type=Path, default=DEFAULT_FEATURES_PATH)
    parser.add_argument("--scores", type=Path, default=DEFAULT_SCORES_PATH)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL_PATH)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rows = load_features(args.features)
    matrix, feature_names, display_feature_names = build_feature_matrix(rows)
    print(f"loaded catalog features: {len(rows)} songs, {matrix.shape[1]} model features")

    dam_pages = [(url, parse_dam_html) for url in DAM_URLS]
    joysound_pages = [
        *[(url, parse_joysound_table_html) for url in JOYSOUND_TABLE_URLS],
        (JOYSOUND_THIRTY_URL, parse_joysound_thirty_html),
    ]
    dam_appearances = fetch_appearances("DAM", dam_pages)
    joysound_appearances = fetch_appearances("JOYSOUND", joysound_pages)

    dam_relevance, dam_matched = match_appearances(rows, dam_appearances)
    joysound_relevance, joysound_matched = match_appearances(rows, joysound_appearances)
    print(
        f"DAM match: {dam_matched}/{len(dam_appearances)} "
        f"({dam_matched / len(dam_appearances):.1%})"
    )
    print(
        f"JOYSOUND match: {joysound_matched}/{len(joysound_appearances)} "
        f"({joysound_matched / len(joysound_appearances):.1%})"
    )

    dam_positive = int((dam_relevance > 0).sum())
    joysound_positive = int((joysound_relevance > 0).sum())
    combined_relevance = dam_relevance + joysound_relevance
    combined_positive = int((combined_relevance > 0).sum())
    print(
        f"catalog labels: DAM positive={dam_positive}, "
        f"JOYSOUND positive={joysound_positive}, combined positive={combined_positive}, "
        f"negative={len(rows) - combined_positive}"
    )

    fame_scores = np.nan_to_num(
        np.asarray([optional_number(row, "fame_score") for row in rows]), nan=0.0
    )
    cert_scores = np.nan_to_num(
        np.asarray([optional_number(row, "cert_score") for row in rows]), nan=0.0
    )
    results = [
        *evaluate_direction(
            "DAM -> JOYSOUND",
            matrix,
            feature_names,
            dam_relevance,
            joysound_relevance,
            fame_scores,
            cert_scores,
        ),
        *evaluate_direction(
            "JOYSOUND -> DAM",
            matrix,
            feature_names,
            joysound_relevance,
            dam_relevance,
            fame_scores,
            cert_scores,
        ),
    ]
    print_evaluation_table(results)
    if not evaluation_passed(results):
        raise RuntimeError(
            "evaluation gate failed: model must beat both baselines on Spearman and "
            "NDCG@50 in both holdout directions; model and predictions were not written"
        )

    final_model = train_model(matrix, combined_relevance, feature_names)
    print_feature_importance(final_model, display_feature_names)
    write_outputs(rows, final_model, matrix, args.scores, args.model)
    print(f"\nwrote model weights: {args.model}")
    print(f"wrote predictions: {args.scores} ({len(rows)} songs)")


if __name__ == "__main__":
    main()
