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
    hooksInstalled: true,
    prEnabled: true,
    github: { hasToken: true, connected: true, login: "acme-dev", tokenType: "fine-grained" },
    worktrees: [
      {
        path: REPO,
        name: "main",
        branch: "main",
        isPrimary: true,
        detached: false,
        locked: false,
        inWorkspace: true,
        git: { dirty: 0, insertions: 0, deletions: 0, ahead: 0, behind: 2 },
        agents: [
          {
            sessionId: "s-main-1",
            label: "Triage flaky CI",
            summary: "Triage flaky CI",
            skills: ["code-review"],
            status: "idle",
            startedAt: ago(2 * HOUR),
            lastActivity: ago(40 * MIN),
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
        git: { dirty: 4, insertions: 212, deletions: 38, ahead: 3, behind: 0 },
        agents: [
          {
            sessionId: "s-co-1",
            label: "Rework cart summary component",
            summary: "Rework the cart summary component and wire the new totals API",
            skills: ["task-spec", "source-generator"],
            subagents: 3,
            status: "waiting",
            startedAt: ago(18 * MIN),
            lastActivity: ago(20 * 1000),
          },
          {
            sessionId: "s-co-2",
            label: "Add Playwright coverage",
            summary: "Add Playwright coverage for the checkout flow",
            skills: ["verify"],
            subagents: 1,
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
        git: { dirty: 1, insertions: 9, deletions: 4, ahead: 1, behind: 0 },
        agents: [
          {
            sessionId: "s-lf-1",
            label: "Fix session token race",
            summary: "Fix the session token refresh race on concurrent requests",
            skills: [],
            subagents: 2,
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
    branches: [
      {
        name: "feat/search-filters",
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
        remoteOnly: false,
        hasRemote: true,
        hasWorktree: true,
        worktreePath: REPO,
        ahead: 0,
        behind: 2,
        insertions: 0,
        deletions: 0,
        pr: null,
      },
      {
        name: "fix/typo-readme",
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
  branchesData,
  mountPanel,
};
