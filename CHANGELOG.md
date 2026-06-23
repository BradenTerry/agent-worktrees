# Changelog

All notable changes to the Agent Worktrees extension are documented here.

## 3.3.1

- **Reviewer filter** - the Branches filter bar gains a **Reviewer** single-select
  beside **PR Status** that narrows the list to branches whose pull request has a
  review requested from one or more person: **All** (no filter) or **Review
  requested**. Shown only once a GitHub token is connected, and reset by Clear
  Filters.

## 3.3.0

- **Switch a worktree's branch from the panel** - an edit button beside the
  branch name checks out a different branch in that worktree, or creates a new
  one, without leaving the panel.
- **PR Status filter** - the Branches filter bar's one-click **Open PRs** toggle
  is now a **PR Status** single-select with **All** (no filter), **Open**, and
  **Draft**, so you can narrow the list to just open or just draft pull requests.
- **Clear Filters button** - a one-click reset for the Branches view's author and
  PR Status filters, enabled only while a filter is active. Sort is left as you
  set it.
- **The Branches view paints instantly** - the branch list now renders right away
  from local git instead of waiting on the GitHub token probe; PR and CI status
  fill in afterward in the background.
- **A merged PR no longer lingers after switching branches** - when a worktree
  switches off the branch a merged pull request was tied to, the PR badge clears
  instead of staying on the card until the next poll.
- **New Debug tab in Settings** - the panel's Settings view gains a Debug tab
  surfacing diagnostic details for troubleshooting.

## 3.2.0

- **The Branches view now fetches only open PRs** - it previously listed every
  PR in the repo (open, merged and closed), which paged through up to ~1000
  historical PRs on a repo with a long history to surface a handful of open ones.
  Since the view only ever shows open and draft PRs, it now requests just those,
  so the fetch is typically a single call. The header button is renamed from
  **Refresh GitHub** to **Fetch Open PRs** to match.
- **New Open PRs filter** - a one-click toggle in the Branches filter bar (shown
  only when a GitHub token is connected) narrows the list to branches with an
  open pull request.
- **Alternating row backgrounds** - adjacent worktree cards and branch rows now
  alternate their background shade so they are easier to tell apart.

## 3.1.1

- **The Branches view PR status now works with fine-grained tokens** - it
  previously fetched PRs through GitHub's GraphQL API, which a fine-grained
  personal access token can be denied even when it works for the worktree cards
  (the "Resource not accessible by personal access token" error). The view now
  pulls every PR for the repo in a single REST call that only needs
  **Pull requests: Read**. The tradeoff: the bulk call carries no CI-check or
  review-approval detail, so the Branches view shows a PR's title, state, author,
  assignees and whether you are a requested reviewer, but not its checks/reviews
  rollup - that is still on the worktree card.
- **Fewer redundant git calls on refresh** - the repo's default branch
  (`origin/HEAD`) was looked up several times per refresh, spawning duplicate
  `git symbolic-ref` processes (most noticeable on Windows). It is now resolved
  once and reused.

## 3.1.0

- **The Branches view is now git-first** - branches always list, sort, and
  filter from local git, with no GitHub needed. Each row shows when the branch
  was last updated (the relative time of its latest commit) and who made that
  commit. A new **Updated by** filter narrows the list to the people who last
  touched each branch, and **Sort** orders by most or least recently updated, or
  by name. The old PR-based filters (Author, Reviews, Open PR / Auto merge) are
  gone in favor of these.
- **A branch's pull request is shown as a hint** - when the GitHub integration
  is connected, a branch that has an open (or draft) PR still shows its status
  inline on the row. Merged and closed PRs are no longer displayed. A dedicated
  PR view may come later.
- **The "@" next to review counts is now a proper icon** - the requested
  reviewers ("review pending") count rendered a bare "@" character that looked
  like a glyph that failed to load next to the other icons. It is now an eye
  icon, matching GitHub's "review requested" convention.
- **Easier to diagnose missing PR status** - when the Branches view can fetch no
  PRs even though the worktree cards show them, the reason (the GraphQL call's
  error, or a "fetched N PRs, matched M branches" tally) is logged to the "Agent
  Worktrees" output channel. The cards use a different GitHub API path than the
  Branches view, so a token granted one but not the other now surfaces clearly.

## 3.0.0

- **No more runaway refresh loop** - the panel watched the whole workspace for
  file changes, but its own `git status` opportunistically rewrites
  `.git/index`, so each refresh fed straight back into another refresh - a
  self-sustaining loop that respawned git for every worktree several times a
  second even while the editor sat idle. The workspace-wide watcher is gone; the
  panel now refreshes on discrete signals (load, the Refresh button, Claude
  agent activity, window focus, source-control scope changes). Read-only git
  also runs with `GIT_OPTIONAL_LOCKS=0` so it never churns your index.
- **Stop agent works on Windows** - stopping an agent (and removing a worktree
  with a running agent) had no effect on Windows: the kill paths were
  Unix-only, so the panel row vanished while the Claude process kept running and
  could hold the worktree directory open, blocking removal. Stopping now
  tree-kills the agent by its session id via `taskkill /T`, which also reaches
  the `claude -w` child process.
- **Per-worktree refresh button** - each worktree card now has a refresh button
  that re-reads just that worktree's git status and, when the GitHub integration
  is on, re-fetches that one worktree's PR/CI status. It does not run a `git
  fetch` (that stays the toolbar Refresh), so it's a quick, targeted update of a
  single card instead of refreshing everything.

## 2.7.7

- **Branches view no longer shows a +/- line diff** - computing it required one
  `git diff` process per branch (git has no batch form), which was the main
  remaining cost when listing branches on a large repo. The branch rows now show
  just the commit ahead/behind (the more useful signal), which is already
  computed in a single batched call. Listing a repo's branches now costs a
  handful of git processes total instead of one diff per branch. The worktree
  cards still show their +/- line totals.

## 2.7.6

- **Faster worktree loading** - loading the panel ran `git status` AND
  `git diff --numstat HEAD` for every worktree on every refresh. The diff is
  empty for a clean worktree, so it is now skipped unless the worktree has
  tracked changes. A clean worktree costs one git spawn instead of two, which
  noticeably cuts the "Loading worktrees" time (and the non-stop
  `git diff --numstat HEAD` calls) on Windows, where each process spawn is
  expensive. The worktree-load time is also logged when debug tracing is on.

## 2.7.5

- **Debug tracing for external calls** - a new `Agent Worktrees: Trace` setting
  (off by default) logs every external call to the "Agent Worktrees" output
  channel: each git command and each GitHub API request, with its duration and
  result. Turn it on to see exactly what the panel runs on your machine (handy
  for diagnosing slow or failing git/GitHub activity on Windows or Mac). Toggle
  it from Settings or the "Agent Worktrees: Toggle Debug Tracing" command;
  "Agent Worktrees: Show Log" reveals the channel. Request headers (which carry
  your token) are never logged.

## 2.7.4

- **Panel is much less of a CPU hog on Windows** - the sidebar refreshes when
  files change, when an agent fires a hook, and when the window regains focus,
  and each refresh spawns `git status` + `git diff` for every worktree. The
  session-state watcher used to refresh on every single hook event with no
  batching, so an active agent (which fires many hooks a second) triggered a
  storm of git processes - and process spawning plus file watching are both far
  more expensive on Windows than on macOS, which is what made the panel feel
  sluggish. All three signals now funnel through a debouncing coalescer: a burst
  of events collapses into one refresh, a continuous stream (a build writing
  files, an agent streaming tool output) still flushes at a bounded rate instead
  of either spamming or stalling, and an in-flight refresh never overlaps itself.
  The behavior is unchanged - the panel shows the same up-to-date state - it just
  does the expensive work far less often.

## 2.7.3

- **Branches view is much faster on big repos** - ahead/behind for every branch
  is now computed in a single `git for-each-ref` call (using the
  `%(ahead-behind:)` atom on git 2.41+) instead of one `git rev-list` per branch.
  Combined with the existing "diff only branches that are ahead", a repo with
  dozens of branches now spawns a handful of git processes on load instead of one
  or two per branch, which is what pegged the CPU and stalled the view on
  Windows. On older git (pre-2.41) it falls back to the per-branch calls.
- **Branches view surfaces failures instead of a blank list** - when listing
  branches fails (git missing, hung, or timed out) the view now shows the error
  and points to the new "Agent Worktrees" output channel, rather than a
  misleading "No branches found". This is aimed at the Windows reports where the
  view never loaded and there was nothing to diagnose: git activity, per-load
  timing (branch count and how many ahead/behind and diff calls ran), and any
  failure are now logged to View -> Output -> "Agent Worktrees".
- **Git calls no longer hang the view forever** - every git invocation now has a
  timeout, so a wedged call (auth prompt, stalled network) surfaces as an error
  instead of an endless "Loading branches" spinner.

## 2.7.2

- **Branches view loads fast on Windows** - listing branches enriches each one
  with ahead/behind and a line diff, and every git call used to run through a
  shell (`child_process.exec`), which on Windows spawns a `cmd.exe` per call. On
  a repo with many branches that meant hundreds of `cmd.exe` + `git.exe` spawns
  per load, pegging the CPU and leaving the view stuck on "Loading branches".
  Two fixes: all git calls now run via `execFile` with argument arrays (no
  shell), which roughly halves the process count, speeds each spawn, suppresses
  the console window flashes, and removes the fragile `--format='...'` quoting
  that differed between cmd.exe and POSIX shells; and the per-branch line diff
  now runs only for branches that are actually ahead of their base (a merged or
  in-sync branch's diff is always empty), so a repo full of merged branches no
  longer runs a tree diff per branch.
- **Source Control scope button now works on Windows** - the button matched
  worktree paths by exact string, but git reports an uppercase drive letter
  ("C:\\repo") while VS Code reports it lowercased ("c:\\repo"), so the paths
  never compared equal. The button now neither failed to highlight nor failed to
  reduce Source Control to the single worktree. Paths are now canonicalized
  (drive letter lowercased) so scoping applies and the active button highlights.
- **Switching tabs no longer reloads the panel** - the worktree view now retains
  its state while hidden, so leaving for Source Control (or any other view) and
  coming back no longer tears down and rebuilds the panel, which had made the
  list flash and reload, most visibly on Windows.

## 2.7.1

- **Clicking an agent from another window no longer does nothing** - the agent
  list is shared across every VS Code window, but a terminal can only be revealed
  by the window that started it. Clicking an agent whose terminal lives in another
  window (or was started outside the extension) now shows a short message saying
  so, instead of silently failing. Revealing an agent from the window that owns it
  is unchanged.

## 2.7.0

- **Branches view refreshes GitHub on open** - opening the tab paints your local
  branches instantly, then automatically re-polls PR and CI status in the
  background, with the **Refresh GitHub** button spinning until it lands. The git
  Fetch stays a manual action, so opening the view never runs a git fetch.
- **Branches button no longer hangs with a spinner** - the sidebar **Branches**
  button just opens the view now (it makes no calls), so it no longer spins until
  a timeout while the editor tab loads.

## 2.6.0

- **Branches view no longer calls GitHub on open** - opening the tab reads your
  local branches instantly and never hits the GitHub API. PR and CI status is
  fetched only when you click **Refresh GitHub**; every other action (open, git
  Fetch, background refreshes, creating a worktree) reuses the cached data.
- **Last refreshed time** - a **Last refreshed** label sits under the Refresh
  GitHub button, reading **Never** until your first refresh and then the time of
  the most recent one, so it is clear when the PR view was last updated.
- **Header layout tidy-up** - the **Prune** checkbox now sits under **Fetch** and
  the Last refreshed time under Refresh GitHub, and the open-PR filter chip reads
  **Open PRs**.
- **Active and waiting agent dots pulse** - the green (active) and yellow
  (waiting) status dots now visibly pulse in the agent rows and the Agents bar,
  so in-progress and needs-attention agents read at a glance.

## 2.5.0

- **Default branch is never deletable** - the repo's default branch (from
  origin/HEAD) shows no Delete action and is refused server-side, so main/master
  cannot be removed by accident.
- **Branch delete is local-only** - the row action is now **Delete Local** and
  only branches that exist on your machine show it; it removes the local branch
  and never touches the branch on the remote. Remote-only branches show no delete.
- **Delete is worktree-aware** - deleting a branch checked out in your main window
  is blocked (switch away first); one checked out in another worktree is allowed
  after a confirm, which leaves that worktree on a detached snapshot (files intact)
  before removing the branch.
- **Delete gone branches in one click** - a header **Delete gone** button deletes
  every local branch whose upstream is gone (merged or deleted on the remote). It
  skips the default branch and any branch checked out in a worktree, confirms once,
  and force-deletes squash-merged leftovers only after a second confirm that names
  them. Pair it with Prune so a just-deleted remote branch is recognized.
- **Remove a worktree, drop its branch too** - removing a worktree now offers to
  delete the branch it was on (never the default), with an extra confirmation when
  that would lose unpushed or uncommitted work.
- **Refresh GitHub, separate from Fetch** - PR and CI status has its own **Refresh
  GitHub** button (shown when a token is stored) that re-queries the API without a
  git fetch, so you can refresh the PR view and your local branch state
  independently.
- **Buttons show progress** - actions that do real work (start agent, create
  worktree, open window, fetch, refresh) swap their icon for a spinner while they
  run, and in-progress CI checks and active agents pulse so they read at a glance.
- **No more delete flicker** - deleting a branch no longer briefly re-adds it
  before removing it again; a stale background refresh can no longer clobber the
  fresh list.

## 2.4.0

- **Branches view filter bar reworked, nothing selected by default** - the
  **Mine + to review** scope and the **Your PRs** / **Awaiting your review** /
  **Assigned to you** preset chips are gone. The view now lists every branch
  until you pick a filter.
- **Author select** - a multi-select populated from the authors found across the
  fetched PRs (you pinned to the top), to narrow the list to one or more authors.
- **Reviews select** - a single-select of the GitHub review statuses (No reviews,
  Review required, Approved, Changes requested, Reviewed by you, Not reviewed by
  you, Awaiting review from you); pick **Any** to clear it.
- **Open PR and Auto merge chips** - toggle chips to show only branches whose PR
  is open, or whose PR has auto-merge enabled.

## 2.3.0

- **Branches view defaults to your branches** - a new **Mine + to review** scope
  (on by default) narrows the Branches view to branches you created (any local
  branch, or a remote-only branch whose PR you authored) plus any whose review
  involved you (review was requested from you at some point, or you already
  reviewed it). Clear the chip to see every branch again. Without the GitHub
  integration connected it falls back to your local branches. The choice persists
  across reopens like the other filters.
- **Delete local branches** - the **Delete** action now appears on any local
  branch, not just branches whose PR you authored (a local branch is yours by
  virtue of living on this machine). Remote-only branches still require that you
  authored their PR.
- **Unpushed-work warning on delete** - deleting a local branch with commits not
  on its upstream (or, with no upstream, not on the default branch) now shows the
  count in the confirm dialog and force-deletes on confirm, so nothing is lost
  silently.
- **Merged branches delete without the scary prompt** - when a branch's PR is
  merged, deleting it no longer hits git's "not fully merged" refusal (a
  squash-merge leaves the commits unreachable even though the work is in the
  base); it force-deletes after the normal confirm.
- **Commit and diff summary on each branch row** - rows now show ahead/behind
  (↑/↓) and the +/- line diff against the branch's compare base (its upstream, or
  the default branch when it has none), mirroring the worktree cards.
- **Explicit Fetch button with a Prune toggle** - the Branches header has a
  **Fetch** button and a **Prune** checkbox (on by default). Fetching refreshes
  ahead/behind, diffs and PR merge state; with Prune on it also drops tracking
  refs for branches deleted on the remote.

## 2.2.1

- **Branches view prunes deleted remote branches** - fetches now run with
  `--prune`, and opening the Branches view fetches and prunes automatically, so
  branches deleted on the remote stop showing as **remote only** / **local +
  remote**. The refresh button does the same on demand.
- **Deleting a branch tolerates an already-deleted remote** - removing a branch
  whose remote was already gone no longer errors with "remote ref does not
  exist"; the stale remote-tracking ref is pruned instead.
- **"Show only this worktree" in Source Control now reliably switches** - scoping
  closes the other open repositories so the Source Control view shows just the
  selected worktree, even when more than one repo was open, and closes them via a
  more reliable call so the view actually changes (not only the button
  highlight).

## 2.2.0

- **Delete branches you authored** - branches whose pull request you authored
  now show a **Delete** action in the Branches view. When the branch exists both
  locally and on the remote you choose what to remove (local, remote, or both);
  otherwise it deletes whichever side exists after a single confirm. An unmerged
  local branch prompts before force-deleting so nothing is lost by accident.
  Deletion is offered only for branches you authored, since git records no branch
  owner and PR authorship is what identifies yours.
- **Jump to GitHub from a branch** - each branch name links to that branch on
  GitHub, and a **Branches on GitHub** link in the header opens the repository's
  full branches page.
- **Refresh button** - the Branches view header has a refresh control that
  fetches the latest remote branches, ahead/behind counts, and PR status.
- **Paged branch list** - long branch lists are paginated (25 per page) so they
  stay easy to scan.
- **Steadier Branches view** - the view only rebuilds when its data actually
  changed and now preserves your scroll position, so a background refresh no
  longer jumps you back to the top.
- **Fix: phantom "origin" branch** - the remote default-branch alias
  (`origin/HEAD`) was being listed as a branch named `origin`; it is now filtered
  out.

## 2.1.0

- **Merge-readiness pills on the PR view** - the PR summary now flags two
  states beside the header badge: **Out of date** when the branch is behind its
  base branch (GitHub's "This branch is out-of-date with the base branch") and
  **Auto-merge** when auto-merge is enabled, so a green-but-unmerged PR is no
  longer ambiguous.

## 2.0.0

- **Branches view** - a new full-screen editor tab, opened from the panel
  toolbar, lists every branch in the repository: your local branches plus
  branches that exist only on `origin`. Each row is tagged by where it lives -
  **local only**, **local + remote**, or **remote only** - and, when it tracks a
  remote, shows how far ahead or behind upstream it is (up to push, down to
  pull).
- **Per-branch PR status, filtered and sorted** - when GitHub is connected, each
  branch row shows its PR (open, merged or closed) with the same state, checks,
  reviews and comments rollup as the worktree cards, fetched in one batched
  GraphQL query. A filter and sort bar slices the list client-side: filter by
  author or review state, sort by recency or comment count, and one-click preset
  chips for **Your PRs**, **Awaiting your review**, and **Assigned to you**.
- **Create a worktree or start an agent from any branch** - a branch with no
  worktree gets a **Create worktree & start agent** action (remote-only branches
  are checked out as a new local tracking branch); a branch that already has a
  worktree shows a **Worktree exists** marker plus a **Start agent** action that
  launches a Claude agent in that worktree.

## 1.2.0

- **Terminal tab icon is legible on dark themes** - agent terminal tabs now use
  a theme-specific glyph (light on dark themes, dark on light) instead of a
  single `currentColor` SVG that rendered black and vanished on dark backgrounds.
- **Refreshed panel contrast** - the New Agent button moves to its own
  right-aligned row and uses the Agent Worktrees glyph instead of a generic
  sparkle, with assorted contrast/readability tweaks across the panel.
- **Agents are named by their work summary** - rows and terminals follow
  Claude's generated session title; the per-row manual rename button was removed.
- **Docs** - dropped the standalone "New Worktree" action from the README (the
  panel creates worktrees through the New Agent & Worktree flow).

## 1.1.0

- **PR status reads as two labeled rows** - the PR summary now shows a header
  (state + link), a **Reviews** row, and a **Checks** row, so CI checks and
  review decisions no longer read as one ambiguous run of checkmarks. Reviews
  shows approvals (green), changes requested (red, with count), reviewers still
  pending (gray), and comments; Checks shows passing / failing / running.
- **Accurate, faster CI updates after a push** - a PR whose commit has no legacy
  commit statuses no longer shows a phantom pending check, and when a push lands
  the panel polls quickly for a short window so the fresh pending checks appear
  in seconds instead of up to a minute.
- **Source Control scope shows its state** - the per-worktree scope button
  highlights the worktree whose repository is currently shown in Source Control,
  and that state now populates on window load, not only after a manual refresh.
- **Quieter agent rows** - dropped the elapsed-time / status text from each agent
  row; the status dot color already conveys active / waiting / idle.

## 1.0.0

- **Source Control scoping per worktree** - an opt-in button on each worktree
  (Settings -> Integrations) scopes the built-in Source Control view to that
  worktree. With one repository open it swaps the view to the selected worktree;
  with several open it leaves the others. The button highlights the worktree
  whose repository is currently shown, so you can tell at a glance which scope is
  set. It no longer switches you to the Source Control view.
- **Real agent summaries** - the agent row and its terminal now show Claude's
  own generated session title (read from the transcript) instead of your last
  prompt, falling back to the prompt only until a title exists.
- **Snappier summary tooltip** - hovering an agent summary shows the full text
  after 200ms via a themed tooltip, instead of the slow native one.
- **Terminal icon matches the extension** - agent terminals use the Agent
  Worktrees glyph instead of the generic sparkle.
- **Accurate CI rollup** - a PR whose commit has no legacy commit statuses no
  longer shows a phantom pending check. The "Commit statuses" PAT permission is
  now optional, and a token missing an optional permission stops being retried
  for the life of the token.
- **Predictable ordering** - worktrees are sorted with the primary pinned to the
  top and the rest by name (attention-based reordering was removed).

## 0.3.0

- **Cheaper GitHub polling with conditional requests** - PR status fetches now
  send `If-None-Match` with the ETag from the previous response. GitHub answers
  unchanged resources with a `304 Not Modified` that does not count against the
  API rate limit, so the adaptive poll stays well within limits even while CI is
  running and it polls every 15 seconds. Stored ETags are cleared whenever the
  token changes.

## 0.2.0

- **Settings is now a full page** - the gear opens a full-window settings view
  with a vertical tab rail (GitHub for now) and a Close button, instead of a
  modal overlay. "Show PR status on worktrees" is a sliding toggle.
- **CI checks on the PR row** - the PR line shows a counted segment per check
  state (passing, failing, running) with "N of M" tooltips, instead of a single
  countless glyph. The open-on-GitHub affordance uses an external-link icon.
- **Refresh is now a full sync** - the refresh action runs a `git fetch` so the
  behind ("commits to pull") count is accurate, and forces a fresh GitHub PR/CI
  fetch instead of reading the cache. Background refreshes stay lightweight.
- **Clearer git status line** - always shows the diff totals (a gray `+/- 0`
  when clean, `+N` / `-N` when changed) and up/down arrows for commits to push
  and pull.
- **Readability pass** - bumped the smallest text up a step and raised contrast
  on the git line, PR line, agent meta, Agents bar, and badges. PR state badges
  use saturated fills so their text stays legible.
- **Tidier toolbar** - the Agent & Worktree button uses the extension's icon;
  the redundant in-panel refresh and the "New Worktree" title-bar button were
  removed (the New Worktree command is still in the Command Palette).
- The full agent summary now shows on hover of the agent label itself (the
  separate info icon was removed).

## 0.1.0

- **GitHub PR status per worktree** — an optional integration shows each
  worktree branch's open PR right on its card: state and number, CI check
  rollup, review decision, and comment count, with the row linking out to the
  PR. It is fully opt-in and gated on a personal access token you provide (no
  token means no GitHub calls at all), and any GitHub error degrades quietly
  without affecting the worktree or agent display.
- **Settings modal** — a new gear in the panel title bar opens a settings modal
  that manages the GitHub connection: paste a token (kept in VS Code Secret
  Storage), toggle PR status on or off, and use the pre-filled links to create a
  fine-grained or classic token with exactly the read-only permissions needed.
- PR status refreshes on an adaptive timer and is nudged by Claude Code hook
  activity, so a PR an agent opens with `gh pr create` surfaces quickly.

## 0.0.3

- **Full summary on hover** — agent rows now show an info icon after the name;
  hover it to read the complete work summary when the row text is truncated.
- **Session data moved out of `~/.claude`** — the emitter and its per-session
  state files now live in the extension's global storage instead of
  `~/.claude/agent-worktrees/`. Installed hooks migrate automatically on the
  next launch, and the old directory is cleaned up.

## 0.0.2

- **Open in new window** — each worktree card has a button to open that worktree
  in its own VS Code window. When a window for the worktree is already open, it
  is focused instead of duplicated (focus behavior uses the `code` CLI when it is
  on `PATH`; otherwise a new window is always opened).

## 0.0.1

Initial release.

- **Worktrees panel** listing every worktree (primary + linked) with branch name
  and `Primary` / `detached` / `locked` badges.
- **Per-worktree git status** — changed-file count, `+`/`−` line totals, and
  ahead/behind from the upstream branch, refreshed as files change.
- **Agent** — start one or more Claude CLI sessions in a worktree, each in its
  own terminal; reveal, rename, or stop them from the panel.
- **Agent & Worktree** — create a worktree with `claude -w` and start an agent in
  it in one step.
- **New Worktree** / **Delete Worktree** — `git worktree add` / `remove`
  (with a force option, and stopping any agents in the worktree first).
- **Live agent status from Claude Code hooks** — agents show as active, waiting,
  or idle; consent-gated, with status flowing through local state files only.
- **Attention routing** — worktrees with a waiting or active agent float to the
  top of the list.
- **Skills used** — each agent row shows the count of Claude skills it invoked,
  with a click-through list.
</content>
