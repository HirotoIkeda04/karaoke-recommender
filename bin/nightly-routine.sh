#!/usr/bin/env bash
# ============================================================================
# karaoke-recommender 夜間ルーチン
# ----------------------------------------------------------------------------
# 1 セッション内で Spotify quota (500 call/夜) を超えない範囲で:
#   1. match:dam --max-new 400  (fame_cache 候補曲を Spotify と紐付け)
#   2. backfill:itunes-metadata --order fame --limit 500  (メタ補完)
#   3. backfill:itunes-previews --limit 300  (試聴音源 URL 補完)
#   4. fetch:weekly-rankings  (月曜のみ)
#   5. refresh:browse-snapshot  (検索タブの共有データを再計算)
#
# 累計 ~500 call → quota の安全境界内。
#
# ログ: logs/nightly-<date>.log に追記。古いログは launchd の管理外なので
# 別途定期的に手動で掃除を推奨。
#
# launchd / cron / 手動どれからでも実行可能 (環境変数は .env.local から読む)。
#
# 終了コード:
#   0: 全ステップ成功 or quota_hit (quota_hit は正常終了扱い)
#   非 0: スクリプト実行時の致命的エラー
# ============================================================================
set -u
set -o pipefail

# このスクリプトの絶対パスからプロジェクトルートを引く
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

cd "$PROJECT_ROOT" || { echo "FAIL: cd $PROJECT_ROOT"; exit 1; }

# ログ準備
LOG_DIR="$PROJECT_ROOT/logs"
mkdir -p "$LOG_DIR"
DATE_STR="$(date +%Y-%m-%d)"
LOG_FILE="$LOG_DIR/nightly-${DATE_STR}.log"

# 環境変数を .env.local から読む。`--env-file` だと一部の変数を取りこぼす
# 既知バグがあるため、shell の `set -a; .` でロードする。
if [ -f "$PROJECT_ROOT/.env.local" ]; then
  set -a
  # shellcheck disable=SC1090,SC1091
  . "$PROJECT_ROOT/.env.local"
  set +a
else
  echo "FAIL: .env.local not found" | tee -a "$LOG_FILE"
  exit 1
fi

run_step() {
  local label="$1"
  shift
  echo "===== [$(date +%H:%M:%S)] $label =====" | tee -a "$LOG_FILE"
  if "$@" 2>&1 | tee -a "$LOG_FILE"; then
    echo "  -> [OK] $label" | tee -a "$LOG_FILE"
    return 0
  else
    local rc=$?
    echo "  -> [WARN] $label exited with $rc (続行)" | tee -a "$LOG_FILE"
    return 0  # 1 ステップの失敗で全体停止しない
  fi
}

echo "=========================================" | tee -a "$LOG_FILE"
echo "nightly routine start: $(date)" | tee -a "$LOG_FILE"
echo "node: $(node --version 2>/dev/null || echo missing)" | tee -a "$LOG_FILE"
echo "=========================================" | tee -a "$LOG_FILE"

# Step 1: match:dam (fame_cache の未マッチ曲を Spotify と紐付け)
run_step "match:dam --max-new 400" \
  node --import tsx scripts/match-dam-songs.ts --max-new 400

# Step 2: backfill:itunes-metadata (duration_ms / release_year / 画像欠損補完)
# Spotify の /v1/tracks 制限・quota を回避し iTunes Search で duration を埋める。
# iTunes は quota が緩いので 1 夜 500 件処理可能 (~29 分 @ 3.5s/req)。
# --order fame: 有名曲 (fame_score 降順) を優先。有名曲のページ歯抜け
# (duration 99.8% 欠損) を先に解消するため。fame 帯を埋め切ったら
# NULLS LAST で自動的に無名曲へ移行する。
run_step "backfill:itunes-metadata --order fame --limit 500" \
  node --import tsx scripts/backfill-itunes-metadata.ts --order fame --limit 500

# Step 3: backfill:itunes-previews (ホームのレコードデッキの試聴音源 URL)
# itunes_preview_checked_at IS NULL の曲を is_popular → fame_score 順に処理。
# これが無いと新規追加曲は itunes_preview_url が NULL のままで試聴が無音になる。
# Step 2 と同じ iTunes Search API を叩くので、直列実行のまま ~17 req/min を維持
# (公称 20/min 内)。300 件 = ~18 分。
run_step "backfill:itunes-previews --limit 300" \
  node --import tsx scripts/backfill-itunes-previews.ts --limit 300

# Step 4: 週次ランキング取得 (月曜のみ)
# date +%u: 1=Mon ... 7=Sun。Spotify Top 50 + Apple Top 100 を合算して
# weekly_rankings に upsert する。所要 Spotify call: ~100 (Apple 100 件 ×
# search 1 回ずつ) — quota 残量に注意。
DOW="$(date +%u)"
if [ "$DOW" = "1" ]; then
  run_step "fetch:weekly-rankings" \
    node --import tsx scripts/fetch-weekly-rankings.ts
else
  echo "===== [$(date +%H:%M:%S)] fetch:weekly-rankings skipped (DOW=$DOW, not Monday) =====" | tee -a "$LOG_FILE"
fi

# Step 5: 検索タブの共有ブラウズデータを1行JSONへ事前計算
run_step "refresh:browse-snapshot" \
  node --import tsx scripts/refresh-browse-snapshot.ts

echo "=========================================" | tee -a "$LOG_FILE"
echo "nightly routine end: $(date)" | tee -a "$LOG_FILE"
echo "=========================================" | tee -a "$LOG_FILE"
