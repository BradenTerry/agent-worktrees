# Refresh coalescing

A full refresh spawns `git status` for every worktree, so reacting to every raw
event would peg the CPU, and much worse on Windows where a process spawn is far
more expensive than on macOS.

## What triggers a refresh

- Extension load.
- The manual Refresh button.
- The session-state `FileSystemWatcher`, one event per Claude hook firing (which
  also surfaces an agent creating a new worktree).
- Window focus.
- Source-control scope changes.

Deliberately **not** a workspace-wide `**/*` watcher:

- Refreshing on every saved file is overkill.
- Our own `git status` opportunistically rewrites `.git/index`, so watching the
  tree fed git's writes straight back into another refresh: a perpetual loop that
  respawned git for every worktree several times a second even while idle.
- Read-only git runs with `GIT_OPTIONAL_LOCKS=0` so it never churns the user's
  index.

## Cost control in a full refresh

- `git diff --numstat HEAD` runs only for worktrees with tracked changes. A clean
  worktree skips it, halving its per-worktree spawns.
- Per-worktree statuses run at most 4 at a time (`mapLimit`), so a many-worktree
  repo never fires an unbounded spawn burst.
- A hidden sidebar still runs the git gather (the Activity Bar badge needs it) but
  skips the PR/token/remote work until re-shown.
- The Branches tab is only re-read while that tab is visible. Hidden behind
  another editor it skips the git-heavy branch listing and catches up when
  revealed.

## The agent-only path

The session-state watcher is by far the most frequent trigger while an agent
works, and it does **not** run the full gather. A hook firing means agent state
changed and files may have changed in *that* agent's worktree, not the others, so
`refreshAgents`:

- re-reads the session files and swaps the agent VMs into the last gathered
  payload;
- re-runs `git status` only for the worktrees whose sessions actually fired (the
  watcher records each changed file's session id).

It falls back to a full refresh in two cases:

- **A session appears in a worktree the cached payload does not know**, i.e. an
  agent just created one with `claude -w`.
- **One of those `git status` calls reports a different branch**, i.e. an agent ran
  `git checkout`, typically back to the default branch once its PR merged.
  - A branch change invalidates more than the patched fields: the card's branch
    name, and the PR the PR service targets. Only the full gather can re-derive
    those.
  - The branch comes free with the status call, since `git status
    --porcelain=v2 --branch` already prints a `# branch.head` header, so the check
    costs no extra process.

The posted-payload dedupe strips the `lastActivity` heartbeat (bumped by every
hook event, never rendered) from its signature, so an agent streaming tool calls
no longer re-posts, and full-DOM-rebuilds, a byte-identical panel.

## Ordering: only the newest post wins

- The full and agent-only refreshes run on separate coalescers, so they can
  overlap.
- A slow full refresh reads its session snapshot *before* the git work that delays
  it, so it could land after a faster agent-only update and overwrite newer agent
  state. This is what once left the Activity Bar badge showing a waiting agent
  that had already gone active.
- Every refresh therefore claims a monotonic token before reading session state,
  and only the newest claim may post. This is the sidebar counterpart of the
  branches view's `branchPostSeq` guard.

## The Coalescer

All signals funnel through a `Coalescer` (`src/scheduler.ts`):

- a trailing debounce (`REFRESH_DEBOUNCE_MS`, 500ms) collapsing a burst into one
  refresh;
- a `maxDelay` cap so a *continuous* stream (a build writing files, an agent
  streaming tool events) still flushes at a bounded rate instead of starving;
- in-flight coalescing so an async refresh never overlaps itself: triggers
  arriving mid-refresh fold into a single follow-up.

The session-state watcher pokes a second `Coalescer` that nudges the
independently throttled PR poller, so an active agent's hook stream does not hit
the GitHub API per event. The clock is injectable, so the coalescing guarantees
are unit-tested with virtual time in `test/scheduler.test.js`.
