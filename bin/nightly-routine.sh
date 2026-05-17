#!/usr/bin/env bash
# ============================================================================
# karaoke-recommender 夜間ルーチン
# ----------------------------------------------------------------------------
# 1 セッション内で Spotify quota (500 call/夜) を超えない範囲で:
#   1. match:dam --max-new 400  (fame_cache 候補曲を Spotify と紐付け)
#   2. backfill:spotify-metadata --max 100  (既存 matched 曲のメタ補完)
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

# Step 3: 週次ランキング取得 (月曜のみ)
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

echo "=========================================" | tee -a "$LOG_FILE"
echo "nightly routine end: $(date)" | tee -a "$LOG_FILE"
echo "=========================================" | tee -a "$LOG_FILE"
