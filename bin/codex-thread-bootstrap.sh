#!/usr/bin/env bash

set -euo pipefail

log() {
  printf '[thread-bootstrap] %s\n' "$*"
}

die() {
  log "ERROR: $*"
  exit 1
}

has_worktree_changes() {
  ! git diff --quiet ||
    ! git diff --cached --quiet ||
    test -n "$(git ls-files --others --exclude-standard)"
}

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" ||
  die "Run this command inside the repository."
cd "$repo_root"

git remote get-url origin >/dev/null 2>&1 ||
  die "The origin remote is not configured."

log "Fetching origin and pruning deleted branches..."
git fetch origin --prune

git show-ref --verify --quiet refs/remotes/origin/main ||
  die "origin/main was not found after fetch."

branch="$(git symbolic-ref --quiet --short HEAD || true)"

if test -z "$branch"; then
  if has_worktree_changes; then
    die "Detached HEAD has local changes. Create a recovery branch before synchronizing."
  fi
  log "Detached HEAD is clean; moving it to the latest origin/main."
  git switch --detach origin/main
  log "Ready at $(git rev-parse --short HEAD)."
  exit 0
fi

if test "$branch" = "main"; then
  if has_worktree_changes; then
    recovery_branch="codex/recovered-main-$(date +%Y%m%d-%H%M%S)"
    log "main has local changes; preserving them on $recovery_branch."
    git switch -c "$recovery_branch"
    branch="$recovery_branch"
  else
    log "Fast-forwarding main to origin/main..."
    git merge --ff-only origin/main
    log "main is current at $(git rev-parse --short HEAD)."
    exit 0
  fi
fi

if git merge-base --is-ancestor origin/main HEAD; then
  log "$branch already contains the latest origin/main."
  exit 0
fi

if ! has_worktree_changes; then
  log "Rebasing clean branch $branch onto origin/main..."
  git rebase origin/main
  log "$branch is current at $(git rev-parse --short HEAD)."
  exit 0
fi

stash_message="codex-thread-bootstrap:$branch:$(date +%s):$$"
log "Temporarily stashing local work before rebasing $branch..."
git stash push --include-untracked --message "$stash_message" >/dev/null

if ! git rebase origin/main; then
  log "Rebase failed; aborting and restoring the original worktree."
  git rebase --abort >/dev/null 2>&1 || true
  if git stash apply stash@{0}; then
    git stash drop stash@{0} >/dev/null
  else
    log "The original work remains in stash@{0}; resolve the restore conflict before continuing."
  fi
  exit 2
fi

log "Restoring local work on top of the updated branch..."
if git stash apply stash@{0}; then
  git stash drop stash@{0} >/dev/null
  log "$branch now includes origin/main and all local work was restored."
  exit 0
fi

log "Restore conflicts need resolution. The safety copy remains in stash@{0}."
exit 3
