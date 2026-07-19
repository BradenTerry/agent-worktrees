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

The **Branches view** opens as a full editor tab listing every branch with when and by whom it was last updated, its open PR status, git-based filters, and one-click worktree creation:

[<img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/branches.png" alt="The Branches editor tab listing every branch with its last-updated time and author, open PR status, an Updated by / Sort filter bar, and create-worktree actions" width="720">](https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/branches.png)

## Highlights

- **Every worktree at a glance** — primary and linked worktrees with branch
  names and `Primary` / `detached` / `locked` badges.
- **Git status per worktree** — changed-file count, `+`/`−` line totals, and
  ahead/behind from upstream, refreshed on agent activity and window focus, plus a
  per-card refresh button to update one worktree's git (and PR/CI, when enabled)
  on demand.
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
- **Switch a worktree's branch** — an edit button beside the branch name lets you
  check out a different branch in that worktree, or create a new one, without
  leaving the panel.
- **Live agent status** — each agent shows as **active**, **waiting**, or
  **idle**, driven by Claude Code hook events.
- **A badge when an agent needs you** — the Activity Bar icon shows a count of
  the agents waiting on a permission prompt or question, so a blocked agent is
  visible even while the panel is hidden behind another view. An agent that is
  only waiting for its background subagents to finish stays **active**, not
  waiting, so the badge means you specifically.
- **Know who you're talking to** — the agent whose terminal is currently open is
  highlighted in the panel (and its worktree's Agents bar is marked when the
  card is collapsed), so switching between several worktrees never leaves you
  typing to the wrong agent.
- **Skills used** — see which Claude skills each agent has invoked.
- **Subagents used** — a robot count shows how many subagents each agent has
  spawned, plus the total across the worktree.
- **Delete worktrees** — remove a worktree without leaving the panel, in one
  confirmation. The dialog tells you upfront what the removal touches (running
  agents, uncommitted changes, unpushed commits on the branch) and lets you
  remove the worktree alone or remove it and delete its leftover branch in the
  same step. No chain of follow-up prompts.
- **Stale lock cleanup** — Claude locks the worktrees it creates while a session
  runs; if a session crashes or is killed, the leftover lock used to leave a
  `locked` badge on a worktree with no agents and block deleting it. The panel
  now clears these dead-session locks automatically (locks you placed yourself
  are never touched).
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
base it is (↑ to push, ↓ to pull). The base is the branch's
upstream, or the repo's default branch when it has no upstream. Each row also
tells you whether a worktree already exists for that branch:
the ones that do show a **Worktree exists** marker alongside a **Start agent**
button that launches a Claude agent in that existing worktree, and the ones that
don't get a **Create worktree & start agent** button that builds the worktree
right there in your current window and starts a Claude agent in it. Picking a
remote-only branch checks it out as a new local tracking branch.

Worktrees created here (and by the New Worktree command) live inside your repo
under `.claude/worktrees/` — the same place Claude Code's own `claude -w` puts
them — so they stay in one predictable spot instead of appearing next to your
project folder. Tip: if you don't want that folder showing up as untracked in
`git status`, add a `/.claude/worktrees/` line to `.git/info/exclude` (or your
`.gitignore`); the extension never edits those files for you.

This view is git-first. Each branch row shows when it was **last updated** (the
relative time of its latest commit) and **who** made that commit, and a filter and
sort bar across the top lets you slice the list — all from local git, with no
loading and no token required. Nothing is filtered by default — every branch is
listed until you make a selection:

- **Updated by** — pick one or more people (the committers of the listed branches)
  to show only the branches they last touched. You are pinned to the top of the
  list.
- **Location** — pick where a branch lives: **Local only**, **Local + remote**,
  or **Remote only** (multi-select, matching the tag on each row).
- **Sort** — Recently updated, Least recently updated, or Name (A–Z).
- **PR Status** — a single-select (shown only once a GitHub token is connected)
  that narrows the list by pull request state: **All** (no filter), **Open**, or
  **Draft**.
- **Reviewer** — a single-select (shown only once a GitHub token is connected)
  that narrows the list to branches whose PR has a review requested from you,
  i.e. the PRs you still have to review: **All** (no filter) or
  **Review requested**.
- **Clear Filters** — resets the author, Location, PR Status and Reviewer filters
  in one click; enabled only while a filter is active. (Sort is left as you set
  it.)

Your filter and sort choices are remembered the next time you open the view. Close
it like any editor tab; the Branches button reopens it.

When the GitHub integration is connected, a branch that has an **open** (or draft)
pull request also shows it inline — its title, state badge, author, assignees and
whether you are a requested reviewer — as a hint on the branch row. (The branches
view fetches your open PRs in one bulk call, which doesn't include CI-check or
review-approval detail; for the full checks-and-reviews rollup, see the PR on its
worktree card.) The branch list paints instantly from local git; PR status loads in
the background: opening the view starts a **Fetch Open PRs** of PR status on its own
(the button spins until it lands, and the **Last refreshed** label fills in with the
time), and you can re-run it anytime from that button (see below). Without a token
the view simply lists every branch, with no PR info. (A dedicated PR view may come
later.)

**Fetch and prune.** A **Fetch** button in the header pulls from the remote to
refresh local branch state — ahead/behind counts — so the view
reflects what actually landed. A **Prune** checkbox next to it (on by default)
also removes tracking refs for branches deleted on the remote, so merged-and-
deleted branches stop lingering as **remote only** rows.

**Fetch Open PRs.** When you have connected a GitHub token, a **Fetch Open PRs**
button appears in the header beside a **Last refreshed** label. The view refreshes
open PR and CI status automatically when it opens, and this button re-queries on
demand afterwards. The label reads **Never** only until that first on-open refresh
lands, then shows the time of the most recent one. The GitHub refresh runs without
a git fetch — so you can refresh just the PR view, or just your local branch state,
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
| **active**  | processing a prompt, running tools, or waiting on its own background subagents |
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

## Troubleshooting

If the panel or Branches view seems slow or empty, open the panel **Settings**
and switch to the **Debug** tab, then turn on **Debug tracing** (the "Agent
Worktrees: Toggle Debug Tracing" command does the same). With it on, every
external call - each git command and GitHub API request, with its duration and
result - is logged to the "Agent Worktrees" output channel. Use **Open log** on
the same tab to reveal it (or View: Output, then pick "Agent Worktrees"). That
shows you exactly what is being run and what is slow or failing. It is off by
default, and request headers (which carry your GitHub token) are never logged.

## Privacy

Agent Worktrees runs on your machine and collects no telemetry. It reads local
git state and Claude Code hook output from files in the extension's own private
storage (nothing of the extension's lives in your `~/.claude` tree apart from the
hook entries it adds to `settings.json` once you consent). The only network
requests it makes are to the GitHub API, and only when you connect a GitHub token
to show pull request and CI status; with no token connected, it makes no network
requests.
</content>
