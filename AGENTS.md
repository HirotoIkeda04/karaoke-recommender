<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:thread-sync-rules -->
# Simple Codex worktree rules

These rules apply only to Codex. Claude uses its own checkout policy.

- Use one fixed Codex worktree for implementation. Only one implementation task
  may use it at a time; other threads may plan or review without editing files.
- At the start of implementation, run the bootstrap from the primary checkout:

```bash
git fetch origin --prune
git show origin/main:bin/codex-thread-bootstrap.sh | bash -s --
```

- Continue in the printed worktree. The bootstrap reuses unfinished work,
  creates a new `codex/*` branch after completed work, and links `.env.local`
  from the primary checkout when available.

- If the worktree has changes or unmerged commits, continue that task instead of
  creating another implementation worktree. For a confirmed squash/rebase merge,
  use `--new-task` to start fresh from `origin/main`.
- Never use `git stash` or discard another task's changes.
- Before pushing, commit the intended changes and run:

  ```bash
  bash bin/codex-thread-update.sh
  ```

- Resolve rebase conflicts in this worktree. Use `--force-with-lease` only when
  the update script reports rewritten published history.
<!-- END:thread-sync-rules -->
