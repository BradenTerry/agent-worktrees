# Agent Worktrees

**Run and monitor multiple Claude Code agents across your git worktrees, from one side panel.**

Worktrees are the natural unit for running agents in parallel: each gets an
isolated checkout, so sessions never step on each other's files. Agent Worktrees
puts every worktree, its git state, and its running Claude agents in a single
view.

## Screenshots

<sub>Click any thumbnail to view it full size.</sub>

| Worktrees, git status & agents | PR checks, review & comments | Settings & integrations |
| :---: | :---: | :---: |
| [<img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/overview.png" alt="Worktrees, git status, PRs and agents in the panel" width="240">](https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/overview.png) | [<img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/pr-status.png" alt="CI checks and review status on a worktree's PR" width="240">](https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/pr-status.png) | [<img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/settings.png" alt="GitHub PR status and integration settings" width="240">](https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/settings.png) |

## Highlights

- **Every worktree at a glance** — primary and linked worktrees with branch
  names and `Primary` / `detached` / `locked` badges.
- **Live git status per worktree** — changed-file count, `+`/`−` line totals, and
  ahead/behind from upstream, updated as you work.
- **Start agents in a click** — launch a Claude CLI session in any worktree, each
  in its own terminal. Reveal or stop it from the panel.
- **Agent & Worktree in one step** — create a fresh worktree with `claude -w` and
  start an agent in it together.
- **Open in a new window** — open any worktree in its own VS Code window in a
  click; if one is already open for that worktree, it is focused instead of
  duplicated.
- **Live agent status** — each agent shows as **active**, **waiting**, or
  **idle**, driven by Claude Code hook events.
- **Skills used** — see which Claude skills each agent has invoked.
- **Delete worktrees** — remove a worktree (`git worktree remove`, with a force
  option) without leaving the panel.

## How agent status works

The panel can't tell on its own whether a Claude session is working, waiting, or
idle, so it uses Claude Code's hooks. With your **explicit consent**, it adds a
small emitter to `~/.claude/settings.json` that, on each hook event, writes a
local state file the extension watches. **Nothing is sent over the network** —
status flows entirely through local files, and you can remove the hooks anytime
by editing that settings file.

| Status      | When                                                        |
| ----------- | ----------------------------------------------------------- |
| **idle**    | session started, or finished responding and awaiting you    |
| **active**  | processing a prompt or running tools                        |
| **waiting** | needs you — a permission prompt or a question               |

## Requirements

- The [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) (`claude`)
  on your `PATH`.
- `git` and `node` on your `PATH`.
- A workspace whose first folder is inside a git repository.

## Getting started

1. Install the extension and open a folder that is a git repository.
2. Open the **Agent Worktrees** view from the Activity Bar.
3. Accept the hook prompt to enable live agent status (optional but recommended).
4. Click **Agent** on any worktree to start a Claude session, or **Agent &
   Worktree** to spin up a new worktree and an agent together.

## Privacy

Agent Worktrees runs entirely on your machine. It reads local git state and
Claude Code hook output from files under `~/.claude/agent-worktrees/`. It makes
no network requests and collects no telemetry.
</content>
