# Changelog

All notable changes to the Agent Worktrees extension are documented here.

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
