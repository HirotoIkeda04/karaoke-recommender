<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:thread-sync-rules -->
# Use one fixed Codex implementation worktree

These rules apply to Codex threads only. Claude must not run the Codex scripts;
Claude uses its own checkout and worktree isolation policy.

Classify a Codex thread before doing local project work:

- A planning-only thread may research, design, review committed code, and write
  a plan, but it must not edit files, run builds or tests, start a dev server, or
  read from the fixed implementation worktree. Prefer GitHub for repository
  inspection. If local Git is needed, use read-only commands against committed
  refs from the initial checkout, such as `git log`, `git diff`, `git show`,
  `git grep`, and `git ls-tree`. A planning thread may fetch `origin` to refresh
  those refs, but it must not inspect the initial checkout's working tree because
  it may belong to a person or another tool. Planning may run in parallel with
  implementation.
- An implementation thread edits files, runs commands that create project
  artifacts, starts servers, or changes external state. Only one implementation
  thread may be active at a time. If planning grows into implementation, stop
  and wait until the fixed implementation worktree is available.

At the start of an implementation thread, before inspecting project files,
making an implementation plan, or editing anything, fetch `origin` and run the
bootstrap script from `origin/main` exactly once from the initial checkout. Do
not run the possibly stale copy from the checked-out branch:

```bash
git fetch origin --prune
git show origin/main:bin/codex-thread-bootstrap.sh | bash -s --
```

This step is mandatory for implementation. It fetches `origin` and creates or
reuses one fixed Codex implementation worktree outside the primary repository
(default: a `-codex` sibling directory). It creates a fresh `codex/*` branch
from the latest `origin/main` only when the previous branch is clean and fully
merged (or when the user explicitly confirms that a squash/rebase merge is
complete). It never copies `.env.local`, stashes, rebases, switches, or
otherwise modifies the checkout from which it was run. Continue all
implementation work in the `CODEX_IMPLEMENTATION_WORKTREE` path printed by the
script; do not inspect or modify project files in the initial checkout. If
sandbox or network restrictions block the command, rerun it with the required
approval. If it still fails, stop instead of falling back to a shared checkout.
After bootstrap, verify that `CODEX_IMPLEMENTATION_WORKTREE` is an absolute,
existing path outside the initial repository. A path inside the repository,
including `.codex/worktrees/...`, is invalid: stop instead of using it.

Follow these rules for all Codex thread work:

- Treat `origin/main` as the source of truth. Do not use a possibly stale local
  `main` as the base of new work.
- Use the fixed worktree only from the single active implementation thread.
  Planning threads must not read or write it. Never switch branches underneath
  an active implementation thread.
- Do not run the bootstrap script again within an already-bootstrapped
  implementation thread.
- If bootstrap reports uncommitted changes, an unfinished Git operation, or an
  unmerged branch in the fixed worktree, continue the existing implementation
  thread or finish that work first. Never bypass the check with a second
  worktree unless the user explicitly authorizes an exceptional parallel
  implementation.
- Git cannot prove ancestry after a squash or rebase merge. In that case, only
  after the user explicitly confirms the pull request is merged, start the next
  implementation with
  `git fetch origin --prune`, then
  `git show origin/main:bin/codex-thread-bootstrap.sh | bash -s -- --previous-merged [task-label]`.
  This keeps the old branch and switches the fixed worktree to a fresh branch
  from `origin/main`.
- Keep `.env.local` only in the fixed implementation worktree and configure it
  once with owner-only permissions. Do not copy privileged secrets into
  planning checkouts or temporary worktrees.
- Before starting a development server or an auth/data-dependent test, verify
  that the fixed implementation worktree has its required `.env.local`. If it
  is missing, stop and ask the user to configure it. Never substitute dummy
  service URLs or keys, borrow another worktree's server or environment, or
  copy secrets from the initial checkout merely to continue verification.
- Never use `git stash` for automated synchronization. Stashes are shared by all
  worktrees in the repository and can be applied or dropped by the wrong thread.
- Before pushing or opening a pull request, commit all intended changes. A WIP
  commit is preferable to a stash. Then run:

  ```bash
  bash bin/codex-thread-update.sh
  ```

  The update script requires a clean worktree, fetches with bounded retries, and
  rebases only the current thread's committed branch onto `origin/main`. If a
  rebase conflict occurs, resolve it in this worktree and continue the rebase;
  never discard changes to make synchronization succeed.
- If the update script reports that published history was rewritten, push only
  with `git push --force-with-lease`. Never use an unconditional force push.
- After a pull request is merged, keep the fixed implementation worktree. The
  next implementation thread will reuse it and create a fresh branch after
  verifying that the previous branch is clean and contained in `origin/main`.
  Delete obsolete local branches only after confirming the merge and switching
  the fixed worktree to a different branch.
<!-- END:thread-sync-rules -->
