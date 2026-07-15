#!/usr/bin/env bash

set -euo pipefail

log() {
  printf '[thread-update] %s\n' "$*"
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

  die "Fetching origin failed three times. Rerun the update before pushing."
}

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" ||
  die "Run this command inside the fixed implementation worktree."
cd "$repo_root"

git remote get-url origin >/dev/null 2>&1 ||
  die "The origin remote is not configured."

active_operation="$(operation_in_progress || true)"
if test -n "$active_operation"; then
  die "An unfinished Git operation exists ($active_operation). Resolve or abort it before updating."
fi

branch="$(git symbolic-ref --quiet --short HEAD || true)"
case "$branch" in
  codex/*) ;;
  "") die "Detached HEAD is not a Codex task branch." ;;
  *) die "Refusing to update $branch. Run this only on the fixed implementation worktree's codex/* branch." ;;
esac

if test -n "$(git status --porcelain=v1 --untracked-files=normal)"; then
  die "The worktree is not clean. Commit the intended changes (a WIP commit is acceptable) before updating; do not stash them."
fi

log "Fetching origin and pruning deleted branches..."
fetch_origin

git show-ref --verify --quiet refs/remotes/origin/main ||
  die "origin/main was not found after fetch."

remote_ref="refs/remotes/origin/$branch"
if git show-ref --verify --quiet "$remote_ref" &&
  ! git merge-base --is-ancestor "$remote_ref" HEAD; then
  die "origin/$branch contains commits that are not in this worktree. Reconcile that remote work before rebasing; refusing to make a force-push look safe."
fi

if git merge-base --is-ancestor origin/main HEAD; then
  log "$branch already contains the latest origin/main."
else
  log "Rebasing the current thread's committed branch onto origin/main..."
  if ! git rebase origin/main; then
    log "Rebase stopped for conflict resolution in this worktree."
    log "Resolve the conflicts, stage the resolutions, and run git rebase --continue."
    log "Use git rebase --abort only if you intend to return to the pre-update branch."
    exit 2
  fi
  log "$branch is current at $(git rev-parse --short HEAD)."
fi

if ! git show-ref --verify --quiet "$remote_ref"; then
  log "This branch is not published. First push: git push -u origin $branch"
elif git merge-base --is-ancestor "$remote_ref" HEAD; then
  log "Published history is intact. Push with: git push origin $branch"
else
  log "Published history was rewritten. Push only with: git push --force-with-lease origin $branch"
fi
