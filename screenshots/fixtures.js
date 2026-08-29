// Shared fixtures for the marketplace screenshot suite.
//
// These render the REAL webview UI (media/panel.js + media/panel.css) in a
// browser page, driving it through the same postMessage path the extension
// uses. No VS Code extension host is launched: panel.js only needs a stubbed
// `acquireVsCodeApi`, a `#root`, and an "update" message. Keeping the data here
// fake but realistic means the committed screenshots always match the current
// UI when the suite is re-run.

const path = require("path");

const MEDIA_DIR = path.join(__dirname, "..", "media");
const PANEL_CSS = path.join(MEDIA_DIR, "panel.css");
const PANEL_JS = path.join(MEDIA_DIR, "panel.js");
const OUT_DIR = path.join(__dirname, "..", "images");

// VS Code Dark+ theme tokens. panel.css reads everything through --vscode-*
// variables, so we approximate the default dark theme for a faithful render.
const THEME_DARK = `
  --vscode-font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
  --vscode-font-size: 13px;
  --vscode-editor-font-family: "SF Mono", Menlo, Consolas, monospace;
  --vscode-foreground: #cccccc;
  --vscode-descriptionForeground: #9d9d9d;
  --vscode-focusBorder: #007fd4;
  --vscode-panel-border: rgba(255,255,255,0.12);
  --vscode-widget-border: rgba(255,255,255,0.10);
  --vscode-editorWidget-background: #252526;
  --vscode-editor-background: #1e1e1e;
  --vscode-textCodeBlock-background: rgba(255,255,255,0.07);
  --vscode-button-background: #0e639c;
  --vscode-button-foreground: #ffffff;
  --vscode-button-hoverBackground: #1177bb;
  --vscode-button-secondaryBackground: rgba(255,255,255,0.10);
  --vscode-button-secondaryHoverBackground: rgba(255,255,255,0.18);
  --vscode-badge-background: #4d4d4d;
  --vscode-badge-foreground: #ffffff;
  --vscode-toolbar-hoverBackground: rgba(255,255,255,0.12);
  --vscode-list-hoverBackground: rgba(255,255,255,0.055);
  --vscode-list-activeSelectionBackground: #094771;
  --vscode-list-activeSelectionForeground: #ffffff;
  --vscode-charts-green: #89d185;
  --vscode-charts-yellow: #cca700;
  --vscode-charts-red: #f14c4c;
  --vscode-charts-blue: #3794ff;
  --vscode-charts-purple: #b180d7;
  --vscode-input-background: #3c3c3c;
  --vscode-input-foreground: #cccccc;
  --vscode-input-border: #3c3c3c;
  --vscode-checkbox-border: #6b6b6b;
  --vscode-textLink-foreground: #3794ff;
  --vscode-inputValidation-warningBackground: #5c4500;
  --vscode-inputValidation-warningForeground: #cccccc;
`;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
// Timestamps are relative to "now" so the rendered labels ("5m", "1h") stay
// stable across runs regardless of when the suite executes.
const ago = (ms) => Date.now() - ms;

const REPO = "/Users/dev/acme-web";

/** Realistic worktree + agent + PR data exercising most of the UI. */
function overviewData() {
  return {
    repoRoot: REPO,
    repoName: "acme-web",
    // A github.com origin, which is what puts the GitHub link for a branch on
    // each card. Set here so the listing images show the panel a user with a
    // GitHub remote actually gets.
    repoUrl: "https://github.com/acme/acme-web",
    hooksInstalled: true,
    prEnabled: true,
    // Every repo the panel can store settings for gets at least General, and it
    // is always drawn - so the listing images have to carry it, or they show a
    // panel nobody actually gets.
    groups: [{ id: "general", name: "General" }],
    // The Source Control scope button defaults to on in the extension, so the
    // listing images must show it too; without this the screenshots advertise a
    // panel missing a button every user actually gets.
    scmEnabled: true,
    // The agents view's group order, as the extension always sends it: the
    // default, so the listing shows what a new install gets.
    agentStatusOrder: ["waiting", "active", "idle"],
    // The agent whose terminal is open, shown highlighted in the panel.
    activeSessionId: "s-co-2",
    github: { hasToken: true, connected: true, login: "acme-dev", tokenType: "fine-grained" },
    // Gitignored local config symlinked into every worktree the panel creates.
    // Populated so the Linked Files settings tab screenshots with a real list
    // rather than its empty state.
    linkedPaths: [
      ".env.local",
      "src/appsettings.Development.json",
      "certs",
    ],
    worktrees: [
      {
        path: REPO,
        name: "main",
        branch: "main",
        isPrimary: true,
        detached: false,
        locked: false,
        inWorkspace: true,
        // upstream set: the branch is pushed, so its GitHub entry is offered.
        git: { dirty: 0, insertions: 0, deletions: 0, ahead: 0, behind: 2, upstream: "origin/main" },
        // Has launch configurations, nothing running: the Debug button only.
        canDebug: true,
        agents: [
          {
            sessionId: "s-main-1",
            label: "Work the release backlog",
            summary: "Work the release backlog, one worktree per ticket",
            skills: ["code-review"],
            // Fanned out: this session gave each subagent a worktree of its own,
            // so their rows are on those cards and the count is what says the
            // session is busy.
            subagents: [
              {
                id: "sub-main-1a",
                type: "nocturne",
                task: "Cache the settings read",
                startedAt: ago(9 * MIN),
                worktree: REPO + "-perf-cache",
              },
            ],
            status: "active",
            startedAt: ago(2 * HOUR),
            lastActivity: ago(20 * 1000),
          },
        ],
        pr: null,
      },
      {
        path: REPO + "-checkout",
        name: "feat/checkout-redesign",
        branch: "feat/checkout-redesign",
        isPrimary: false,
        detached: false,
        locked: false,
        inWorkspace: false,
        // Source Control is currently scoped here, so this card's scope pill
        // renders filled while the others show the inactive state.
        scmActive: true,
        git: {
          dirty: 4,
          insertions: 212,
          deletions: 38,
          ahead: 3,
          behind: 0,
          upstream: "origin/feat/checkout-redesign",
        },
        // A debug session the panel started in this worktree, with the restart
        // and stop buttons that are the way back out of it.
        canDebug: true,
        debugSessions: [
          {
            id: "dbg-checkout-api",
            label: "Run API (feat/checkout-redesign)",
            noDebug: false,
          },
        ],
        agents: [
          {
            sessionId: "s-co-1",
            label: "Rework cart summary component",
            summary: "Rework the cart summary component and wire the new totals API",
            skills: ["task-spec", "source-generator"],
            subagents: [
              {
                id: "sub-co-1a",
                type: "Explore",
                task: "Map the totals API callers",
                // This agent's card is in the waiting state, and this is the
                // subagent holding the permission prompt behind it.
                awaitingPermission: true,
                startedAt: ago(4 * MIN),
              },
              {
                id: "sub-co-1b",
                type: "general-purpose",
                task: "Port the summary tests",
                // Stopped its turn, parked on a background command: still in
                // flight, so it stays listed without the working pulse.
                paused: true,
                startedAt: ago(50 * 1000),
              },
            ],
            status: "waiting",
            startedAt: ago(18 * MIN),
            lastActivity: ago(20 * 1000),
          },
          {
            sessionId: "s-co-2",
            label: "Add Playwright coverage",
            summary: "Add Playwright coverage for the checkout flow",
            skills: ["verify"],
            subagents: [
              {
                id: "sub-co-2a",
                type: "Explore",
                task: "Find existing checkout fixtures",
                startedAt: ago(2 * MIN),
              },
            ],
            status: "active",
            startedAt: ago(6 * MIN),
            lastActivity: ago(5 * 1000),
          },
        ],
        pr: {
          number: 482,
          title: "Checkout redesign",
          url: "https://github.com/acme/acme-web/pull/482",
          state: "open",
          checks: "pending",
          checksPass: 5,
          checksFail: 0,
          checksPending: 1,
          review: "approved",
          approvals: 2,
          changesRequested: 0,
          comments: 3,
          autoMerge: true,
        },
      },
      {
        path: REPO + "-login-fix",
        name: "fix/login-race",
        branch: "fix/login-race",
        isPrimary: false,
        detached: false,
        locked: false,
        inWorkspace: false,
        git: { dirty: 1, insertions: 9, deletions: 4, ahead: 1, behind: 0, upstream: "origin/fix/login-race" },
        // Started with "Run without debugging", so the row carries the chip that
        // says no debugger is attached.
        canDebug: true,
        debugSessions: [
          {
            id: "dbg-login-web",
            label: "Web (fix/login-race)",
            noDebug: true,
          },
        ],
        agents: [
          {
            sessionId: "s-lf-1",
            label: "Fix session token race",
            summary: "Fix the session token refresh race on concurrent requests",
            skills: [],
            status: "active",
            startedAt: ago(31 * MIN),
            lastActivity: ago(15 * 1000),
          },
        ],
        pr: {
          number: 479,
          title: "Fix login race",
          url: "https://github.com/acme/acme-web/pull/479",
          state: "open",
          checks: "fail",
          checksPass: 4,
          checksFail: 1,
          checksPending: 0,
          review: "changes",
          approvals: 0,
          changesRequested: 1,
          comments: 1,
          mergeState: "behind",
        },
      },
      // A worktree with no agent of its own: the session on main handed it to a
      // subagent, so the card shows that subagent's row (attributed back to the
      // agent running it) rather than an empty agent list.
      {
        path: REPO + "-perf-cache",
        name: "perf/settings-cache",
        branch: "perf/settings-cache",
        isPrimary: false,
        detached: false,
        locked: false,
        inWorkspace: false,
        // No upstream: never pushed, so this card's menu has no GitHub entry.
        git: { dirty: 2, insertions: 34, deletions: 6, ahead: 0, behind: 0 },
        agents: [],
        subagents: [
          {
            id: "sub-main-1a",
            type: "nocturne",
            task: "Cache the settings read",
            startedAt: ago(9 * MIN),
            worktree: REPO + "-perf-cache",
            parentSessionId: "s-main-1",
            parentLabel: "Work the release backlog",
            parentStatus: "active",
          },
        ],
        pr: null,
      },
    ],
  };
}

// ISO timestamp relative to now, for PR created/updated fields the branches
// view sorts by. Kept relative so "newest" ordering is stable across runs.
const iso = (ms) => new Date(ago(ms)).toISOString();

/**
 * Realistic branch data for the dedicated Branches editor tab. Exercises the
 * full UI: local + remote-only branches, branches with and without a worktree,
 * a no-PR branch, varied PR/CI/review states, multiple authors for the Author
 * filter, an "awaiting your review" PR, and an "assigned to you" PR. viewerLogin
 * matches overviewData's github.login so the "you" controls resolve.
 */
function branchesData() {
  const you = "acme-dev";
  return {
    repoRoot: REPO,
    repoName: "acme-web",
    repoUrl: "https://github.com/acme/acme-web",
    prEnabled: true,
    github: { hasToken: true, connected: true, login: you, tokenType: "fine-grained" },
    viewerLogin: you,
    // Stamp the "Last refreshed" label as a couple of minutes ago, so the
    // listing shows the populated PR view rather than the "Never" empty state.
    lastGithubRefresh: ago(2 * 60 * 1000),
    branches: [
      {
        name: "feat/search-filters",
        updatedAt: iso(22 * MIN),
        lastUser: "lin-h",
        remoteOnly: false,
        hasRemote: true,
        hasWorktree: false,
        ahead: 2,
        behind: 0,
        insertions: 142,
        deletions: 18,
        pr: {
          number: 486,
          title: "Faceted search filters",
          url: "https://github.com/acme/acme-web/pull/486",
          state: "open",
          checks: "pass",
          checksPass: 6,
          checksFail: 0,
          checksPending: 0,
          review: "required",
          approvals: 0,
          changesRequested: 0,
          reviewsPending: 1,
          comments: 2,
          author: "lin-h",
          assignees: [],
          reviewedByViewer: false,
          reviewRequestedFromViewer: true,
          createdAt: iso(2 * HOUR),
          updatedAt: iso(22 * MIN),
        },
      },
      {
        name: "feat/checkout-redesign",
        updatedAt: iso(30 * MIN),
        lastUser: "acme-dev",
        remoteOnly: false,
        hasRemote: true,
        hasWorktree: true,
        worktreePath: REPO + "-checkout",
        ahead: 3,
        behind: 0,
        insertions: 310,
        deletions: 96,
        pr: {
          number: 482,
          title: "Checkout redesign",
          url: "https://github.com/acme/acme-web/pull/482",
          state: "open",
          checks: "pending",
          checksPass: 5,
          checksFail: 0,
          checksPending: 1,
          review: "approved",
          approvals: 2,
          changesRequested: 0,
          reviewsPending: 0,
          comments: 3,
          author: you,
          assignees: [you],
          reviewedByViewer: false,
          reviewRequestedFromViewer: false,
          autoMerge: true,
          createdAt: iso(26 * HOUR),
          updatedAt: iso(30 * MIN),
        },
      },
      {
        name: "fix/login-race",
        updatedAt: iso(3 * HOUR),
        lastUser: "rivera",
        remoteOnly: false,
        hasRemote: true,
        hasWorktree: true,
        worktreePath: REPO + "-login-fix",
        ahead: 1,
        behind: 2,
        insertions: 24,
        deletions: 12,
        pr: {
          number: 479,
          title: "Fix login race",
          url: "https://github.com/acme/acme-web/pull/479",
          state: "open",
          checks: "fail",
          checksPass: 4,
          checksFail: 1,
          checksPending: 0,
          review: "changes",
          approvals: 0,
          changesRequested: 1,
          reviewsPending: 0,
          comments: 1,
          author: "rivera",
          assignees: [],
          reviewedByViewer: true,
          reviewRequestedFromViewer: false,
          createdAt: iso(2 * 24 * HOUR),
          updatedAt: iso(3 * HOUR),
        },
      },
      {
        name: "chore/deps-bump",
        updatedAt: iso(28 * HOUR),
        lastUser: "acme-dev",
        remoteOnly: false,
        hasRemote: false,
        hasWorktree: false,
        ahead: 4,
        behind: 0,
        insertions: 12,
        deletions: 12,
        pr: {
          number: 471,
          title: "Bump dependencies",
          url: "https://github.com/acme/acme-web/pull/471",
          state: "draft",
          checks: "pending",
          checksPass: 0,
          checksFail: 0,
          checksPending: 2,
          review: "none",
          approvals: 0,
          changesRequested: 0,
          reviewsPending: 0,
          comments: 0,
          author: you,
          assignees: [],
          reviewedByViewer: false,
          reviewRequestedFromViewer: false,
          createdAt: iso(3 * 24 * HOUR),
          updatedAt: iso(28 * HOUR),
        },
      },
      {
        name: "feat/analytics-events",
        updatedAt: iso(2 * 24 * HOUR),
        lastUser: "okafor",
        remoteOnly: true,
        hasRemote: true,
        hasWorktree: false,
        ahead: 5,
        behind: 1,
        insertions: 64,
        deletions: 5,
        pr: {
          number: 468,
          title: "Emit analytics events",
          url: "https://github.com/acme/acme-web/pull/468",
          state: "open",
          checks: "pass",
          checksPass: 8,
          checksFail: 0,
          checksPending: 0,
          review: "approved",
          approvals: 1,
          changesRequested: 0,
          reviewsPending: 0,
          comments: 5,
          author: "okafor",
          assignees: [],
          reviewedByViewer: true,
          reviewRequestedFromViewer: false,
          createdAt: iso(4 * 24 * HOUR),
          updatedAt: iso(2 * 24 * HOUR),
        },
      },
      {
        name: "main",
        updatedAt: iso(5 * HOUR),
        lastUser: "lin-h",
        remoteOnly: false,
        hasRemote: true,
        hasWorktree: true,
        worktreePath: REPO,
        ahead: 0,
        behind: 2,
        insertions: 0,
        deletions: 0,
        isDefault: true,
        pr: null,
      },
      {
        name: "fix/typo-readme",
        updatedAt: iso(4 * 24 * HOUR),
        lastUser: "okafor",
        remoteOnly: true,
        hasRemote: true,
        hasWorktree: false,
        ahead: 1,
        behind: 0,
        insertions: 1,
        deletions: 1,
        pr: null,
      },
    ],
  };
}

// Expand every worktree's agent list so the rows show in the screenshot.
function expandedPaths(data) {
  return (data.worktrees || []).map((w) => w.path);
}

/**
 * The overview, filed into the user's own groups. A separate fixture rather than
 * groups on `overviewData`, so the other listing images keep showing the panel a
 * user who has never made a group gets - which is the flat list, with no section
 * headers at all.
 */
function groupedData() {
  const data = overviewData();
  // General is the fixed default and is never renamed, so it is called what the
  // panel calls it. The primary worktree is not filed into anything: it sits
  // above the sections, under its own divider.
  data.groups = [...data.groups, { id: "g1", name: "In review" }];
  const wts = data.worktrees;
  if (wts[1]) wts[1].group = "g1";
  if (wts[2]) wts[2].group = "g1";
  // wts[3] carries no group, which is what being in General looks like.
  return data;
}

/**
 * Mount the real panel UI in `page` with the given data, then optionally send a
 * follow-up message (e.g. to open the settings view). Returns when rendered.
 */
async function mountPanel(page, { data, theme = THEME_DARK, width = 460, height = 900, message, view = "panel", state = {} }) {
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8">` +
      `<style>:root{${theme}} html,body{height:auto;} body{margin:0;background:var(--vscode-editor-background);} ` +
      // Let the panel flow to its full content height instead of an inner scroll
      // region, so a single screenshot captures everything.
      `#root{height:auto !important;} .cards{overflow:visible !important;}</style>` +
      `</head><body><div id="root"></div></body></html>`
  );
  await page.addScriptTag({
    content:
      // The branches editor tab is selected by this flag, which panel.js reads at
      // load time (mirrors the AWT_VIEW the extension injects into the tab HTML).
      `window.AWT_VIEW = ${JSON.stringify(view)};` +
      `window.__expanded = ${JSON.stringify(expandedPaths(data))};` +
      `window.__state = ${JSON.stringify({ ...state, expanded: expandedPaths(data) })};` +
      `window.acquireVsCodeApi = () => ({ getState: () => window.__state, setState: () => {}, postMessage: () => {} });`,
  });
  await page.addStyleTag({ path: PANEL_CSS });
  await page.addScriptTag({ path: PANEL_JS });
  // The branches tab consumes a {type:"branches"} payload; the sidebar an "update".
  const updateType = view === "branches" ? "branches" : "update";
  await page.evaluate(
    ([d, t]) => window.dispatchEvent(new MessageEvent("message", { data: { type: t, data: d } })),
    [data, updateType]
  );
  if (message) {
    await page.evaluate(
      (m) => window.dispatchEvent(new MessageEvent("message", { data: m })),
      message
    );
  }
  await page.waitForTimeout(150);
}

module.exports = {
  MEDIA_DIR,
  OUT_DIR,
  THEME_DARK,
  overviewData,
  groupedData,
  branchesData,
  mountPanel,
};
