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

# Step 2: backfill:spotify-metadata (既存 matched 曲のメタ補完)
run_step "backfill:spotify-metadata --max 100" \
  node --import tsx scripts/backfill-spotify-metadata.ts --max 100

echo "=========================================" | tee -a "$LOG_FILE"
echo "nightly routine end: $(date)" | tee -a "$LOG_FILE"
echo "=========================================" | tee -a "$LOG_FILE"
