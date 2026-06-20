# Changelog

All notable changes to the Agent Worktrees extension are documented here.

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
