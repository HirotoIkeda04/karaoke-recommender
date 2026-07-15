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
  local repo="$1"
  local state state_path

  for state in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG sequencer; do
    state_path="$(git -C "$repo" rev-parse --git-path "$state")"
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

verify_bootstrap_is_current() {
  local script_source expected_blob actual_blob

  script_source="${BASH_SOURCE[0]:-}"
  if test -z "$script_source" || test ! -f "$script_source"; then
    return 0
  fi

  expected_blob="$(git rev-parse 'origin/main:bin/codex-thread-bootstrap.sh')" ||
    die "Could not resolve the bootstrap script from origin/main."
  actual_blob="$(git hash-object "$script_source")"
  if test "$actual_blob" != "$expected_blob"; then
    die "This bootstrap script is stale. Run: git show origin/main:bin/codex-thread-bootstrap.sh | bash -s --"
  fi
}

worktree_is_registered() {
  local target="$1"

  git worktree list --porcelain | awk -v target="$target" '
    $1 == "worktree" && substr($0, 10) == target { found = 1 }
    END { exit(found ? 0 : 1) }
  '
}

new_branch_name() {
  local raw_label="${1:-implementation}"
  local label timestamp suffix branch counter

  label="$(printf '%s' "$raw_label" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9._-' | cut -c1-40)"
  if test -z "$label"; then
    label="implementation"
  fi

  timestamp="$(date +%Y%m%d-%H%M%S)"
  suffix="$label-$timestamp-$$"
  branch="codex/$suffix"
  counter=0

  while git show-ref --verify --quiet "refs/heads/$branch"; do
    counter=$((counter + 1))
    branch="codex/$suffix-$counter"
  done

  printf '%s\n' "$branch"
}

previous_merge_confirmed=0
if test "${1:-}" = "--previous-merged"; then
  previous_merge_confirmed=1
  shift
fi

if test "$#" -gt 1; then
  die "Usage: git show origin/main:bin/codex-thread-bootstrap.sh | bash -s -- [--previous-merged] [task-label]"
fi

task_label="${1:-implementation}"

initial_root="$(git rev-parse --show-toplevel 2>/dev/null)" ||
  die "Run this command inside the repository."
cd "$initial_root"

git remote get-url origin >/dev/null 2>&1 ||
  die "The origin remote is not configured."

active_operation="$(operation_in_progress "$initial_root" || true)"
if test -n "$active_operation"; then
  die "The initial checkout has an unfinished Git operation ($active_operation). Resolve it before starting another thread."
fi

log "Fetching origin and pruning deleted branches..."
fetch_origin

git show-ref --verify --quiet refs/remotes/origin/main ||
  die "origin/main was not found after fetch."

verify_bootstrap_is_current

common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
if test "$(basename "$common_dir")" != ".git"; then
  die "Expected a non-bare repository with a .git common directory."
fi

primary_root="$(cd "$(dirname "$common_dir")" && pwd -P)"
worktree_path="${CODEX_IMPLEMENTATION_WORKTREE:-${primary_root}-codex}"

case "$worktree_path" in
  /*) ;;
  *) die "CODEX_IMPLEMENTATION_WORKTREE must be an absolute path." ;;
esac

worktree_parent="$(dirname "$worktree_path")"
test -d "$worktree_parent" ||
  die "The parent directory for CODEX_IMPLEMENTATION_WORKTREE must already exist: $worktree_parent"
worktree_parent="$(cd "$worktree_parent" && pwd -P)"
worktree_path="$worktree_parent/$(basename "$worktree_path")"

case "$worktree_path" in
  "$primary_root" | "$primary_root"/*)
    die "The implementation worktree must be outside the primary repository. Set CODEX_IMPLEMENTATION_WORKTREE to an external path."
    ;;
esac

if worktree_is_registered "$worktree_path"; then
  test -d "$worktree_path" ||
    die "The fixed implementation worktree is registered but missing at $worktree_path. Repair it from another clean worktree."

  active_operation="$(operation_in_progress "$worktree_path" || true)"
  if test -n "$active_operation"; then
    die "The implementation worktree has an unfinished Git operation ($active_operation). Continue in the existing implementation thread."
  fi

  branch="$(git -C "$worktree_path" symbolic-ref --quiet --short HEAD || true)"
  case "$branch" in
    codex/*) ;;
    "") die "The fixed implementation worktree is detached. Repair it before starting implementation." ;;
    *) die "The fixed implementation worktree is on $branch, not a codex/* branch. Repair it before starting implementation." ;;
  esac

  if test -n "$(git -C "$worktree_path" status --porcelain=v1 --untracked-files=normal)"; then
    die "The fixed implementation worktree contains uncommitted changes. Another implementation thread may be active; continue there or finish it first."
  fi

  if ! git merge-base --is-ancestor "$branch" origin/main; then
    if test "$previous_merge_confirmed" -ne 1; then
      die "The fixed implementation branch $branch is not contained in origin/main. Continue or merge it first. If its PR was squash- or rebase-merged, rerun with --previous-merged only after explicit user confirmation."
    fi
    log "Previous squash/rebase merge was explicitly confirmed; preserving $branch and starting from origin/main."
  fi

  branch="$(new_branch_name "$task_label")"
  log "Reusing fixed implementation worktree $worktree_path..."
  if ! git -C "$worktree_path" switch --no-track -c "$branch" origin/main; then
    die "Could not switch the fixed implementation worktree to a fresh branch."
  fi
else
  test ! -e "$worktree_path" ||
    die "$worktree_path already exists but is not a registered worktree. Move it aside or choose CODEX_IMPLEMENTATION_WORKTREE."

  branch="$(new_branch_name "$task_label")"
  log "Creating fixed implementation worktree $worktree_path from origin/main..."
  if ! git worktree add --no-track -b "$branch" "$worktree_path" origin/main; then
    die "Worktree creation failed, possibly because another thread held a Git lock. Rerun the bootstrap."
  fi
fi

log "Implementation worktree ready on $branch at $(git -C "$worktree_path" rev-parse --short HEAD)."
if test -f "$primary_root/.env.local" && test ! -f "$worktree_path/.env.local"; then
  log ".env.local was not copied. Configure it once in the fixed worktree; privileged secrets must not be duplicated automatically."
fi
log "Continue implementation only in the fixed worktree printed below."
printf 'CODEX_IMPLEMENTATION_WORKTREE=%s\n' "$worktree_path"
printf 'CODEX_IMPLEMENTATION_BRANCH=%s\n' "$branch"
printf 'CODEX_THREAD_WORKTREE=%s\n' "$worktree_path"
printf 'CODEX_THREAD_BRANCH=%s\n' "$branch"
