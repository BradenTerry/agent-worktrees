# Refresh coalescing

A full refresh spawns `git status` for every worktree, so reacting to every raw
event would peg the CPU, and much worse on Windows where a process spawn is far
more expensive than on macOS.

## What triggers a refresh

- Extension load.
- The manual Refresh button.
- The session-state `FileSystemWatcher`, one event per status transition Claude
  records (which also surfaces an agent creating a new worktree).
- The agent poll (`AGENT_POLL_MS`, 1s), while the view is visible, the **window
  is focused**, and at least one agent is on a card. Subagents are not in the
  session registry and come and go entirely inside one `busy` status, so the
  watcher never fires for them; see [subagents](subagents.md). The poll only
  makes those short-lived rows appear, which nobody is reading in a background
  window, and everything a background window still owes the user (notably the
  Activity Bar waiting badge) is watcher-driven — so several open windows no
  longer each tick once a second.
- Window focus.

Two signals are deliberately **not** full-refresh triggers, because neither says
anything about a working tree. Both patch the cached payload and repost, with no
git spawns:

- **Source-control repo open/close**, which can only move the scope pill, so it
  patches `scmActive`. That patch path is also what confirms the webview's
  optimistic pill after a scope click: the Git extension regularly registers the
  swapped repo seconds later on Windows with many worktrees, and routing that
  through the debounced full gather left the pill trailing the Source Control
  view by the length of a full refresh.
- **Fresh PR status from the poller**, which patches `pr` (`postPrState`). A PR
  with checks still running polls every 15s, and 7s in the window after a push,
  so driving a full gather off it re-spawned git for every worktree several times
  a minute to learn nothing about any of them. A worktree with no cached value
  for the branch it currently has checked out loses its badge rather than keeping
  a stale one, which is what both a cleared token and a branch switch look like
  from here.

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
- `hasDebugTargets` (the Debug button's condition) reads each worktree's
  `.vscode/launch.json` at most once per edit, keyed by mtime. A missing file —
  the common case — costs one failed `stat`. Only the answer is cached, never the
  parsed configs, so starting a session always re-reads the file and can't launch
  a stale copy.

## Settings → Performance: git's own accelerators

Everything above is this extension spending less. The largest remaining cost is
inside `git status` itself, and it is git's to fix: `status` has to report
untracked files, so it walks every directory in the working tree.

- `core.untrackedCache` keeps each directory's result in `.git/index` with its
  stat data, so a directory whose mtime has not moved is not re-read.
- `core.fsmonitor` runs a per-repo daemon on the OS's change notifications
  (FSEvents, `ReadDirectoryChangesW`) and asks it what changed. Built into git
  since **2.37**; before that the key meant "run this hook", so writing `true` to
  an older git would configure a hook path that does not exist.

Both live in the user's repository config, so the tab reports the state and gives
each one a switch. The switch is the consent (it is labelled with what it writes,
under a paragraph naming both keys, and it goes both ways), which is why there is
no modal in front of it.

**Turning off is not symmetric with turning on**, because git's defaults are not:

| Key | On | Off |
| --- | --- | --- |
| `core.untrackedCache` | `true` | `false` — unset means **keep**, which leaves an existing cache in the index and in use. Only `false` removes it. |
| `core.fsmonitor` | `true` | unset, then `false` if the effective value is still on (an inherited `--global true`). Off has to mean off. |

What the tab will not do:

- write `core.untrackedCache` when `git update-index --test-untracked-cache`
  fails, i.e. when the filesystem does not report directory mtimes reliably;
- write `core.fsmonitor` on a git older than 2.37, **or on a platform git has no
  backend for** — it shipped for macOS and Windows, and where it is missing,
  enabling it makes `git status` fail rather than speed up. That is asked of git
  (`fsmonitor--daemon status`, whose "not supported" is told apart from the
  ordinary "not running" by `saysUnsupported`) rather than mapped from
  `process.platform`, since the supported set is git's and grows between releases;
- overwrite a `core.fsmonitor` that names the user's own program (Watchman, say).
  `parsePerfConfig` distinguishes `true` (git's daemon) from a path (`hook`) for
  exactly this reason, and `keep` on the untracked cache counts as off, since it
  is not the state being offered.

The extension-host side re-checks all of that before writing: a payload the view
was rendered from can be stale, and a stale payload must not be able to talk the
provider into enabling something on an unsupported platform.

The filesystem test runs at the repo root, and the config is written there too,
which is the only coherent single answer: linked worktrees share that config. A
worktree living on a different (and unsuitable) filesystem is not something one
setting can express.

The state is read **on demand**, when the tab is opened (`loadGitPerf`), not on
the refresh path: it is three git calls, one of which walks the working tree. It
is requested from `renderSettings`, not from the tab click, because the selected
tab outlives closing Settings — reopening straight onto Performance has to ask
too. The
result is cached on the provider and rides along on later payloads, so the section
re-renders from data like every other tab. `getStatus` also reports the first
status slower than `SLOW_STATUS_MS` to the provider
(`setSlowStatusHandler`), which is what turns the tab's lead line from a
description into "this repo measured slow, here is the fix".

## The agent-only path

The session-state watcher is by far the most frequent trigger while an agent
works, and it does **not** run the full gather. An event means agent state
changed and files may have changed in *that* agent's worktree, not the others, so
`refreshAgents`:

- re-reads the session files and swaps the agent VMs — and the subagent rows the
  cards own, which a fan-out puts on a card with no agent of its own — into the
  last gathered payload;
- re-runs `git status` only for the worktrees whose sessions actually fired (the
  watcher records each changed file's session id). The poll records none, so a
  poll spawns no git at all;
- and only if that worktree has not been stat'd in the last `STATUS_TTL_MS` (2s).
  Claude rewrites a session's registry file on every status transition, and a
  working agent transitions several times a second, so even after the 500ms
  coalescer a busy turn re-stat'd the same worktree twice a second. The numbers on
  a card summarize a tree the agent is still editing; two seconds of lag is
  invisible. Only this path throttles — a full gather always re-stats, and so do
  the card's refresh button and the global Refresh, so no count can be stale
  longer than the next real refresh.

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
    costs no extra process. A worktree throttled by `STATUS_TTL_MS` is not stat'd,
    so a checkout can go unnoticed for those two seconds.

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
