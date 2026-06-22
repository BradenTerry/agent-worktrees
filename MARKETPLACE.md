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
- **PR status at a glance** — when a worktree's branch has a pull request, the
  card shows its title, state, CI checks, reviews and comments, plus an **Out of
  date** pill when the branch is behind its base branch and an **Auto-merge**
  pill when auto-merge is enabled.
- **Start agents in a click** — launch a Claude CLI session in any worktree, each
  in its own terminal. Reveal or stop it from the panel. Reveal works in the
  window that started the agent; another window can still see and stop it, and
  now tells you when its terminal lives elsewhere instead of doing nothing.
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
  option) without leaving the panel, then optionally delete its leftover branch
  in the same step, with an extra confirmation when that would lose unpushed or
  uncommitted work.
- **Branches view** — a full-screen editor tab listing every branch in the repo,
  with each branch's open PR status and a one-click way to spin up a worktree and
  agent for any branch that does not have one yet.
- **Buttons that show their work** — actions that take a moment (starting an
  agent, creating a worktree, opening a window, fetching, refreshing GitHub) show
  a spinner in place of their icon while they run, so you can see the click
  landed instead of wondering if anything happened.

## Branches view

A **Branches** button in the panel toolbar opens a dedicated editor tab listing
every branch in the repository — your local branches plus branches that exist
only on `origin`. Each row is tagged by where it lives — **local only**, **local
+ remote**, or **remote only** — and shows how far ahead or behind its compare
base it is (↑ to push, ↓ to pull) along with the **+/- line diff** that branch
introduces, the same summary the worktree cards show. The base is the branch's
upstream, or the repo's default branch when it has no upstream. Each row also
tells you whether a worktree already exists for that branch:
the ones that do show a **Worktree exists** marker alongside a **Start agent**
button that launches a Claude agent in that existing worktree, and the ones that
don't get a **Create worktree & start agent** button that builds the worktree
right there in your current window and starts a Claude agent in it. Picking a
remote-only branch checks it out as a new local tracking branch.

When the GitHub integration is connected, each branch row can also show its open
PR's status — the same title, state badge, CI checks, review and comment summary
you see on the worktree cards. The branch list paints instantly from local git,
then PR status loads in the background: opening the view starts a **Refresh
GitHub** of PR/CI status on its own (the button spins until it lands, and the
**Last refreshed** label fills in with the time). You can re-run it anytime from
that button (see below). A filter and
sort bar across the top lets you slice the
list without any extra loading. Nothing is filtered by default — every branch is
listed until you make a selection:

- **Author** — a select list of the authors found across the repo's PRs (pick one
  or more; you are pinned to the top of the list).
- **Reviews** — a select list of the review statuses: No reviews, Review required,
  Approved, Changes requested, Reviewed by you, Not reviewed by you, or Awaiting
  review from you. Pick one to filter; choose **Any** to clear it.
- **Sort** — Newest, Oldest, Most or Least commented, Recently or Least recently
  updated.
- **Open PRs** / **Auto merge** — toggle chips to show only branches whose PR is
  open, or whose PR has auto-merge enabled.

While a PR filter or sort is active, branches with no open PR are hidden. Without
the GitHub integration connected, the author/reviews selects and PR sorts are
hidden, and the view simply lists every branch so you can create worktrees as
usual. Your filter and sort choices are remembered the next time you open the
view. Close it like any editor tab; the Branches button reopens it.

**Fetch and prune.** A **Fetch** button in the header pulls from the remote to
refresh local branch state — ahead/behind counts and line diffs — so the view
reflects what actually landed. A **Prune** checkbox next to it (on by default)
also removes tracking refs for branches deleted on the remote, so merged-and-
deleted branches stop lingering as **remote only** rows.

**Refresh GitHub.** When you have connected a GitHub token, a **Refresh GitHub**
button appears in the header beside a **Last refreshed** label. The view refreshes
PR and CI status automatically when it opens, and this button re-queries on demand
afterwards. The label reads **Never** only until that first on-open refresh lands,
then shows the time of the most recent one. The GitHub refresh runs without a git
fetch — so you can refresh just the PR view, or just your local branch state,
independently.

**Delete branches.** Every branch that exists on your machine shows a **Delete
Local** button that removes the local branch only. The branch on the remote is
left untouched, so there is nothing to undo on GitHub. (Remote-only branches have
no local copy, so they show no button.) The repository's default branch (such as
`main`) is never deletable, so it shows no Delete button. If the branch has
commits that were never pushed, the confirm tells you how many would be lost. A
branch whose PR was merged deletes cleanly without a false "not fully merged"
warning, even after a squash-merge where git would otherwise refuse.

If the branch is currently checked out in your main window, deleting it is blocked
(switch to another branch first). If it is checked out in one of your other
worktrees, you can still delete it: the panel warns you, frees that worktree (it
is left on a detached snapshot, with its files intact), and then removes the
branch.

**Clean up merged branches in one click.** A header **Delete gone** button removes
every local branch whose upstream branch is gone: the ones whose remote branch
was merged and deleted (so they are just clutter now). It lists them and asks once
before deleting, leaves anything checked out in a worktree alone, and asks a second
time before force-deleting any branch that still has unmerged commits. Pair it with
**Prune** so a branch deleted on the remote moments ago is recognized.

**Jump to GitHub.** Each branch name links straight to that branch on GitHub, and
a **Branches on GitHub** link in the header opens the repository's full branches
page.

**Stay current.** Opening the view reads your local branches right away without
calling GitHub; the Fetch button pulls from the remote on demand, updating
ahead/behind counts and pruning branches deleted there so phantom remote
branches don't linger, while Refresh GitHub updates PR and CI status. Long
branch lists are paged so they stay easy to scan, and
the view only fetches branches for the repository you have open, never your other
repositories.

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

Agent Worktrees runs on your machine and collects no telemetry. It reads local
git state and Claude Code hook output from files in the extension's own private
storage (nothing of the extension's lives in your `~/.claude` tree apart from the
hook entries it adds to `settings.json` once you consent). The only network
requests it makes are to the GitHub API, and only when you connect a GitHub token
to show pull request and CI status; with no token connected, it makes no network
requests.
</content>
