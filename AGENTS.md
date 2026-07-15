<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:thread-sync-rules -->
# Keep every Codex thread current

At the start of every new thread, before inspecting project files, making a plan,
or editing anything, run:

```bash
bash bin/codex-thread-bootstrap.sh
```

This step is mandatory. It fetches and prunes `origin`, fast-forwards a clean
`main`, and rebases a task branch onto the latest `origin/main`. If the task
branch has uncommitted or untracked work, the script temporarily stashes it,
rebases, and restores it. If sandbox or network restrictions block the command,
rerun it with the required approval instead of skipping synchronization.

Follow these rules for all thread work:

- Treat `origin/main` as the source of truth. Do not use a possibly stale local
  `main` as the base of new work.
- Use one dedicated `codex/<task-name>` branch and one dedicated worktree per
  thread. Never share an active task branch or worktree between threads.
- Before changing files, ensure the thread is not on `main`. For a mutating task
  started from a clean `main`, create the task branch from `origin/main`.
- If the current worktree contains unrelated changes from another task, leave
  them in place and create a separate worktree from `origin/main` for the new
  task. Never switch branches underneath another thread's work.
- Run `bash bin/codex-thread-bootstrap.sh` again immediately before committing,
  pushing, or opening a pull request.
- Never discard changes to make synchronization succeed. On a conflict, preserve
  the stash and resolve the conflict while keeping both the local work and the
  latest main behavior.
- After a branch is merged, remove its obsolete local/remote branch and worktree
  once they are confirmed clean.
<!-- END:thread-sync-rules -->
