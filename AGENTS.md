<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:thread-sync-rules -->
# Isolate every Codex thread on the latest main

These rules apply to Codex threads only. Claude must not run the Codex scripts;
Claude uses its own checkout and worktree isolation policy.

At the start of every new Codex thread, before inspecting project files, making
a plan, or editing anything, run this exactly once from the initial checkout:

```bash
bash bin/codex-thread-bootstrap.sh
```

This step is mandatory. It fetches `origin` and creates a unique `codex/*`
branch and isolated worktree from the latest `origin/main`. It never stashes,
rebases, switches, or otherwise modifies the checkout from which it was run.
Continue all work in the `CODEX_THREAD_WORKTREE` path printed by the script;
do not inspect or modify project files in the initial checkout. If sandbox or
network restrictions block the command, rerun it with the required approval.
If it still fails, stop instead of falling back to a shared checkout.

Follow these rules for all Codex thread work:

- Treat `origin/main` as the source of truth. Do not use a possibly stale local
  `main` as the base of new work.
- Use only the branch and worktree created for the current thread. Never share
  an active task branch or worktree, and never switch branches underneath
  another thread's work.
- Do not run the bootstrap script again within an already-bootstrapped thread.
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
- After a pull request is merged, remove its worktree from a different, clean
  worktree with `git worktree remove` (never `--force`), delete the obsolete
  branch only after confirming the merge, and run `git worktree prune`. Never
  remove a worktree that contains uncommitted changes.
<!-- END:thread-sync-rules -->
