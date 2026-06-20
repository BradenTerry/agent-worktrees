# Agent Worktrees

**Run and monitor multiple Claude Code agents across your git worktrees, from one side panel.**

Worktrees are the natural unit for running agents in parallel: each gets an
isolated checkout, so sessions never step on each other's files. Agent Worktrees
puts every worktree, its git state, and its running Claude agents in a single
view.

## Screenshots

<sub>Click any thumbnail to view it full size.</sub>

| Worktrees, git status & agents | PR checks, review & comments | Settings & integrations | Skills used per agent |
| :---: | :---: | :---: | :---: |
| [<img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/overview.png" alt="Worktrees, git status, PRs and agents in the panel" width="240">](https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/overview.png) | [<img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/pr-status.png" alt="CI checks and review status on a worktree's PR" width="240">](https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/pr-status.png) | [<img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/settings.png" alt="GitHub PR status and integration settings" width="240">](https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/settings.png) | [<img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/skills.png" alt="The skills modal listing the Claude skills an agent has used" width="240">](https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/skills.png) |

The **Branches view** opens as a full editor tab listing every branch with its PR status, filters, and one-click worktree creation:

[<img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/branches.png" alt="The Branches editor tab listing every branch with PR status, author/reviews/sort filters, and create-worktree actions" width="720">](https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/branches.png)

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
- **Subagents used** — a robot count shows how many subagents each agent has
  spawned, plus the total across the worktree.
- **Delete worktrees** — remove a worktree (`git worktree remove`, with a force
  option) without leaving the panel.
- **Branches view** — a full-screen editor tab listing every branch in the repo,
  with each branch's open PR status and a one-click way to spin up a worktree and
  agent for any branch that does not have one yet.

## Branches view

A **Branches** button in the panel toolbar opens a dedicated editor tab listing
every branch in the repository — your local branches plus branches that exist
only on `origin`. Each row is tagged by where it lives — **local only**, **local
+ remote**, or **remote only** — and, when it tracks a remote, shows how far
ahead or behind upstream it is (↑ to push, ↓ to pull). Each row also tells you
whether a worktree already exists for that branch:
the ones that do show a **Worktree exists** marker alongside a **Start agent**
button that launches a Claude agent in that existing worktree, and the ones that
don't get a **Create worktree & start agent** button that builds the worktree
right there in your current window and starts a Claude agent in it. Picking a
remote-only branch checks it out as a new local tracking branch.

When the GitHub integration is connected, each branch row also shows its open
PR's status — the same state badge, CI checks, review and comment summary you see
on the worktree cards. A filter and sort bar across the top lets you slice the
list without any extra loading:

- **Author** (multi-select) — narrow to PRs by one or more authors; you are
  pinned to the top of the list.
- **Reviews** — No reviews, Review required, Approved, Changes requested,
  Reviewed by you, Not reviewed by you, or Awaiting review from you.
- **Sort** — Newest, Oldest, Most or Least commented, Recently or Least recently
  updated.
- **Preset chips** — one click for **Your PRs**, **Awaiting your review**, or
  **Assigned to you**.

While a PR filter or sort is active, branches with no open PR are hidden. Without
the GitHub integration connected, the view still lists every branch and lets you
create worktrees; only the branch-name sort is offered and the PR-based controls
are hidden. Your filter and sort choices are remembered the next time you open
the view. Close it like any editor tab; the Branches button reopens it.

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
