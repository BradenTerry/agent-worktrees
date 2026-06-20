# Changelog

All notable changes to the Agent Worktrees extension are documented here.

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
