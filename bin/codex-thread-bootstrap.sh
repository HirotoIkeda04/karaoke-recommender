#!/usr/bin/env bash

set -euo pipefail

log() {
  printf '[thread-bootstrap] %s\n' "$*"
}

die() {
  log "ERROR: $*"
  exit 1
}

operation_in_progress() {
  local state state_path

  for state in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG sequencer; do
    state_path="$(git rev-parse --git-path "$state")"
    if test -e "$state_path"; then
      printf '%s\n' "$state"
      return 0
    fi
  done

  return 1
}

fetch_origin() {
  local attempt

  for attempt in 1 2 3; do
    if git fetch origin --prune; then
      return 0
    fi

    if test "$attempt" -lt 3; then
      log "Fetch attempt $attempt failed, possibly because another thread held a ref lock; retrying..."
      sleep "$attempt"
    fi
  done

  die "Fetching origin failed three times. Rerun the bootstrap; do not use the shared checkout."
}

initial_root="$(git rev-parse --show-toplevel 2>/dev/null)" ||
  die "Run this command inside the repository."
cd "$initial_root"

git remote get-url origin >/dev/null 2>&1 ||
  die "The origin remote is not configured."

active_operation="$(operation_in_progress || true)"
if test -n "$active_operation"; then
  die "The initial checkout has an unfinished Git operation ($active_operation). Resolve it before starting another thread."
fi

log "Fetching origin and pruning deleted branches..."
fetch_origin

git show-ref --verify --quiet refs/remotes/origin/main ||
  die "origin/main was not found after fetch."

common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
if test "$(basename "$common_dir")" != ".git"; then
  die "Expected a non-bare repository with a .git common directory."
fi

primary_root="$(dirname "$common_dir")"
worktree_parent="${CODEX_WORKTREE_ROOT:-$primary_root/.codex/worktrees}"
mkdir -p "$worktree_parent"

raw_label="${1:-thread}"
label="$(printf '%s' "$raw_label" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9._-' | cut -c1-40)"
if test -z "$label"; then
  label="thread"
fi

timestamp="$(date +%Y%m%d-%H%M%S)"
suffix="$label-$timestamp-$$"
branch="codex/$suffix"
worktree_path="$worktree_parent/$suffix"
counter=0

while git show-ref --verify --quiet "refs/heads/$branch" || test -e "$worktree_path"; do
  counter=$((counter + 1))
  suffix="$label-$timestamp-$$-$counter"
  branch="codex/$suffix"
  worktree_path="$worktree_parent/$suffix"
done

log "Creating isolated worktree $worktree_path from origin/main..."
if ! git worktree add --no-track -b "$branch" "$worktree_path" origin/main; then
  die "Worktree creation failed, possibly because another thread held a Git lock. Rerun the bootstrap."
fi

log "Created $branch at $(git -C "$worktree_path" rev-parse --short HEAD)."
log "Continue this thread only in the worktree printed below."
printf 'CODEX_THREAD_WORKTREE=%s\n' "$worktree_path"
printf 'CODEX_THREAD_BRANCH=%s\n' "$branch"
