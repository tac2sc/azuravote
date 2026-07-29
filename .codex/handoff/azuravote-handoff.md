# AzuraVote handoff

## Current state

- Repository: `/var/azuracast/azuravote/azuravote`
- Current branch: `main`, tracking `origin/main`
- HEAD: `654afc3f554e8d464ffc73f6fb85985655bb7e7a` — `Merge branch 'chat'`
- Working tree was clean when this handoff was created.
- The branch is synchronized with `origin/main`.

## Completed work

- The `chat` branch was merged and released as `0.2.1-alpha`; see merge commit `654afc3` and release commit `87e5e40` for full scope.
- The final landscape placement fix is `0266b7f` (`Keep landscape controls inside player card`). It keeps only the Ratings/Chat controls in the radio widget's nearest `.card`; portrait and desktop layouts remain unchanged.
- Browser diagnosis against the live AzuraCast DOM established the root cause: in landscape, the player-panel heuristic selected `.public-page` as the controls' containing block. The committed fix scopes the parent correction to controls only.
- `CHAT_ENABLED=true` is the documented default; chat configuration and bottom-oriented composer behavior are included in the merged release.

## Tests

- Full containerized suite: `rtk docker compose run --rm azuravote npm test` passed on the current merged `main` branch.
- Focused adapter portrait/landscape regression tests passed.
- `rtk node --check public/player-adapter.js` passed.
- A real headless-Chrome check against the AzuraCast public page verified the controls' containing block and geometry in portrait, landscape, and desktop modes before the merge.

## Remaining tasks

- No open implementation task is currently recorded.
- Publish/deploy only when explicitly requested. The merge is on `main`; do not alter branches unnecessarily.

## Constraints

- Always prefix shell commands with `rtk`.
- Inspect local Git before accessing remotes. Do not force-push or use destructive Git operations without explicit approval.
- Public access must remain through AzuraCast nginx at `/votes/...`; do not expose port 3099 directly.
- Keep `PUBLIC_BASE_URL` canonical. Bump `/votes/embed.js?v=N` in AzuraCast Custom JS after future `public/embed.js` changes.
- Preserve unrelated worktree changes and stage only scoped files.
- Before new project work, read the agent context documents under `/var/azuracast/azuravote/.codex-handover/agent-context/` as required by the project instructions.

## Exact next steps

1. `cd /var/azuracast/azuravote/azuravote`
2. `rtk git status --short --branch`
3. `rtk docker compose run --rm azuravote npm test`
4. For a new change, inspect the affected adapter or server seam and add a focused regression test before editing.

## Suggested skills

- `implement` for an approved code change.
- `diagnosing-bugs` for regressions or failures.
- `tdd` for test-first work.
- `code-review` after substantive changes.
- `handoff` before transferring work again.
