// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");

  // Which webview this is. The sidebar leaves it unset ("panel"); the dedicated
  // branches editor tab sets `window.AWT_VIEW = "branches"` in its HTML before
  // loading this script. The same panel.js + panel.css drive both surfaces; we
  // branch on VIEW so each ignores the other's messages and render path.
  const VIEW = window.AWT_VIEW || "panel";

  /** Inline codicon-ish SVGs so we stay dependency-free. */
  const icons = {
    add: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 3v10M3 8h10"/></svg>',
    remove:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 8h10"/></svg>',
    chevron:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 4l4 4-4 4"/></svg>',
    sparkle:
      '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l1.3 3.7L13 6l-3.7 1.3L8 11 6.7 7.3 3 6l3.7-1.3z"/></svg>',
    // The extension's field-agent character (fedora + visor head), no worktree
    // backdrop — monochrome so it inherits currentColor in both themes.
    agentMark:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.2V2.1"/><path d="M4.7 5.3c0-2.3 6.6-2.3 6.6 0"/><path d="M3 5.5h10"/><rect x="4.7" y="6.1" width="6.6" height="7.2" rx="2.1"/><path d="M6.1 9.4h3.8"/></svg>',
    agentWorktree:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><path d="M16 14.5c2.4 0 3 1.4 3 3.5" stroke-width="1.5"/><circle cx="20" cy="20" r="1.7" stroke-width="1.4"/><path d="M12 4.4V2.6" stroke-width="1.5"/><circle cx="12" cy="2.4" r="0.9" fill="currentColor"/><path d="M7.5 6.8c0-2.6 9-2.6 9 0" stroke-width="1.5"/><path d="M5 7.2h14" stroke-width="1.5"/><rect x="7" y="8.2" width="10" height="10.4" rx="3" stroke-width="1.5"/><path d="M9 12.4h6" stroke-width="2.2"/></svg>',
    focus:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M9 3h4v4M13 3l-5 5M7 13H3V9M3 13l5-5"/></svg>',
    stop: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    terminal:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M4.5 6l2.5 2-2.5 2M8.5 10.5H12"/></svg>',
    trash:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 4h10M6 4V3h4v1M5 4l.5 9h5L11 4"/></svg>',
    edit:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M10.5 2.5l3 3-7 7H3.5v-3z"/><path d="M9 4l3 3"/></svg>',
    refresh:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M13 8a5 5 0 1 1-1.5-3.5M13 3v2.5h-2.5"/></svg>',
    collapse:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M5 6l3-3 3 3M5 10l3 3 3-3"/></svg>',
    // Density toggle: the same list of rows, drawn tighter. Four evenly spaced
    // lines read as "a denser list" where a chevron or a minus would not.
    density:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2.5 3.5h11M2.5 6.5h11M2.5 9.5h11M2.5 12.5h11"/></svg>',
    window:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1.5" y="3" width="13" height="10" rx="1.2"/><path d="M1.5 6h13"/></svg>',
    // Find in Files, scoped to one worktree: VS Code's own magnifier shape so it
    // reads as "search" and not as a filter or a zoom control.
    search:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="6.8" cy="6.8" r="4.3"/><path d="M10 10l3.5 3.5"/></svg>',
    // Find file by name in one worktree: a document with a magnifier, pairing it
    // with the search icon above while reading as "a file, not its contents".
    fileSearch:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M9 1.8H4.2a1 1 0 0 0-1 1v10.4a1 1 0 0 0 1 1h3"/><path d="M9 1.8l3.3 3.3v2.4"/><circle cx="10.9" cy="10.9" r="2.6"/><path d="M12.8 12.8l1.7 1.7"/></svg>',
    skill:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 2l5 2.5L8 7 3 4.5 8 2zM3 8l5 2.5L13 8M3 11.5L8 14l5-2.5"/></svg>',
    // Run and Debug: VS Code's own play-with-bug shape, so the action reads as
    // "debug" rather than a generic play.
    debug:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M4 2.8l7 5.2-7 5.2z"/><circle cx="7.4" cy="8" r="1.5" fill="currentColor" stroke="none"/></svg>',
    // A running debug session, mirroring VS Code's debug-stop square.
    debugStop:
      '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="4" width="8" height="8" rx="1"/></svg>',
    // A running subagent: an elbow connector down from the parent row into a
    // node, so a subagent reads as belonging to the agent above it.
    subagent:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M4 2.5v5.5a2.5 2.5 0 0 0 2.5 2.5H8.7"/><circle cx="11.4" cy="10.5" r="1.9"/></svg>',
    gear: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5L3.4 3.4"/></svg>',
    pr: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="4" cy="3.5" r="1.6"/><circle cx="4" cy="12.5" r="1.6"/><circle cx="12" cy="12.5" r="1.6"/><path d="M4 5.1v5.8M12 11V7a2.5 2.5 0 0 0-2.5-2.5H7M9 2.5L7 4.5l2 2"/></svg>',
    branch:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="5" cy="3.5" r="1.5"/><circle cx="5" cy="12.5" r="1.5"/><circle cx="11" cy="5" r="1.5"/><path d="M5 5v6"/><path d="M11 6.5c0 3-3 2.7-6 2.7"/></svg>',
    check:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3.5 8.5l3 3 6-6.5"/></svg>',
    cross:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    dot: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="3.2"/></svg>',
    zap: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M9 1.5L3.5 9h4l-.5 5.5L12.5 7h-4z"/></svg>',
    comment:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>',
    // Requested-reviewer marker (review pending): an eye, GitHub's convention for
    // "review requested". Replaces a literal "@" that read as a broken glyph next
    // to the other SVG segment icons.
    eye: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.7"/></svg>',
    // GitHub's own mark, for a link out to github.com. Recognizable at 13px
    // where a generic external-link arrow only says "somewhere else".
    github:
      '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.06-.15-.36-.75.07-1.56 0 0 .67-.21 2.2.82a5.5 5.5 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.43.81.13 1.41.07 1.56.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>',
    external:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h4v4"/><path d="M13 3L7.5 8.5"/><path d="M11 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3"/></svg>',
    bug: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5.5" width="6" height="7" rx="3"/><path d="M6 4a2 2 0 0 1 4 0"/><path d="M5 8H2.5M11 8h2.5M5.2 5.7L3.5 4M10.8 5.7L12.5 4M5.2 11.5L3.5 13M10.8 11.5L12.5 13M8 6.5v5"/></svg>',
    link:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9.5l3-3"/><path d="M8.2 4.8l1-1a2.4 2.4 0 0 1 3.4 3.4l-1 1"/><path d="M7.8 11.2l-1 1a2.4 2.4 0 0 1-3.4-3.4l1-1"/></svg>',
    folderOpen:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12V4a1 1 0 0 1 1-1h3l1.4 1.6H12a1 1 0 0 1 1 1V7"/><path d="M2 12l2-4.6h10.5L12.4 12z"/></svg>',
    // A file with a strike through it: the "git ignores this" candidates list.
    ignored:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 1.8H4.2a1 1 0 0 0-1 1v10.4a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V5.6z"/><path d="M9 1.8v3.8h3.8"/><path d="M3.6 13.6L12.4 2.4"/></svg>',
    behind:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v7M5 6.5l3 3 3-3"/><path d="M3.5 13.5h9"/></svg>',
    autoMerge:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="3.5" r="1.5"/><circle cx="4" cy="12.5" r="1.5"/><circle cx="12" cy="6" r="1.5"/><path d="M4 5v6"/><path d="M11.7 7.4C11 10 7 9.5 4 9.5"/></svg>',
    // In-progress spinner: a faint full ring with a brighter arc that the .spin
    // CSS animation rotates. Swapped in for a button's own icon while its action
    // is running (see markBusy).
    spinner:
      '<svg class="spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="5.5" stroke-opacity="0.25"/><path d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5"/></svg>',
  };

  // Worktree paths whose agent list is expanded, persisted so re-renders keep
  // the toggle state. Cards start collapsed: the Agents bar shows the counts and
  // reveals the rows on click.
  const expanded = new Set((vscode.getState() || {}).expanded || []);

  // Branches-overlay filter/sort selections, persisted alongside `expanded` so
  // reopening the overlay restores the last view. This view is git-first: `users`
  // is a list of committer names (the people who last updated each branch,
  // multi-select); `locations` is a multi-select of where a branch lives (local
  // only / local + remote / remote only, LOCATION_OPTIONS ids); `sort` is one of
  // the SORT_OPTIONS keys (all git-based, no GitHub needed). `prStatus` and `reviewer` are the PR-aware filters: each a
  // single-select (only shown when GitHub PR data is available). `prStatus`
  // narrows by PR state — "all" (no filter), "open" (open, non-draft PR), or
  // "draft" (draft PR); the PR fetch is open-only, so open and draft are the
  // only states it can match. `reviewer` narrows to branches whose PR has a
  // review requested from the signed-in user — "all" (no filter) or "requested".
  const savedState = vscode.getState() || {};

  // How much space a worktree card gets. "comfortable" is the original layout,
  // one labelled block per subsystem. "compact" folds the header, git summary
  // and PR rollup into two tight lines and hides the per-worktree actions until
  // the card is expanded, so a panel with several worktrees fits on screen and
  // an agent row is never far from the name of the worktree it belongs to.
  // Persisted like the expand state, so the choice survives a reload.
  let density = savedState.density === "compact" ? "compact" : "comfortable";
  const isCompact = () => density === "compact";

  const branchFilters = {
    // Prune on fetch. On by default; persisted so the checkbox stays set.
    prune: savedState.branchPrune !== false,
    users: Array.isArray(savedState.branchUsers)
      ? savedState.branchUsers.slice()
      : [],
    // Location multi-select (local only / local + remote / remote only), empty
    // meaning no filter, mirroring `users`. Unknown persisted ids are dropped
    // so a stale selection can never hide every branch.
    locations: Array.isArray(savedState.branchLocations)
      ? savedState.branchLocations.filter((l) =>
          ["local", "both", "remote-only"].includes(l)
        )
      : [],
    sort:
      typeof savedState.branchSort === "string"
        ? savedState.branchSort
        : "recentlyUpdated",
    // "all" by default so the branch list is complete until the user narrows it.
    // Migrate the old boolean openPrsOnly toggle: true -> "open".
    prStatus:
      typeof savedState.branchPrStatus === "string"
        ? savedState.branchPrStatus
        : savedState.branchOpenPrsOnly === true
        ? "open"
        : "all",
    // "all" by default: no review-request filter until the user narrows it.
    reviewer:
      typeof savedState.branchReviewer === "string"
        ? savedState.branchReviewer
        : "all",
  };
  function persist() {
    vscode.setState({
      expanded: Array.from(expanded),
      density,
      branchPrune: branchFilters.prune,
      branchUsers: branchFilters.users.slice(),
      branchLocations: branchFilters.locations.slice(),
      branchSort: branchFilters.sort,
      branchPrStatus: branchFilters.prStatus,
      branchReviewer: branchFilters.reviewer,
    });
  }

  // Last data we rendered, so the relative-time tick can re-render in place.
  let lastData = null;

  // Session id of the agent whose terminal is currently active in the terminal
  // panel. Seeded from each full update; the extension also posts lightweight
  // {type:"activeTerminal"} messages on every terminal switch so the highlight
  // tracks instantly without a full re-render.
  let activeSessionId = "";

  const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ESC_MAP[c]);
  }

  function send(action, extra) {
    vscode.postMessage(Object.assign({ type: "action", action }, extra || {}));
  }

  // Actions that kick off real (often network/git) work the user waits on. Their
  // button gets an in-progress spinner on click; it clears when the next payload
  // re-renders the view (or via a safety timeout if no re-render follows).
  // Note: "openBranches" is intentionally absent. It opens the branches editor
  // tab (which paints instantly), but the sidebar never re-renders on that
  // action, so a spinner on its button would hang until the safety timeout. The
  // branches view shows its own load state instead. "searchWorktree" and
  // "findWorktreeFile" are absent for the same reason - they hand off to the
  // search view and to a quick pick, each of which shows its own load state.
  const BUSY_ACTIONS = new Set([
    "agent",
    "agentWorktree",
    "openWindow",
    "worktreeFromBranch",
    "fetchBranches",
    "refreshGithub",
  ]);

  // Swap a button's own icon for the spinner and disable it while its action
  // runs. The view rebuilds its DOM from data on the next render, which discards
  // this transient state; the timeout only restores the icon in the rare case
  // no re-render arrives (e.g. a fetch that returned identical data), so a
  // spinner never sticks forever.
  function markBusy(btn) {
    if (!btn || btn.classList.contains("busy")) return;
    const svg = btn.querySelector("svg");
    if (!svg) return;
    btn.classList.add("busy");
    btn.disabled = true;
    const original = svg.outerHTML;
    svg.outerHTML = icons.spinner;
    setTimeout(() => {
      if (!btn.isConnected || !btn.classList.contains("busy")) return;
      const cur = btn.querySelector("svg");
      if (cur) cur.outerHTML = original;
      btn.classList.remove("busy");
      btn.disabled = false;
    }, 15000);
  }

  // Status metadata. Colors come from VS Code chart variables in panel.css.
  const STATUS = {
    active: { label: "Active" },
    waiting: { label: "Waiting" },
    idle: { label: "Idle" },
  };

  function statusOf(a) {
    return STATUS[a && a.status] ? a.status : "idle";
  }

  /** Compact "how long has this been running" ("18s", "4m", "2h"). */
  function shortAge(t) {
    const sec = Math.max(0, (Date.now() - (t || 0)) / 1000);
    if (sec < 60) return Math.round(sec) + "s";
    const min = sec / 60;
    if (min < 60) return Math.round(min) + "m";
    const hr = min / 60;
    if (hr < 24) return Math.round(hr) + "h";
    return Math.round(hr / 24) + "d";
  }

  /**
   * One running subagent as an indented row. Only live ones are tracked, so
   * these lists empty themselves — a row answers "what is running", not "what
   * has run". A paused one has stopped its turn but is still in flight, parked
   * on a background command that will wake it: shown, but without the working
   * pulse.
   *
   * `sessionWaiting` is the status of the session that owns it, and `via` names
   * that session when the row is on a card the session does not live on. The row
   * clicks through to the owning session's terminal either way: a subagent has
   * no terminal of its own, so the thing to talk to is always its parent.
   */
  function subagentRow(s, sessionWaiting, sessionId, via) {
    const type = s.type || "";
    const task = s.task || "";
    const name = task || type || "Subagent";
    // A pending permission decision only means the USER is being asked when the
    // session is waiting: PermissionRequest also fires for calls auto mode or an
    // allowlist settles silently, and Claude Code's "needs you" notification
    // never says which subagent it came from. Pairing the two is what makes the
    // waiting marker trustworthy.
    const asking = sessionWaiting && !!s.awaitingPermission;
    const state = asking
      ? "waiting for you"
      : s.paused
      ? "waiting on background work"
      : "running";
    return (
      '<div class="subagent-row' +
      (asking ? " asking" : s.paused ? " paused" : "") +
      '" data-action="focusAgent" data-session="' +
      esc(sessionId || "") +
      '" role="button" tabindex="0" data-tip="' +
      esc(
        (type ? type + ": " : "") +
          (task || "subagent") +
          " — " +
          state +
          (via ? ", spawned by " + via : "") +
          ". Click to reveal " +
          (via ? "its agent's" : "the agent's") +
          " terminal."
      ) +
      '">' +
      '<span class="subagent-mark">' +
      icons.subagent +
      "</span>" +
      (task && type
        ? '<span class="subagent-type">' + esc(type) + "</span>"
        : "") +
      '<span class="subagent-label">' +
      esc(name) +
      "</span>" +
      (via ? '<span class="subagent-via">' + esc(via) + "</span>" : "") +
      '<span class="subagent-age" data-since="' +
      Number(s.startedAt || 0) +
      '">' +
      shortAge(s.startedAt) +
      "</span>" +
      "</div>"
    );
  }

  /** The subagents working in this agent's own worktree, as rows under it. The
   *  ones given a worktree of their own are rows on that worktree's card
   *  instead — the agent row just carries the count of them all. */
  function subagentRows(a) {
    const subs = (a && a.subagents) || [];
    const waiting = statusOf(a) === "waiting";
    return subs
      .filter((s) => !s.worktree)
      .map((s) => subagentRow(s, waiting, a.sessionId))
      .join("");
  }

  /** Subagents working in THIS worktree whose agent lives in another one — the
   *  usual shape of a fan-out, where one session hands each subagent a worktree
   *  so their edits cannot collide. */
  function foreignSubagentRows(subs) {
    return (subs || [])
      .map((s) =>
        subagentRow(
          s,
          s.parentStatus === "waiting",
          s.parentSessionId,
          s.parentLabel || "another agent"
        )
      )
      .join("");
  }

  // Whether the sidebar view is on screen, per the extension's visibility
  // messages. Assumed true until told otherwise: the first payload only arrives
  // when the view is being shown.
  let panelVisible = true;

  // Whether any row carries an elapsed label, from the data rather than the DOM.
  // Only subagent rows have one, and having none is the usual state.
  function anyAges() {
    const wts = (lastData && lastData.worktrees) || [];
    return wts.some(
      (wt) =>
        (wt.subagents && wt.subagents.length) ||
        (wt.agents || []).some((a) => a.subagents && a.subagents.length)
    );
  }

  // Elapsed labels have to tick on their own. The extension only re-posts when
  // the payload actually changes, and a subagent quietly working changes
  // nothing the panel renders — so an age rendered once would sit frozen at
  // whatever it read when the row first appeared. Rewrite just the text of the
  // labels that moved; no re-render, no DOM rebuild.
  //
  // Nothing to rewrite when no row has a label, or when nobody can see the panel
  // (it is retained across hides, so this timer outlives being hidden). Both are
  // checked before touching the DOM at all, since both are the common case.
  function tickAges() {
    if (document.hidden || !panelVisible || !anyAges()) return;
    root.querySelectorAll(".subagent-age[data-since]").forEach((el) => {
      const since = Number(el.getAttribute("data-since"));
      if (!since) return;
      const next = shortAge(since);
      if (el.textContent !== next) el.textContent = next;
    });
  }
  setInterval(tickAges, 1000);

  function agentRows(agents, foreign) {
    const away = (foreign || []).length;
    if (!agents || !agents.length) {
      // A worktree can be busy without holding an agent of its own: a session
      // elsewhere handed it to a subagent. The rows say so; the empty line is
      // only for a worktree where nothing at all is happening.
      if (!away) {
        return '<div class="agents-empty">No agents yet. Use “New Agent” to start one.</div>';
      }
      return '<div class="agents">' + foreignSubagentRows(foreign) + "</div>";
    }
    return (
      '<div class="agents">' +
      agents
        .map((a) => {
          const s = statusOf(a);
          // Full, untruncated text for the hover tooltip: the work summary. The
          // label in the row is clipped with an ellipsis, so this is how you read
          // the whole thing.
          const fullInfo = a.summary || a.label;
          const skills = a.skills || [];
          const skillChip = skills.length
            ? '<button class="skill-chip" data-action="showSkills" data-session="' +
              esc(a.sessionId) +
              '" title="' +
              skills.length +
              " skill" +
              (skills.length === 1 ? "" : "s") +
              ' used, click to view">' +
              icons.skill +
              skills.length +
              "</button>"
            : "";
          // How many subagents this agent has in flight, wherever they are
          // working. The ones in this worktree are rows directly underneath, but
          // a fan-out sends them to worktrees of their own — their rows are on
          // those cards, and without the count the session driving the whole
          // thing would look idle.
          const subs = a.subagents || [];
          const away = subs.filter((x) => x.worktree).length;
          const subChip = subs.length
            ? '<span class="subagent-count" data-tip="' +
              esc(
                subs.length +
                  " subagent" +
                  (subs.length === 1 ? "" : "s") +
                  " running" +
                  (away
                    ? ", " +
                      away +
                      " of them in " +
                      (away === 1 ? "a worktree" : "worktrees") +
                      " of their own"
                    : "")
              ) +
              '">' +
              icons.subagent +
              subs.length +
              "</span>"
            : "";
          return (
            '<div class="agent-row' +
            (s === "waiting" ? " attention" : "") +
            (a.sessionId === activeSessionId ? " terminal-open" : "") +
            '" data-action="focusAgent" data-session="' +
            esc(a.sessionId) +
            '" role="button" tabindex="0" title="Click to reveal terminal">' +
            '<span class="status-dot ' +
            s +
            '"></span>' +
            '<span class="agent-label" data-tip="' +
            esc(fullInfo) +
            '">' +
            esc(a.label) +
            "</span>" +
            // Present on every row but shown (via CSS) only on .terminal-open,
            // so the live class toggle needs no structural DOM changes.
            '<span class="terminal-chip" data-tip="This agent\'s terminal is open — it is the one you are talking to">' +
            icons.terminal +
            "</span>" +
            subChip +
            skillChip +
            '<span class="row-actions">' +
            '<button class="iconbtn" data-action="stopAgent" data-session="' +
            esc(a.sessionId) +
            '" title="Stop agent">' +
            icons.stop +
            "</button>" +
            "</span>" +
            "</div>" +
            subagentRows(a)
          );
        })
        .join("") +
      "</div>"
    );
  }

  /**
   * The at-a-glance summary of a card's agents: how many subagents are running
   * in the worktree, and the per-status breakdown. Zero-count statuses are
   * dropped rather than dimmed, and a single agent shows just its status dot —
   * the agent count next to it already says how many there are, so a "1"
   * breakdown adds nothing. Shared by the comfortable Agents bar and the
   * compact card header so a collapsed card reads the same in both densities.
   */
  function agentStats(agents, foreign) {
    const counts = { active: 0, waiting: 0, idle: 0 };
    // Subagents working in THIS worktree: the local agents' own, minus any they
    // sent to a worktree elsewhere, plus the ones another worktree's agent sent
    // here. It counts the rows on this card, not who spawned them.
    let subTotal = (foreign || []).length;
    for (const a of agents) {
      counts[statusOf(a)]++;
      subTotal += (a.subagents || []).filter((s) => !s.worktree).length;
    }

    // Live subagents across the worktree. The individual ones are rows in the
    // (collapsible) agent list, so this keeps them visible when it is closed.
    const subStat = subTotal
      ? '<span class="agents-bar-subagents" title="' +
        subTotal +
        " subagent" +
        (subTotal === 1 ? "" : "s") +
        ' running in this worktree">' +
        icons.subagent +
        subTotal +
        "</span>"
      : "";

    const stat = (key) =>
      counts[key]
        ? '<span class="stat ' +
          key +
          '" title="' +
          counts[key] +
          " " +
          STATUS[key].label.toLowerCase() +
          '"><span class="status-dot ' +
          key +
          '"></span>' +
          counts[key] +
          "</span>"
        : "";
    const single = statusOf(agents[0]);
    const stats =
      agents.length === 1
        ? '<span class="stat ' +
          single +
          '" title="' +
          STATUS[single].label +
          '"><span class="status-dot ' +
          single +
          '"></span></span>'
        : stat("active") + stat("waiting") + stat("idle");

    return { subTotal, subStat, stats };
  }

  /**
   * Collapsible "Agents" bar at the bottom of a comfortable card: it toggles the
   * agent list and carries the per-status counts.
   */
  function agentsBar(agents, path, foreign) {
    const { subStat, stats } = agentStats(agents, foreign);

    const hasActiveTerminal =
      !!activeSessionId &&
      agents.some((a) => a.sessionId === activeSessionId);
    return (
      '<div class="agents-bar' +
      (hasActiveTerminal ? " terminal-open" : "") +
      '" data-toggle="' +
      esc(path) +
      '" role="button" tabindex="0">' +
      '<span class="chevron">' +
      icons.chevron +
      "</span>" +
      '<span class="agents-bar-label">Agents</span>' +
      '<span class="agents-bar-count">' +
      agents.length +
      "</span>" +
      // Shown (via CSS) only while this worktree holds the active terminal, so
      // a collapsed card still says its agent is the one being talked to.
      '<span class="agents-bar-terminal" data-tip="The open terminal belongs to an agent in this worktree">' +
      icons.terminal +
      "</span>" +
      subStat +
      '<span class="agents-bar-stats">' +
      stats +
      "</span>" +
      "</div>"
    );
  }

  /**
   * Scope the Source Control view to this worktree. Opt-in (Settings →
   * Integrations). The active state marks the worktree whose repo is currently
   * shown in Source Control (the scope is already set).
   * Labeled on every worktree (not just the active one) so toggling the
   * scope never shifts the layout; the active worktree's pill fills blue,
   * making which worktree the diff view is on readable at a glance. The compact
   * density drops the label — the button moves into the card's action row,
   * where every control is an icon and the width is worth more than the word.
   */
  function scmScopeBtn(path, scmActive, compact) {
    if (!lastData || !lastData.scmEnabled) return "";
    return (
      '<button class="iconbtn scm-scope' +
      (scmActive ? " active" : "") +
      '" data-action="scopeScm" data-path="' +
      esc(path) +
      '" data-tip="' +
      (scmActive
        ? "This worktree is shown in Source Control. Click to re-scope."
        : "Show only this worktree in Source Control") +
      '" aria-label="Show only this worktree in Source Control">' +
      icons.branch +
      (compact ? "" : '<span class="scm-scope-label">Source Control</span>') +
      "</button>"
    );
  }

  /**
   * Git working-tree summary line: diff totals and ahead/behind. `compact`
   * drops the Source Control pill (the compact card renders it in its action
   * row instead) and shortens "4 changes" to a counted dot, so the git summary
   * and the PR rollup fit on one line together.
   */
  function gitLine(g, path, scmActive, compact) {
    const scopeBtn = compact ? "" : scmScopeBtn(path, scmActive, false);
    if (!g) return scopeBtn ? '<div class="gitline">' + scopeBtn + "</div>" : "";
    const segs = [];
    if (g.dirty)
      segs.push(
        '<span class="seg dirty"' +
          (compact
            ? ' title="' + g.dirty + (g.dirty === 1 ? " change" : " changes") + '"'
            : "") +
          '><span class="gdot"></span>' +
          g.dirty +
          (compact ? "" : g.dirty === 1 ? " change" : " changes") +
          "</span>"
      );
    // Zero-value segments are hidden: the nonzero counts are the signal, and a
    // row of zeros just buries them. A fully quiet worktree gets a single
    // "Clean" segment instead of an empty line.
    if (g.insertions || g.deletions) {
      segs.push('<span class="seg ins">+' + (g.insertions || 0) + "</span>");
      segs.push('<span class="seg del">−' + (g.deletions || 0) + "</span>");
    }
    if (g.ahead)
      segs.push(
        '<span class="seg ahead" title="Commits to push">↑' + g.ahead + "</span>"
      );
    if (g.behind)
      segs.push(
        '<span class="seg behind" title="Commits to pull">↓' +
          g.behind +
          "</span>"
      );
    if (!segs.length)
      segs.push(
        '<span class="seg clean" title="No local changes, in sync with upstream">' +
          icons.check +
          "Clean</span>"
      );
    return '<div class="gitline">' + scopeBtn + segs.join("") + "</div>";
  }

  // PR-state badge labels and the CSS class that colors them.
  const PR_STATE = {
    open: { label: "Open", cls: "open" },
    draft: { label: "Draft", cls: "draft" },
    merged: { label: "Merged", cls: "merged" },
    closed: { label: "Closed", cls: "closed" },
  };

  /**
   * PR summary for a worktree branch, linking out to the PR. A header row with
   * the state badge, then separate "Checks" and "Reviews" rows so the CI rollup
   * and the review decision don't read as one ambiguous run of checkmarks.
   * Rendered only when PR data is present (the integration is on and a PR
   * exists). `compact` keeps the framed block but folds the two labelled rows
   * into one and tightens the padding (see the branch below and the compact
   * section of panel.css). The branches view calls this without the flag.
   */
  function prLine(pr, compact) {
    if (!pr) return "";
    const st = PR_STATE[pr.state] || PR_STATE.open;
    const plural = (n) => (n === 1 ? "" : "s");

    // CI checks: one colored, counted segment per non-zero state (passing,
    // failing, running) so the whole rollup is visible at a glance.
    const checkSegs = [];
    if (pr.checks && pr.checks !== "none") {
      const pass = pr.checksPass || 0;
      const fail = pr.checksFail || 0;
      const pending = pr.checksPending || 0;
      const total = pass + fail + pending;
      if (pass)
        checkSegs.push(
          '<span class="pr-seg pass" title="' +
            pass +
            " of " +
            total +
            " check" +
            plural(total) +
            ' passing">' +
            icons.check +
            pass +
            "</span>"
        );
      if (fail)
        checkSegs.push(
          '<span class="pr-seg fail" title="' +
            fail +
            " of " +
            total +
            " check" +
            plural(total) +
            ' failing">' +
            icons.cross +
            fail +
            "</span>"
        );
      if (pending)
        checkSegs.push(
          '<span class="pr-seg pending" title="' +
            pending +
            " of " +
            total +
            " check" +
            plural(total) +
            ' running">' +
            icons.dot +
            pending +
            "</span>"
        );
    }

    // Review decision + comments. Counted segments are additive so a mixed
    // state (e.g. some approvals with reviewers still pending) shows all of it.
    const reviewSegs = [];
    if (pr.approvals)
      reviewSegs.push(
        '<span class="pr-seg approved" title="' +
          pr.approvals +
          " approval" +
          plural(pr.approvals) +
          '">' +
          icons.check +
          pr.approvals +
          "</span>"
      );
    if (pr.changesRequested)
      reviewSegs.push(
        '<span class="pr-seg changes" title="' +
          pr.changesRequested +
          " change request" +
          plural(pr.changesRequested) +
          '">' +
          icons.cross +
          pr.changesRequested +
          "</span>"
      );
    if (pr.reviewsPending)
      reviewSegs.push(
        '<span class="pr-seg review-pending" title="' +
          pr.reviewsPending +
          " review" +
          plural(pr.reviewsPending) +
          ' pending">' +
          icons.eye +
          pr.reviewsPending +
          "</span>"
      );
    if (pr.comments)
      reviewSegs.push(
        '<span class="pr-seg comments" title="' +
          pr.comments +
          " comment" +
          plural(pr.comments) +
          '">' +
          icons.comment +
          pr.comments +
          "</span>"
      );

    // Merge-readiness flags shown beside the state badge. "Out of date" is
    // GitHub's "This branch is out-of-date with the base branch" (mergeState
    // "behind"); "Auto-merge" means GitHub will merge once requirements pass.
    // These keep their words in both densities: stripped to the glyph they are
    // two unlabelled colored pills, and the compact meta line wraps anyway.
    const flagSegs = [];
    if (pr.mergeState === "behind")
      flagSegs.push(
        '<span class="pr-flag behind" title="This branch is out-of-date with the base branch">' +
          icons.behind +
          "Out of date</span>"
      );
    if (pr.autoMerge)
      flagSegs.push(
        '<span class="pr-flag automerge" title="Auto-merge is enabled — GitHub will merge once requirements pass">' +
          icons.autoMerge +
          "Auto-merge</span>"
      );

    const rows = [];
    if (pr.title)
      rows.push(
        '<div class="pr-row pr-title">' + esc(pr.title) + "</div>"
      );
    rows.push(
      '<div class="pr-row pr-head">' +
        '<span class="pr-ico">' +
        icons.pr +
        "</span>" +
        '<span class="pr-state ' +
        st.cls +
        '">' +
        st.label +
        " #" +
        pr.number +
        "</span>" +
        flagSegs.join("") +
        '<span class="pr-open">' +
        icons.external +
        "</span>" +
        "</div>"
    );
    // Compact keeps the block — the rollup reads as one thing, which is the
    // point of framing it — and buys its two saved rows by merging the review
    // and check runs onto one line. They stay two runs, separated by a rule, so
    // the CI checkmarks and the review checkmarks still cannot be read as one
    // ambiguous sequence; the labels move to the segments' own titles.
    if (compact) {
      if (reviewSegs.length || checkSegs.length)
        rows.push(
          '<div class="pr-row pr-rollup">' +
            (reviewSegs.length
              ? '<span class="pr-group" title="Reviews">' +
                reviewSegs.join("") +
                "</span>"
              : "") +
            (reviewSegs.length && checkSegs.length
              ? '<span class="pr-group-sep"></span>'
              : "") +
            (checkSegs.length
              ? '<span class="pr-group" title="Checks">' +
                checkSegs.join("") +
                "</span>"
              : "") +
            "</div>"
        );
    } else {
      if (reviewSegs.length)
        rows.push(
          '<div class="pr-row"><span class="pr-row-label">Reviews</span>' +
            reviewSegs.join("") +
            "</div>"
        );
      if (checkSegs.length)
        rows.push(
          '<div class="pr-row"><span class="pr-row-label">Checks</span>' +
            checkSegs.join("") +
            "</div>"
        );
    }

    return (
      '<a class="prline' +
      (compact ? " compact" : "") +
      '" href="' +
      esc(pr.url) +
      '" title="' +
      esc(pr.title) +
      ' — open on GitHub">' +
      rows.join("") +
      "</a>"
    );
  }

  /**
   * A card's branch on GitHub, or "" when there is nothing to link: no
   * github.com origin, or a detached worktree. `branchUrl` is the branches
   * view's own builder, which encodes each path segment separately so a
   * `feature/x` branch keeps its slash.
   */
  function githubBranchLink(wt) {
    if (!wt.branch || wt.detached) return "";
    const url = branchUrl(lastData, wt.branch);
    if (!url) return "";
    return (
      '<a class="ghlink" href="' +
      esc(url) +
      '" data-tip="View ' +
      esc(wt.branch) +
      ' on GitHub" aria-label="View this branch on GitHub"' +
      ' target="_blank" rel="noopener noreferrer">' +
      icons.github +
      "</a>"
    );
  }

  function card(wt) {
    const isCollapsed = !expanded.has(wt.path);
    const badges = [];
    if (wt.isPrimary) badges.push('<span class="badge primary">Primary</span>');
    if (wt.detached) badges.push('<span class="badge warn">detached</span>');
    if (wt.locked) badges.push('<span class="badge warn">locked</span>');

    const agents = wt.agents || [];
    // Subagents another worktree's agent is running in this one.
    const foreign = wt.subagents || [];

    const compact = isCompact();

    const agentBtn =
      '<button class="act agent" data-action="agent" data-path="' +
      esc(wt.path) +
      '" title="Start a Claude session in this worktree">' +
      '<span class="agent-plus">+</span>' +
      icons.agentMark +
      "<span>New agent</span></button>";

    // This worktree's branch on GitHub. Only when origin is a github.com remote
    // (data.repoUrl) and the worktree is on a branch: a detached HEAD has no
    // branch page to open. A plain anchor, as the branches view uses - the
    // webview opens http(s) links in the browser itself, with no round trip
    // through the extension host.
    const ghLink = githubBranchLink(wt);

    // Change the branch this worktree has checked out: pick an existing branch
    // or create a new one. Detached worktrees have no branch to swap from, but
    // the action still lets you switch onto one, so it is always offered.
    // data-tip (the snappy custom tooltip) rather than title: the native
    // tooltip's long delay makes an icon-only button feel unlabeled.
    const editBranchBtn =
      '<button class="act ghost iconact" data-action="changeBranch" data-path="' +
      esc(wt.path) +
      '" data-tip="Switch this worktree to another branch (or create one)" aria-label="Switch branch">' +
      icons.edit +
      "</button>";

    // Refresh just this worktree's git status (and its PR/CI when the GitHub
    // integration is on). Does not run a git fetch - that's the toolbar Refresh.
    const refreshBtn =
      '<button class="act ghost iconact" data-action="refreshWorktree" data-path="' +
      esc(wt.path) +
      '" title="Refresh this worktree' +
      (lastData && lastData.prEnabled ? " (git and PR status)" : " (git status)") +
      '">' +
      icons.refresh +
      "</button>";

    // Open this worktree in its own VS Code window (focuses an existing one if
    // already open). Available for every worktree, including the primary.
    const openWindowBtn =
      '<button class="act ghost iconact" data-action="openWindow" data-path="' +
      esc(wt.path) +
      '" title="Open this worktree in a new VS Code window">' +
      icons.window +
      "</button>";

    // Reach this worktree's files from this window. A worktree is not a
    // workspace folder, so neither Find in Files nor Ctrl/Cmd+P covers it: these
    // two scope those to the worktree instead of making you open (and then work
    // across) a second window. They sit in the action row rather than the card
    // header, which already carries four buttons on a narrow sidebar.
    const searchBtn =
      '<button class="act ghost iconact" data-action="searchWorktree" data-path="' +
      esc(wt.path) +
      '" data-tip="Search this worktree\'s contents (Find in Files, scoped to it)" aria-label="Search this worktree">' +
      icons.search +
      "</button>";
    const findFileBtn =
      '<button class="act ghost iconact" data-action="findWorktreeFile" data-path="' +
      esc(wt.path) +
      '" data-tip="Open a file from this worktree by name" aria-label="Find file in this worktree">' +
      icons.fileSearch +
      "</button>";

    // Run and Debug for this worktree. Only rendered when the worktree has
    // launch configurations of its own; a repo with no debug setup gets no
    // button. It shares the action row with New agent (which is right-aligned),
    // so it fills space the card already had rather than adding a row.
    const debugSessions = wt.debugSessions || [];
    const debugBtn = wt.canDebug
      ? '<button class="act ghost debug' +
        (debugSessions.length ? " running" : "") +
        '" data-action="debugWorktree" data-path="' +
        esc(wt.path) +
        '" data-tip="' +
        (debugSessions.length
          ? "Start another launch configuration in this worktree"
          : "Run a launch configuration from this worktree (with or without debugging)") +
        '" aria-label="Run and Debug">' +
        icons.debug +
        (compact ? "" : "<span>Debug</span>") +
        "</button>"
      : "";

    // Rows for the sessions this panel started. VS Code's debug toolbar can stop
    // them too, but it acts on the one session it considers active, so the card
    // carries a stop button per session: that is the only place a specific
    // worktree's session can be named and stopped.
    const debugRows = debugSessions.length
      ? '<div class="debug-rows">' +
        debugSessions
          .map(
            (s) =>
              '<div class="debug-row">' +
              '<span class="debug-ico">' +
              icons.debug +
              "</span>" +
              '<span class="debug-label" data-tip="' +
              esc(s.label) +
              '">' +
              esc(s.label) +
              "</span>" +
              (s.noDebug
                ? '<span class="debug-chip" data-tip="Started without debugging (no breakpoints)">no debug</span>'
                : "") +
              '<span class="row-actions">' +
              '<button class="iconbtn" data-action="stopDebug" data-debug="' +
              esc(s.id) +
              '" title="Stop this session">' +
              icons.debugStop +
              "</button>" +
              "</span>" +
              "</div>"
          )
          .join("") +
        "</div>"
      : "";

    // Delete (git worktree remove) — never for the primary worktree.
    const deleteBtn = wt.isPrimary
      ? ""
      : '<button class="act ghost danger" data-action="removeWorktree" data-path="' +
        esc(wt.path) +
        '" title="Delete this worktree from disk">' +
        icons.trash +
        "</button>";

    const shell = (inner) =>
      '<div class="card' +
      (compact ? " compact" : "") +
      (wt.inWorkspace ? " open" : "") +
      (isCollapsed ? " collapsed" : "") +
      '">' +
      inner +
      "</div>";

    if (compact) {
      // One sticky header line, one meta line, and the agents. The header is the
      // expand toggle (there is no separate Agents bar to click) and it stays
      // pinned while its own agent rows scroll under it, so a row is never
      // separated from the name of the worktree it belongs to — which is the
      // whole point of the density: no scrolling back up to check whose agent
      // you are about to click.
      const { subTotal, subStat, stats } = agentStats(agents, foreign);
      const hasActiveTerminal =
        !!activeSessionId && agents.some((a) => a.sessionId === activeSessionId);
      const countStat =
        agents.length || subTotal
          ? '<span class="meta-count" title="' +
            agents.length +
            " agent" +
            (agents.length === 1 ? "" : "s") +
            ' in this worktree">' +
            icons.agentMark +
            agents.length +
            "</span>"
          : "";
      const git = gitLine(wt.git, wt.path, wt.scmActive, true);

      // The meta line carries two unrelated readings of the same worktree - what
      // the working tree looks like, and what is running in it - so they sit as
      // two groups with a rule between them rather than one undifferentiated run
      // of glyphs. Either side can be absent (a clean worktree with no agents,
      // an agent working on a worktree with nothing to report), and the rule is
      // only drawn when both are there.
      // The stats hold the right edge of the meta line against the git totals on
      // the left. Plain flex does the rest: an auto margin applies per flex line,
      // so when the panel is too narrow to hold both the stats wrap to a row of
      // their own and stay right-aligned there.
      const agentGroup = countStat + subStat + stats;
      const meta =
        git + (agentGroup ? '<span class="meta-stats">' + agentGroup + "</span>" : "");

      return shell(
        '<div class="card-head' +
          (hasActiveTerminal ? " terminal-open" : "") +
          '" data-toggle="' +
          esc(wt.path) +
          '" role="button" tabindex="0" aria-expanded="' +
          (isCollapsed ? "false" : "true") +
          '" data-tip="' +
          esc(wt.path) +
          '">' +
          '<span class="chevron">' +
          icons.chevron +
          "</span>" +
          '<span class="branch">' +
          esc(wt.name) +
          "</span>" +
          // Right beside the name (shown via CSS only on .terminal-open): the
          // branch you are talking to, said where you read which branch it is.
          '<span class="agents-bar-terminal" data-tip="The open terminal belongs to an agent in this worktree">' +
          icons.terminal +
          "</span>" +
          '<span class="badges">' +
          badges.join("") +
          "</span>" +
          // The two actions pinned to the header, against the right edge: the
          // branch on GitHub, and Delete. Delete stays last, as it is in the
          // comfortable header — destructive actions sit at the end of a run,
          // and the confirmation modal is what actually guards a near-miss.
          ghLink +
          deleteBtn +
          "</div>" +
          (meta ? '<div class="card-meta">' + meta + "</div>" : "") +
          prLine(wt.pr, true) +
          '<div class="card-body">' +
          '<div class="card-actions">' +
          scmScopeBtn(wt.path, wt.scmActive, true) +
          searchBtn +
          findFileBtn +
          debugBtn +
          editBranchBtn +
          refreshBtn +
          openWindowBtn +
          agentBtn +
          "</div>" +
          debugRows +
          agentRows(agents, foreign) +
          "</div>"
      );
    }

    return shell(
      '<div class="card-top">' +
        '<span class="branch">' +
        esc(wt.name) +
        "</span>" +
        editBranchBtn +
        ghLink +
        '<span class="badges">' +
        badges.join("") +
        "</span>" +
        refreshBtn +
        openWindowBtn +
        deleteBtn +
        "</div>" +
        '<hr class="card-sep" />' +
        '<div class="meta-row">' +
        gitLine(wt.git, wt.path, wt.scmActive, false) +
        "</div>" +
        '<div class="agent-action-row">' +
        '<span class="row-lead">' +
        searchBtn +
        findFileBtn +
        debugBtn +
        "</span>" +
        agentBtn +
        "</div>" +
        debugRows +
        prLine(wt.pr, false) +
        agentsBar(agents, wt.path, foreign) +
        '<div class="card-body">' +
        agentRows(agents, foreign) +
        "</div>"
    );
  }

  function toolbar(data) {
    return (
      '<div class="repo-head">' +
      "<span>" +
      esc(data.repoName || "Repository") +
      "</span>" +
      '<span class="tools">' +
      '<button class="tbtn icon" data-action="agentWorktree" data-tip="New Agent &amp; Worktree: create a worktree with Claude (claude -w) and start an agent in it">' +
      icons.agentWorktree +
      "</button>" +
      '<button class="tbtn ghost" data-action="openBranches" data-tip="Branches: list every branch and create a worktree from one">' +
      icons.branch +
      "</button>" +
      '<button class="tbtn ghost' +
      (isCompact() ? " active" : "") +
      '" data-tool="density" data-tip="' +
      (isCompact()
        ? "Compact view is on: one line per worktree, actions inside the card. Click for the roomier layout."
        : "Compact view: fold each worktree down to a line or two and tuck its actions inside the card") +
      '" aria-pressed="' +
      (isCompact() ? "true" : "false") +
      '">' +
      icons.density +
      "</button>" +
      '<button class="tbtn ghost" data-tool="collapseAll" data-tip="Collapse all">' +
      icons.collapse +
      "</button>" +
      "</span>" +
      "</div>"
    );
  }

  function render(data) {
    lastData = data;
    hideTip(); // a re-render replaces the hovered node; drop any open tooltip
    if (settingsOpen) {
      // Settings owns the whole window; routine data pushes must not wipe the
      // token field mid-type, so only re-render when GitHub state changed.
      maybeRefreshSettings(data);
      return;
    }
    if (!data || !data.repoRoot) {
      root.innerHTML =
        '<div class="empty">No git repository in this window.<br/>Open a folder that is a git repository to see its worktrees.</div>';
      return;
    }
    // Preserve the cards scroll offset across the innerHTML swap so a routine
    // refresh doesn't bounce the user back to the top (see renderBranches).
    const prevCards = root.querySelector(".cards");
    const y = prevCards ? prevCards.scrollTop : 0;
    const wts = data.worktrees || [];
    const cards = wts.map(card).join("");
    root.innerHTML =
      toolbar(data) +
      '<div class="cards">' +
      (cards || '<div class="empty">No worktrees found.</div>') +
      "</div>";
    const nextCards = root.querySelector(".cards");
    if (nextCards) nextCards.scrollTop = y;
  }

  function toggle(path) {
    if (expanded.has(path)) expanded.delete(path);
    else expanded.add(path);
    persist();
    const el = root.querySelector('[data-toggle="' + cssEscape(path) + '"]');
    if (el && el.parentElement) el.parentElement.classList.toggle("collapsed");
    // The compact header is the card's sole disclosure control, so it carries
    // the state for screen readers; the class toggle above never re-renders it.
    if (el && el.hasAttribute("aria-expanded"))
      el.setAttribute("aria-expanded", expanded.has(path) ? "true" : "false");
  }

  /**
   * Switch the card layout. The two densities emit different markup, so this
   * re-renders rather than toggling a class; the expand state is untouched, so
   * whatever was open stays open on the other side of the switch.
   */
  function setDensity(next) {
    if (density === next) return;
    density = next;
    persist();
    if (lastData) render(lastData);
  }

  function collapseAll() {
    const wts = (lastData && lastData.worktrees) || [];
    const anyExpanded = wts.some((w) => expanded.has(w.path));
    if (anyExpanded) expanded.clear();
    else for (const w of wts) expanded.add(w.path);
    persist();
    if (lastData) render(lastData);
  }

  // Minimal attribute-selector escaping for paths in querySelector.
  function cssEscape(s) {
    return String(s).replace(/["\\]/g, "\\$&");
  }

  // --- Skills modal ----------------------------------------------------------
  // Lives on document.body, not inside #root, so a data re-render never wipes it.
  let modalEl = null;

  function findAgent(sessionId) {
    const wts = (lastData && lastData.worktrees) || [];
    for (const w of wts) {
      for (const a of w.agents || []) {
        if (a.sessionId === sessionId) return a;
      }
    }
    return null;
  }

  function closeModal() {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
  }

  function openSkills(sessionId) {
    const a = findAgent(sessionId);
    if (!a) return;
    const skills = a.skills || [];
    const items = skills.length
      ? skills
          .map(
            (s) =>
              '<li class="skill-item"><span class="skill-bullet">' +
              icons.skill +
              "</span>" +
              esc(s) +
              "</li>"
          )
          .join("")
      : '<li class="skill-empty">No skills used yet.</li>';
    closeModal();
    modalEl = document.createElement("div");
    modalEl.className = "modal-backdrop";
    modalEl.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-head">' +
      '<span class="modal-title">Skills · ' +
      esc(a.label) +
      "</span>" +
      '<button class="iconbtn modal-close" title="Close">' +
      icons.stop +
      "</button>" +
      "</div>" +
      '<ul class="skill-list">' +
      items +
      "</ul>" +
      "</div>";
    modalEl.addEventListener("click", (ev) => {
      if (ev.target === modalEl || ev.target.closest(".modal-close")) {
        closeModal();
      }
    });
    document.body.appendChild(modalEl);
  }

  // --- Settings modal --------------------------------------------------------
  // Holds the GitHub PR-status integration controls. Like the skills modal it
  // lives on document.body so a data re-render never wipes it; it only re-renders
  // itself when the GitHub connection (not the worktree data) changes, so typing
  // a token is never interrupted by a routine refresh.
  let settingsOpen = false;
  let settingsTab = "github";
  let lastGhSig = "";
  // Once a token is connected, the token input and its how-to text are hidden
  // behind a "Replace token" toggle; this tracks whether that form is open.
  let ghTokenFormOpen = false;

  function ghSig(data) {
    return JSON.stringify([
      (data && data.github) || null,
      (data && data.prEnabled) !== false,
      (data && data.scmEnabled) === true,
      (data && data.traceEnabled) === true,
      (data && data.linkedPaths) || [],
      // The Performance tab's state arrives after the tab asks for it, so it has
      // to be part of the signature or the section would sit on "Checking…".
      (data && data.gitPerf) || null,
    ]);
  }

  // The settings tabs. Each renders its own body section; `settingsTab` tracks
  // which one is shown.
  const SETTINGS_TABS = [
    { id: "github", icon: "pr", label: "GitHub", section: githubSection },
    {
      id: "integrations",
      icon: "branch",
      label: "Source Control",
      section: integrationsSection,
    },
    { id: "linked", icon: "link", label: "Linked Files", section: linkedSection },
    {
      id: "performance",
      icon: "zap",
      label: "Performance",
      section: performanceSection,
    },
    { id: "debug", icon: "bug", label: "Debug", section: debugSection },
  ];

  function githubSection(data) {
    const gh = (data && data.github) || { hasToken: false, connected: false };
    const prEnabled = !data || data.prEnabled !== false;

    let status;
    if (!gh.hasToken) {
      status =
        '<div class="gh-status none">Not connected. Add a personal access token to show PR status per branch.</div>';
    } else if (gh.connected) {
      status =
        '<div class="gh-status ok"><span class="status-dot active"></span>Connected' +
        (gh.login ? " as <b>" + esc(gh.login) + "</b>" : "") +
        (gh.tokenType
          ? ' <span class="gh-type">' + esc(gh.tokenType) + " token</span>"
          : "") +
        "</div>";
    } else {
      status =
        '<div class="gh-status err"><span class="status-dot waiting"></span>' +
        esc(gh.error || "Token saved but not validated.") +
        "</div>";
    }

    // With a token stored, the entry form collapses behind "Replace token" and
    // the account actions sit right under the connection status they act on.
    const showForm = !gh.hasToken || ghTokenFormOpen;
    const accountActions = gh.hasToken
      ? '<div class="gh-actions">' +
        '<button data-gh="replaceToken">' +
        (showForm ? "Cancel" : "Replace token") +
        "</button>" +
        '<button class="gh-disconnect" data-gh="disconnect">Disconnect</button>' +
        "</div>"
      : "";

    const tokenField =
      '<div class="gh-field">' +
      '<input type="password" id="gh-token" placeholder="ghp_… or github_pat_…" autocomplete="off" spellcheck="false" />' +
      '<button class="primary" data-gh="save">Save</button>' +
      "</div>";

    // Fine-grained PAT template URL (GitHub supports prefilling the token name
    // and per-resource permissions via query params). We request read-only on
    // exactly what the PR rollups touch: pull requests + reviews, commit
    // statuses, check runs, and repo contents. (Metadata: read is mandatory and
    // added by GitHub automatically.)
    const fgUrl =
      "https://github.com/settings/personal-access-tokens/new" +
      "?name=Agent+Worktrees" +
      "&description=Read-only+PR+status+for+the+Agent+Worktrees+extension" +
      "&contents=read&pull_requests=read&statuses=read&checks=read";
    // Classic PAT: the `repo` scope covers PR/status/check reads on private repos.
    const classicUrl =
      "https://github.com/settings/tokens/new?scopes=repo&description=Agent+Worktrees";

    const links =
      '<p class="gh-help">Generate a read-only token (permissions pre-filled): ' +
      '<a href="' +
      fgUrl +
      '">Fine-grained</a> · ' +
      '<a href="' +
      classicUrl +
      '">Classic</a></p>' +
      '<div class="gh-perms">' +
      '<div class="gh-perms-h">Fine-grained — Repository permissions (Read):</div>' +
      "<ul>" +
      "<li>Pull requests</li>" +
      "<li>Checks</li>" +
      '<li>Commit statuses <span class="dim">— optional, for legacy CI status</span></li>' +
      "<li>Contents</li>" +
      '<li>Metadata <span class="dim">— required, added automatically</span></li>' +
      "</ul>" +
      '<div class="gh-perms-h">Classic — scope: <code>repo</code></div>' +
      "</div>" +
      '<p class="gh-help dim">Choose the repositories you want under “Repository access”. ' +
      "The token is kept in VS Code Secret Storage and is only ever sent to the GitHub API.</p>";

    const toggle =
      '<label class="gh-toggle">' +
      '<span class="gh-toggle-label">Show PR status on worktrees</span>' +
      '<input type="checkbox" id="gh-enable" class="switch-input"' +
      (prEnabled ? " checked" : "") +
      ' role="switch" aria-label="Show PR status on worktrees" />' +
      '<span class="switch" aria-hidden="true"></span>' +
      "</label>";

    return (
      '<section class="gh-section">' +
      '<h3 class="gh-h">' +
      icons.pr +
      " GitHub PR status</h3>" +
      '<p class="gh-lead">Tie GitHub into the panel to see each branch’s open PR — ' +
      "state, CI checks, review status and comments — refreshed as your agents work.</p>" +
      toggle +
      status +
      accountActions +
      (showForm ? tokenField + links : "") +
      "</section>"
    );
  }

  function integrationsSection(data) {
    const scmEnabled = !!(data && data.scmEnabled);
    const toggle =
      '<label class="gh-toggle">' +
      '<span class="gh-toggle-label">Source Control scope button</span>' +
      '<input type="checkbox" id="scm-enable" class="switch-input"' +
      (scmEnabled ? " checked" : "") +
      ' role="switch" aria-label="Show the Source Control scope button on worktrees" />' +
      '<span class="switch" aria-hidden="true"></span>' +
      "</label>";

    return (
      '<section class="gh-section">' +
      '<h3 class="gh-h">' +
      icons.branch +
      " Source Control</h3>" +
      '<p class="gh-lead">Add a button to each worktree that scopes the built-in ' +
      "Source Control view to that worktree, so you only see its diffs.</p>" +
      toggle +
      '<p class="gh-help dim">When a single repository is open, choosing a worktree ' +
      "swaps it into Source Control — the previous repo is removed from the view, " +
      "not from disk. When several are open, it reveals and focuses the selected one.</p>" +
      "</section>"
    );
  }

  function linkedSection(data) {
    const paths = (data && data.linkedPaths) || [];
    const list = paths.length
      ? '<ul class="linked-list">' +
        paths
          .map(
            (p) =>
              '<li class="linked-item">' +
              '<span class="linked-path" title="' +
              esc(p) +
              '">' +
              icons.link +
              "<code>" +
              esc(p) +
              "</code></span>" +
              '<button class="linked-remove" data-link-remove="' +
              esc(p) +
              '" title="Remove ' +
              esc(p) +
              '" aria-label="Remove ' +
              esc(p) +
              '">' +
              icons.cross +
              "</button>" +
              "</li>"
          )
          .join("") +
        "</ul>"
      : '<p class="gh-help dim linked-empty">No linked files yet. Add a repo-relative ' +
        "path below (for example <code>tests/appsettings.local.json</code>).</p>";

    // Browse opens the host's native file picker rooted at the repo; the text
    // field stays for typing a path directly (and is the way to add a folder on
    // platforms whose dialog can't offer files and folders at once).
    const field =
      '<div class="gh-field linked-field">' +
      '<input type="text" id="linked-input" placeholder="tests/appsettings.local.json" autocomplete="off" spellcheck="false" />' +
      '<button class="linked-browse" data-action="browseLinkedPath" title="Choose files to link" aria-label="Choose files to link">' +
      icons.folderOpen +
      "</button>" +
      '<button class="primary" data-link-add>Add</button>' +
      "</div>";

    // The files this feature exists for are gitignored almost by definition, so
    // offering the ignore list is usually the fastest way to find them.
    const fromIgnore =
      '<button data-action="pickIgnoredPaths">' +
      icons.ignored +
      "Add from .gitignore</button>";

    const relink = paths.length
      ? '<button data-action="relinkWorktrees">Link existing worktrees</button>'
      : "";

    const actions =
      '<div class="linked-actions">' + fromIgnore + relink + "</div>";

    return (
      '<section class="gh-section">' +
      '<h3 class="gh-h">' +
      icons.link +
      " Linked files</h3>" +
      '<p class="gh-lead">Symlink gitignored local files into every worktree this ' +
      "panel creates, so builds and integration tests that need them (an " +
      "<code>appsettings</code>, a <code>.env</code>, a certs folder) work in a " +
      "fresh worktree the same as in your main checkout.</p>" +
      list +
      field +
      actions +
      '<p class="gh-help dim">Add from .gitignore lists every file git ignores so ' +
      "you can tick the ones you need. You can also type a path or use the folder " +
      "button to pick files. Paths are relative to the repository root and point " +
      "back at your main worktree's copy, so edits stay in sync. A real file " +
      "already present in a worktree is never overwritten. New worktrees are " +
      'linked automatically; "Link existing worktrees" applies the list to the ' +
      "ones you already have.</p>" +
      "</section>"
    );
  }

  /**
   * One accelerator, as a switch with its state explained underneath.
   *
   * `locked` is a reason string when the switch cannot be moved (an old git, a
   * platform git has no monitor for, a filesystem that failed git's check, or a
   * monitor the user runs themselves). A locked switch is disabled rather than
   * hidden: "why is this off" is the question the row exists to answer.
   */
  function perfRow(key, label, on, detail, locked) {
    return (
      '<li class="perf-row' +
      (on ? " on" : "") +
      (locked ? " locked" : "") +
      '">' +
      '<label class="perf-toggle">' +
      '<span class="perf-name">' +
      label +
      "</span>" +
      '<input type="checkbox" class="switch-input" data-perf="' +
      key +
      '"' +
      (on ? " checked" : "") +
      (locked ? " disabled" : "") +
      ' role="switch" aria-label="' +
      esc(label) +
      '" />' +
      '<span class="switch" aria-hidden="true"></span>' +
      "</label>" +
      '<span class="perf-detail dim">' +
      (locked || detail) +
      "</span>" +
      "</li>"
    );
  }

  /**
   * The poll rate, as a row shaped like the accelerator rows above it.
   *
   * A fixed list rather than a free number: the useful range is small, and every
   * option here is a rate the extension will accept, so the control cannot ask
   * for one that gets clamped back underneath the user.
   */
  function pollRow(seconds) {
    const opts = [2, 5, 10, 30, 60]
      .map(
        (s) =>
          '<option value="' +
          s +
          '"' +
          (s === seconds ? " selected" : "") +
          ">" +
          (s === 60 ? "1 minute" : s + " seconds") +
          "</option>"
      )
      .join("");
    return (
      '<li class="perf-row">' +
      '<label class="perf-toggle">' +
      '<span class="perf-name">Recheck every</span>' +
      '<select id="poll-seconds" class="perf-select" aria-label="Status poll interval">' +
      opts +
      "</select>" +
      "</label>" +
      '<span class="perf-detail dim">' +
      "Applies to worktrees not open in Source Control; open ones refresh on " +
      "their own" +
      "</span>" +
      "</li>"
    );
  }

  function performanceSection(data) {
    const perf = data && data.gitPerf;
    if (!perf) {
      // The extension reads this on demand (it is git calls), so the first paint
      // of this tab is a loading line replaced by the payload that follows. With
      // no repository there is nothing to read and no payload will ever arrive,
      // so that must not read as "checking" forever.
      const noRepo = !(data && data.repoRoot);
      return (
        '<section class="gh-section">' +
        '<h3 class="gh-h">' +
        icons.zap +
        " Performance</h3>" +
        '<p class="gh-lead">' +
        (noRepo
          ? "These are per-repository git settings, and this workspace's first " +
            "folder is not in a git repository."
          : "Checking what this repository has enabled…") +
        "</p>" +
        "</section>"
      );
    }

    const cacheOn = perf.untrackedCache === true;
    const monitorOn = perf.fsmonitor !== false;
    const rows =
      '<ul class="perf-list">' +
      perfRow(
        "untrackedCache",
        "Untracked cache",
        cacheOn,
        cacheOn
          ? "git reuses each folder's result instead of re-reading it"
          : "git re-reads every folder to find new files",
        // Only blocked by the filesystem, and only for turning it ON: a cache
        // already in place can always be turned back off.
        !cacheOn && perf.untrackedCacheOk === false
          ? "Unavailable: this filesystem failed git's own check for it"
          : ""
      ) +
      perfRow(
        "fsmonitor",
        "Filesystem monitor",
        monitorOn,
        monitorOn
          ? "git asks its watcher what changed instead of looking"
          : "git walks the working tree on every status",
        perf.fsmonitor === "hook"
          ? "Your own monitor program is configured here, so the panel leaves " +
            "this alone"
          : monitorOn
          ? ""
          : perf.fsmonitorSupport === "old-git"
          ? "Unavailable: needs git 2.37 or newer"
          : perf.fsmonitorSupport === "platform"
          ? "Unavailable: git has no built-in monitor for this platform"
          : ""
      ) +
      pollRow(data.statusPollSeconds || 10) +
      "</ul>";

    const lead = perf.statusWasSlow
      ? "A <code>git status</code> in this window took over two seconds, which is " +
        "git walking your working tree. These two settings are its own fix."
      : "The panel runs <code>git status</code> to keep each card's counts current. " +
        "These two git settings let it skip work it has already done, which on a " +
        "large repository is the difference between an instant refresh and a slow one.";

    return (
      '<section class="gh-section">' +
      '<h3 class="gh-h">' +
      icons.zap +
      " Performance</h3>" +
      '<p class="gh-lead">' +
      lead +
      "</p>" +
      rows +
      '<p class="gh-help dim">The two switches write this repository\'s own git ' +
      "settings (<code>core.untrackedCache</code>, <code>core.fsmonitor</code>): " +
      "nothing global, nothing committed, and turning one off puts it back the way " +
      "it was. The same as <code>git config</code> in this repository, which is " +
      "still there if you prefer it. The interval is the panel's own setting " +
      "(<code>agentWorktrees.statusPollSeconds</code>) and applies to every " +
      "repository.</p>" +
      "</section>"
    );
  }

  function debugSection(data) {
    const traceEnabled = !!(data && data.traceEnabled);
    const toggle =
      '<label class="gh-toggle">' +
      '<span class="gh-toggle-label">Debug tracing</span>' +
      '<input type="checkbox" id="debug-trace" class="switch-input"' +
      (traceEnabled ? " checked" : "") +
      ' role="switch" aria-label="Enable debug tracing" />' +
      '<span class="switch" aria-hidden="true"></span>' +
      "</label>";

    return (
      '<section class="gh-section">' +
      '<h3 class="gh-h">' +
      icons.bug +
      " Debug</h3>" +
      '<p class="gh-lead">Trace git and GitHub activity to the “Agent Worktrees” ' +
      "output channel to diagnose why a view fails to load or a PR status is " +
      "missing.</p>" +
      toggle +
      '<p class="gh-help dim">When on, every git command and GitHub request is ' +
      "logged with timing. Leave it off for normal use.</p>" +
      '<button class="gh-disconnect" data-action="showLog">Open log</button>' +
      "</section>"
    );
  }

  function settingsContent(data) {
    const active = SETTINGS_TABS.find((t) => t.id === settingsTab)
      ? settingsTab
      : "github";
    const tabs = SETTINGS_TABS.map(
      (t) =>
        '<button class="settings-tab' +
        (t.id === active ? " active" : "") +
        '" role="tab" data-tab="' +
        t.id +
        '" aria-selected="' +
        (t.id === active) +
        '">' +
        icons[t.icon] +
        "<span>" +
        t.label +
        "</span></button>"
    ).join("");
    const body = (
      SETTINGS_TABS.find((t) => t.id === active) || SETTINGS_TABS[0]
    ).section(data);

    return (
      '<div class="settings-view">' +
      '<div class="settings-head">' +
      '<span class="settings-title">Settings</span>' +
      '<button class="tbtn ghost settings-close" data-action="closeSettings" title="Close settings">' +
      icons.cross +
      " Close</button>" +
      "</div>" +
      '<div class="settings-main">' +
      '<nav class="settings-tabs" role="tablist">' +
      tabs +
      "</nav>" +
      '<div class="settings-body">' +
      body +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function renderSettings() {
    if (!settingsOpen) return;
    root.innerHTML = settingsContent(lastData);
    lastGhSig = ghSig(lastData);
    const input = root.querySelector("#gh-token");
    if (input) {
      input.onkeydown = (e) => {
        if (e.key === "Enter") saveToken();
      };
    }
    const linkInput = root.querySelector("#linked-input");
    if (linkInput) {
      linkInput.onkeydown = (e) => {
        if (e.key === "Enter") addLinkedPath();
      };
    }
    // The Performance tab's state is git calls, so the extension reads it only
    // when asked. Requested here rather than on the tab click: `settingsTab`
    // survives closing Settings, so reopening straight onto this tab has to ask
    // too or the section sits on "Checking…" forever. The extension answers with
    // a payload, which re-renders this; if there is no repo to read it answers
    // nothing and no render follows, so this cannot spin.
    if (settingsTab === "performance" && !(lastData && lastData.gitPerf)) {
      send("loadGitPerf");
    }
  }

  function addLinkedPath() {
    const input = root.querySelector("#linked-input");
    const value = input && input.value.trim();
    if (!value) return;
    send("addLinkedPath", { linkPath: value });
    input.value = "";
    input.focus();
  }

  function saveToken() {
    const input = root.querySelector("#gh-token");
    const token = input && input.value.trim();
    if (!token) return;
    send("setGithubToken", { token });
    ghTokenFormOpen = false;
    input.value = "";
    const btn = root.querySelector('[data-gh="save"]');
    if (btn) {
      btn.textContent = "Saving…";
      btn.disabled = true;
    }
  }

  function closeSettings() {
    if (!settingsOpen) return;
    settingsOpen = false;
    ghTokenFormOpen = false;
    render(lastData);
  }

  function openSettings() {
    closeModal(); // never stack a modal over the settings page
    settingsOpen = true;
    renderSettings();
  }

  /** Re-render the open settings page only when GitHub state changed. */
  function maybeRefreshSettings(data) {
    if (settingsOpen && ghSig(data) !== lastGhSig) renderSettings();
  }

  // --- Branches view ---------------------------------------------------------
  // Rendered only in the dedicated editor-tab webview (VIEW === "branches"),
  // where it fills the whole page. Lists every branch of the repo, its PR
  // rollup (via prLine), and a create-worktree action. All filtering/sorting is
  // client-side over the single BranchData payload the extension posts; no extra
  // network calls. The sidebar (VIEW === "panel") never renders this; its
  // "Branches" toolbar button just asks the extension to open this tab.
  let branchesLoading = false;
  let branchData = null;
  // Signature of the last branch payload we rendered, so an unchanged poll push
  // is dropped instead of rebuilding the DOM (and resetting scroll).
  let lastBranchSig = "";
  // Client-side pagination over the filtered branch list, so a repo with many
  // branches stays scannable. Reset to 0 whenever the filtered set changes.
  let branchPage = 0;
  const BRANCH_PAGE_SIZE = 25;
  // Tracks which filter/sort dropdown is open (webview-only UI state).
  let openMenu = "";

  // Single-select Sort. All git-based (branch tip-commit date / name), so they
  // work with or without a GitHub token — this is a git-first view.
  const SORT_OPTIONS = [
    { id: "recentlyUpdated", label: "Recently updated" },
    { id: "leastRecentlyUpdated", label: "Least recently updated" },
    { id: "name", label: "Name (A–Z)" },
  ];

  // Multi-select Location filter: where a branch lives. Ids match branchKind()
  // so a selection filters rows by the same tag they display. Empty = no filter.
  const LOCATION_OPTIONS = [
    { id: "local", label: "Local only" },
    { id: "both", label: "Local + remote" },
    { id: "remote-only", label: "Remote only" },
  ];

  // Single-select PR Status filter. The per-branch fetch is open-only, so the
  // only PR states a branch can carry are "open" and "draft"; "all" applies no
  // PR filter. Only shown when GitHub PR data is available (prAvailable).
  const PR_STATUS_OPTIONS = [
    { id: "all", label: "All" },
    { id: "open", label: "Open" },
    { id: "draft", label: "Draft" },
  ];

  // Single-select Reviewer filter. "all" applies no filter; "requested" keeps
  // only branches whose PR has a review requested from the signed-in user, i.e.
  // the PRs they still have to review. Only shown when GitHub PR data is
  // available.
  const REVIEWER_OPTIONS = [
    { id: "all", label: "All" },
    { id: "requested", label: "Review requested" },
  ];

  /** True when the GitHub integration is connected and PR display is enabled.
   *  Gates only whether a branch's open PR is shown, never the branch list. */
  function prAvailable(data) {
    const gh = data && data.github;
    return !!(gh && gh.connected && data.prEnabled !== false);
  }

  function timeVal(s) {
    const t = s ? Date.parse(s) : NaN;
    return isNaN(t) ? 0 : t;
  }

  // Compact relative time ("just now", "5m", "3h", "4d", "2w", "5mo", "1y") for a
  // branch's last-updated commit date. Empty string when the date is missing.
  function relTime(s) {
    const t = timeVal(s);
    if (!t) return "";
    const sec = Math.max(0, (Date.now() - t) / 1000);
    if (sec < 45) return "just now";
    const min = sec / 60;
    if (min < 60) return Math.round(min) + "m ago";
    const hr = min / 60;
    if (hr < 24) return Math.round(hr) + "h ago";
    const day = hr / 24;
    if (day < 7) return Math.round(day) + "d ago";
    if (day < 30) return Math.round(day / 7) + "w ago";
    if (day < 365) return Math.round(day / 30) + "mo ago";
    return Math.round(day / 365) + "y ago";
  }

  // "Last refreshed" label for the GitHub PR data. The branches view fetches on
  // open (when a token is connected) and on each Fetch Open PRs click; this reads
  // "Never" only until that first on-open fetch lands.
  function lastRefreshedText(data) {
    const t = data && data.lastGithubRefresh;
    if (!t) return "Never";
    return new Date(t).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  /** Whether a branch's PR matches the active PR Status filter. "all" matches
   *  everything; "open"/"draft" match a branch carrying a PR in that exact state.
   *  The fetch is open-only, so any attached PR is open or draft. */
  function matchesPrStatus(b, status) {
    if (status === "all") return true;
    return !!(b && b.pr && b.pr.state === status);
  }

  /** Whether a branch's PR matches the active Reviewer filter. "all" matches
   *  everything; "requested" matches a branch whose PR has a review requested
   *  from the signed-in user, i.e. the PRs they still have to review. */
  function matchesReviewer(b, sel) {
    if (sel === "all") return true;
    return !!(b && b.pr && b.pr.reviewRequestedFromViewer);
  }

  /** Apply the active user + PR-status filters and sort to the branch list,
   *  client-side. Sorting and the user filter are git-based; the PR-status filter
   *  is the only one that consults GitHub data and is gated by prAvailable. */
  function visibleBranches(data) {
    const all = (data && data.branches) || [];
    const sortOpt =
      SORT_OPTIONS.find((s) => s.id === branchFilters.sort) || SORT_OPTIONS[0];
    const userSet = new Set(branchFilters.users);

    let rows = all.slice();

    // Filter to branches last updated by the selected user(s). A branch with no
    // known committer is dropped only while a filter is active.
    if (userSet.size) {
      rows = rows.filter((b) => b.lastUser && userSet.has(b.lastUser));
    }

    // Location filter: keep branches whose locality tag (local only /
    // local + remote / remote only) is among the selected ones.
    const locSet = new Set(branchFilters.locations);
    if (locSet.size) {
      rows = rows.filter((b) => locSet.has(branchKind(b)));
    }

    // PR-status filter: only honored when PR data is actually available, so a
    // stale selection can never hide every branch when the integration is off.
    if (branchFilters.prStatus !== "all" && prAvailable(data)) {
      rows = rows.filter((b) => matchesPrStatus(b, branchFilters.prStatus));
    }

    // Reviewer filter: same gating as PR status — only consulted when PR data is
    // available, so a stale selection can never empty the list when GitHub is off.
    if (branchFilters.reviewer !== "all" && prAvailable(data)) {
      rows = rows.filter((b) => matchesReviewer(b, branchFilters.reviewer));
    }

    const byName = (a, b) =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    rows.sort((a, b) => {
      if (sortOpt.id === "name") return byName(a, b);
      const ta = timeVal(a.updatedAt);
      const tb = timeVal(b.updatedAt);
      // Branches with no date sort to the end, then tie-break by name.
      if (ta !== tb) {
        if (!ta) return 1;
        if (!tb) return -1;
        return sortOpt.id === "leastRecentlyUpdated" ? ta - tb : tb - ta;
      }
      return byName(a, b);
    });
    return rows;
  }

  /** Distinct branch committers ("who last updated it"), the current user pinned
   *  first when known, then alphabetical. Derived from git, not GitHub. */
  function userOptions(data) {
    const viewer = (data && data.viewerLogin) || "";
    const seen = new Set();
    const out = [];
    for (const b of (data && data.branches) || []) {
      const u = b.lastUser;
      if (u && !seen.has(u)) {
        seen.add(u);
        out.push(u);
      }
    }
    out.sort((a, b) => a.localeCompare(b));
    if (viewer && seen.has(viewer)) {
      return [viewer].concat(out.filter((u) => u !== viewer));
    }
    return out;
  }

  function menu(id, label, summary, items) {
    const open = openMenu === id;
    return (
      '<div class="bfilter' +
      (open ? " open" : "") +
      '" data-menu="' +
      id +
      '">' +
      '<button class="bfilter-btn" data-menu-toggle="' +
      id +
      '" aria-expanded="' +
      open +
      '"><span class="bfilter-label">' +
      esc(label) +
      "</span><span class=\"bfilter-summary\">" +
      esc(summary) +
      "</span>" +
      '<span class="bfilter-caret">' +
      icons.chevron +
      "</span></button>" +
      (open ? '<div class="bfilter-menu" role="menu">' + items + "</div>" : "") +
      "</div>"
    );
  }

  function filterBar(data) {
    const sortOpt =
      SORT_OPTIONS.find((s) => s.id === branchFilters.sort) || SORT_OPTIONS[0];

    const viewer = (data && data.viewerLogin) || "";
    const users = userOptions(data);
    const selected = new Set(branchFilters.users);
    const userItems = users.length
      ? users
          .map(
            (u) =>
              '<button class="bfilter-item" role="menuitemcheckbox" data-user="' +
              esc(u) +
              '" aria-checked="' +
              selected.has(u) +
              '"><span class="bcheck">' +
              (selected.has(u) ? icons.check : "") +
              "</span>" +
              esc(u) +
              (u === viewer ? ' <span class="bdim">(you)</span>' : "") +
              "</button>"
          )
          .join("")
      : '<div class="bfilter-empty">No branch authors</div>';
    const userSummary = branchFilters.users.length
      ? branchFilters.users.length + " selected"
      : "Anyone";
    const controls = menu("user", "Updated by", userSummary, userItems);

    // Location multi-select, mirroring Updated by: toggling an entry keeps the
    // menu open, empty selection means no filter.
    const locSelected = new Set(branchFilters.locations);
    const locItems = LOCATION_OPTIONS.map(
      (o) =>
        '<button class="bfilter-item" role="menuitemcheckbox" data-loc="' +
        o.id +
        '" aria-checked="' +
        locSelected.has(o.id) +
        '"><span class="bcheck">' +
        (locSelected.has(o.id) ? icons.check : "") +
        "</span>" +
        esc(o.label) +
        "</button>"
    ).join("");
    const locSummary =
      branchFilters.locations.length === 1
        ? LOCATION_OPTIONS.find((o) => o.id === branchFilters.locations[0])
            .label
        : branchFilters.locations.length
        ? branchFilters.locations.length + " selected"
        : "All";
    const locationMenu = menu("location", "Location", locSummary, locItems);

    const sortItems = SORT_OPTIONS.map(
      (s) =>
        '<button class="bfilter-item" role="menuitemradio" data-sort="' +
        s.id +
        '" aria-checked="' +
        (branchFilters.sort === s.id) +
        '"><span class="bcheck">' +
        (branchFilters.sort === s.id ? icons.check : "") +
        "</span>" +
        esc(s.label) +
        "</button>"
    ).join("");

    // PR Status single-select: only shown when GitHub PR data is available (no
    // point offering it when no PRs can be matched). Narrows the list by PR
    // state — All / Open / Draft.
    const prStatusOpt =
      PR_STATUS_OPTIONS.find((s) => s.id === branchFilters.prStatus) ||
      PR_STATUS_OPTIONS[0];
    const prStatusItems = PR_STATUS_OPTIONS.map(
      (s) =>
        '<button class="bfilter-item" role="menuitemradio" data-prstatus="' +
        s.id +
        '" aria-checked="' +
        (branchFilters.prStatus === s.id) +
        '"><span class="bcheck">' +
        (branchFilters.prStatus === s.id ? icons.check : "") +
        "</span>" +
        esc(s.label) +
        "</button>"
    ).join("");
    const prStatusMenu = prAvailable(data)
      ? menu("prStatus", "PR Status", prStatusOpt.label, prStatusItems)
      : "";

    // Reviewer single-select: same gating as PR Status (only shown with GitHub
    // PR data). Narrows to branches whose PR has a review requested — All /
    // Review requested.
    const reviewerOpt =
      REVIEWER_OPTIONS.find((s) => s.id === branchFilters.reviewer) ||
      REVIEWER_OPTIONS[0];
    const reviewerItems = REVIEWER_OPTIONS.map(
      (s) =>
        '<button class="bfilter-item" role="menuitemradio" data-reviewer="' +
        s.id +
        '" aria-checked="' +
        (branchFilters.reviewer === s.id) +
        '"><span class="bcheck">' +
        (branchFilters.reviewer === s.id ? icons.check : "") +
        "</span>" +
        esc(s.label) +
        "</button>"
    ).join("");
    const reviewerMenu = prAvailable(data)
      ? menu("reviewer", "Reviewer", reviewerOpt.label, reviewerItems)
      : "";

    // Clear Filters: resets the author + PR Status + Reviewer filters (Sort is an
    // ordering, not a filter, so it is left alone). Disabled when nothing is
    // filtering — the PR-aware parts only count when PR data is actually
    // available, mirroring visibleBranches so the button is live exactly when the
    // list is narrowed.
    const filterApplied =
      branchFilters.users.length > 0 ||
      branchFilters.locations.length > 0 ||
      (branchFilters.prStatus !== "all" && prAvailable(data)) ||
      (branchFilters.reviewer !== "all" && prAvailable(data));
    const clearButton =
      '<button class="bfilter-clear" data-action="clearFilters"' +
      (filterApplied ? "" : " disabled") +
      ' title="Clear the author, Location, PR Status and Reviewer filters">' +
      icons.cross +
      "<span>Clear Filters</span></button>";

    return (
      '<div class="bfilter-bar">' +
      controls +
      locationMenu +
      menu("sort", "Sort", sortOpt.label, sortItems) +
      prStatusMenu +
      reviewerMenu +
      clearButton +
      "</div>"
    );
  }

  // The three locality states a branch row tags itself with.
  const BRANCH_KINDS = {
    "remote-only": {
      label: "remote only",
      title: "Exists only on origin; no local branch",
    },
    both: {
      label: "local + remote",
      title: "Local branch that also exists on origin",
    },
    local: {
      label: "local only",
      title: "Local branch with no matching origin branch",
    },
  };

  function branchKind(b) {
    if (b.remoteOnly) return "remote-only";
    return b.hasRemote ? "both" : "local";
  }

  // GitHub web URL for a branch's tree. Branch names can contain slashes, which
  // GitHub keeps as path separators, so encode each segment but not the slashes.
  function branchUrl(data, name) {
    if (!data || !data.repoUrl) return "";
    const seg = String(name).split("/").map(encodeURIComponent).join("/");
    return data.repoUrl + "/tree/" + seg;
  }

  function branchRow(b, data) {
    // PR data is still used to detect a merged branch for the delete flow, but
    // only an OPEN (or draft) PR is shown on the row — this is a branches view,
    // with the PR as a hint, not a PR list.
    const prData = prAvailable(data) ? b.pr : null;
    const pr =
      prData && (prData.state === "open" || prData.state === "draft")
        ? prData
        : null;
    const kind = branchKind(b);
    const k = BRANCH_KINDS[kind];
    const tag =
      '<span class="btag ' +
      kind +
      '" title="' +
      k.title +
      '">' +
      esc(k.label) +
      "</span>";

    // Ahead/behind vs the compare base (upstream, or the default branch when the
    // branch has no upstream). Each piece shows only when non-zero so an in-sync
    // row stays uncluttered. (No +/- line diff here: it cost a git process per
    // branch and was dropped for speed; the commit ahead/behind is the signal.)
    const segs = [];
    if (b.ahead)
      segs.push(
        '<span class="bseg ahead" title="Commits ahead of its base (to push)">↑' +
          b.ahead +
          "</span>"
      );
    if (b.behind)
      segs.push(
        '<span class="bseg behind" title="Commits behind its base (to pull)">↓' +
          b.behind +
          "</span>"
      );
    const remoteMark =
      tag + (segs.length ? '<span class="bsync">' + segs.join("") + "</span>" : "");
    // A worktree already exists: show the marker, and (when we know its path)
    // still let the user start a Claude agent in that existing worktree.
    const control = b.hasWorktree
      ? '<span class="bworktree" title="' +
        (b.worktreePath ? esc(b.worktreePath) : "") +
        '">' +
        icons.check +
        "Worktree exists</span>" +
        (b.worktreePath
          ? '<button class="bagent" data-action="agent" data-path="' +
            esc(b.worktreePath) +
            '" title="Start a Claude agent in this worktree">' +
            icons.agentMark +
            "Start agent</button>"
          : "")
      : '<button class="bcreate" data-action="worktreeFromBranch" data-branch="' +
        esc(b.name) +
        '" data-remote="' +
        (b.remoteOnly ? "1" : "0") +
        '" title="Create a worktree for this branch and start a Claude agent in it">' +
        icons.agentMark +
        "Create worktree &amp; start agent</button>";

    // Delete is local-only: it removes the local branch and never touches the
    // remote. A remote-only branch has no local ref to delete, so the button is
    // shown only for branches that exist on this machine (and never for the
    // repo's default branch, e.g. main).
    const canDelete = !b.isDefault && !b.remoteOnly;
    const deleteBtn = canDelete
      ? '<button class="bdelete danger" data-action="deleteBranch" data-branch="' +
        esc(b.name) +
        '" data-merged="' +
        (prData && prData.state === "merged" ? "1" : "0") +
        '" title="Delete this local branch (the remote branch is left untouched)">' +
        icons.trash +
        "Delete Local</button>"
      : "";

    const url = branchUrl(data, b.name);
    const nameLink = url
      ? '<a class="brow-link" href="' +
        esc(url) +
        '" title="View this branch on GitHub" target="_blank" rel="noopener noreferrer">' +
        icons.external +
        "</a>"
      : "";

    // Git-native "last updated" line: when, and by whom. The signal this view
    // sorts and filters on, shown so the order is legible.
    const when = relTime(b.updatedAt);
    const meta =
      when || b.lastUser
        ? '<div class="brow-meta">' +
          (when ? '<span class="bmeta-when">' + esc(when) + "</span>" : "") +
          (b.lastUser
            ? '<span class="bmeta-user" title="Last commit by ' +
              esc(b.lastUser) +
              '">' +
              icons.agentMark +
              esc(b.lastUser) +
              "</span>"
            : "") +
          "</div>"
        : "";

    return (
      '<div class="brow">' +
      '<div class="brow-top">' +
      '<span class="brow-name">' +
      esc(b.name) +
      "</span>" +
      nameLink +
      remoteMark +
      '<span class="brow-control">' +
      control +
      deleteBtn +
      "</span>" +
      "</div>" +
      meta +
      (pr ? prLine(pr) : "") +
      "</div>"
    );
  }

  // Prev/Next pager under the branch list. Hidden when everything fits on one
  // page. Buttons are disabled (so their click never fires) at the ends.
  function branchPager(total, start, shown, pageCount) {
    if (total <= BRANCH_PAGE_SIZE) return "";
    const from = total ? start + 1 : 0;
    const to = start + shown;
    const prevDis = branchPage <= 0 ? " disabled" : "";
    const nextDis = branchPage >= pageCount - 1 ? " disabled" : "";
    return (
      '<div class="bpager">' +
      '<span class="bpager-info">' +
      from +
      "–" +
      to +
      " of " +
      total +
      "</span>" +
      '<button class="bpager-btn" data-page="prev"' +
      prevDis +
      ">Prev</button>" +
      '<span class="bpager-pos">Page ' +
      (branchPage + 1) +
      " / " +
      pageCount +
      "</span>" +
      '<button class="bpager-btn" data-page="next"' +
      nextDis +
      ">Next</button>" +
      "</div>"
    );
  }

  function branchesContent() {
    const data = branchData;
    let body;
    if (branchesLoading && !data) {
      body = '<div class="bloading">Loading branches…</div>';
    } else if (!data || !data.repoRoot) {
      body =
        '<div class="empty">No git repository in this window.<br/>Open a folder that is a git repository to list its branches.</div>';
    } else if (data.error) {
      // A git failure (missing/hung/timed out): show it rather than a misleading
      // "No branches found". Full detail is in the "Agent Worktrees" output.
      body =
        '<div class="empty">Could not list branches.<br/>' +
        esc(data.error) +
        '<br/><br/>See View &gt; Output &gt; "Agent Worktrees" for details.</div>';
    } else if (!data.branches || !data.branches.length) {
      body = '<div class="empty">No branches found in this repository.</div>';
    } else {
      const rows = visibleBranches(data);
      const total = rows.length;
      const pageCount = Math.max(1, Math.ceil(total / BRANCH_PAGE_SIZE));
      if (branchPage >= pageCount) branchPage = pageCount - 1;
      if (branchPage < 0) branchPage = 0;
      const start = branchPage * BRANCH_PAGE_SIZE;
      const pageRows = rows.slice(start, start + BRANCH_PAGE_SIZE);
      const list = pageRows.length
        ? pageRows.map((b) => branchRow(b, data)).join("")
        : '<div class="empty">No branches match the current filters.</div>';
      body =
        filterBar(data) +
        '<div class="brows">' +
        list +
        "</div>" +
        branchPager(total, start, pageRows.length, pageCount);
    }

    const repoName = (data && data.repoName) || "";
    const repoLink =
      data && data.repoUrl
        ? '<a class="branches-link" href="' +
          esc(data.repoUrl) +
          '/branches" title="View all branches for this repo on GitHub" target="_blank" rel="noopener noreferrer">' +
          icons.external +
          "Branches on GitHub</a>"
        : "";
    return (
      '<div class="settings-view branches-view">' +
      '<div class="settings-head">' +
      '<span class="settings-title">' +
      icons.branch +
      "Branches" +
      (repoName ? ' <span class="branches-repo">' + esc(repoName) + "</span>" : "") +
      "</span>" +
      '<div class="branches-head-actions">' +
      repoLink +
      // Fetch (git only) with its Prune checkbox stacked directly underneath.
      '<div class="branches-action-stack">' +
      '<button class="branches-refresh" data-action="fetchBranches" title="Fetch from the remote to refresh local branch state (ahead/behind, diffs)">' +
      icons.refresh +
      " Fetch</button>" +
      '<label class="branches-prune" title="Also remove remote-tracking refs for branches deleted on the remote">' +
      '<input type="checkbox" id="branches-prune"' +
      (branchFilters.prune ? " checked" : "") +
      " /> Prune</label>" +
      "</div>" +
      // Fetch Open PRs is the API-only counterpart to the git-only Fetch: it
      // re-polls open PR/CI status without a git fetch. Only useful (and only
      // shown) when a token is stored. PR/CI status is fetched on open and on
      // each click; it spins (data.githubRefreshing) while the on-open fetch is
      // in flight. The "Last refreshed" time sits directly below it.
      (data && data.github && data.github.hasToken
        ? '<div class="branches-action-stack">' +
          '<button class="branches-refresh' +
          (data.githubRefreshing ? " busy" : "") +
          '" data-action="refreshGithub"' +
          (data.githubRefreshing ? " disabled" : "") +
          ' title="Re-query the GitHub API to refresh open PR and CI status">' +
          (data.githubRefreshing ? icons.spinner : icons.pr) +
          " Fetch Open PRs</button>" +
          '<span class="branches-lastrefresh" title="When the open PR and CI status was last refreshed. Status is refreshed when the view opens and whenever you click Fetch Open PRs.">Last refreshed: ' +
          esc(lastRefreshedText(data)) +
          "</span>" +
          "</div>"
        : "") +
      // Bulk-delete local branches whose upstream is gone (merged or deleted on
      // the remote). Prompts before deleting; never touches the remote. Last in
      // the row, behind a divider, so the destructive action is not sandwiched
      // between the routine fetch buttons.
      '<button class="branches-refresh branches-danger" data-action="deleteGoneBranches" data-tip="Delete every local branch whose remote branch no longer exists (merged or deleted on the remote). The remote is never touched, and branches with unmerged work get an extra confirmation.">' +
      icons.trash +
      " Delete gone</button>" +
      "</div>" +
      "</div>" +
      '<div class="branches-body">' +
      body +
      "</div>" +
      "</div>"
    );
  }

  function renderBranches() {
    // The scroll region (.brows) is recreated by the innerHTML swap, so capture
    // its offset and restore it onto the fresh node — a background poll re-render
    // must not jerk the list back to the top while the user is scrolled down.
    const prev = root.querySelector(".brows");
    const y = prev ? prev.scrollTop : 0;
    root.innerHTML = branchesContent();
    const next = root.querySelector(".brows");
    if (next) next.scrollTop = y;
  }

  // Branches-tab mount: request the branch + PR payload, show the loading state
  // until it arrives. Called once when this webview is the branches editor tab.
  function mountBranches() {
    branchesLoading = !branchData;
    renderBranches();
    send("loadBranches");
  }

  root.addEventListener("click", (e) => {
    // GitHub settings controls (save token / disconnect).
    const gh = e.target.closest("[data-gh]");
    if (gh) {
      const kind = gh.getAttribute("data-gh");
      if (kind === "save") saveToken();
      else if (kind === "disconnect") {
        ghTokenFormOpen = false;
        send("clearGithubToken");
      } else if (kind === "replaceToken") {
        ghTokenFormOpen = !ghTokenFormOpen;
        renderSettings();
      }
      return;
    }
    // Linked Files controls (add a path / remove a path).
    const linkAdd = e.target.closest("[data-link-add]");
    if (linkAdd) {
      addLinkedPath();
      return;
    }
    const linkRemove = e.target.closest("[data-link-remove]");
    if (linkRemove) {
      send("removeLinkedPath", {
        linkPath: linkRemove.getAttribute("data-link-remove") || undefined,
      });
      return;
    }
    // Settings tab switch (webview-only; no round trip. The Performance tab's
    // state is requested by renderSettings, which covers being switched to AND
    // being the tab Settings reopens on).
    const tab = e.target.closest("[data-tab]");
    if (tab && settingsOpen) {
      settingsTab = tab.getAttribute("data-tab") || "github";
      renderSettings();
      return;
    }
    const tool = e.target.closest("[data-tool='collapseAll']");
    if (tool) {
      collapseAll();
      return;
    }
    const densityTool = e.target.closest("[data-tool='density']");
    if (densityTool) {
      setDensity(isCompact() ? "comfortable" : "compact");
      return;
    }
    // Branches view: filter/sort dropdowns and selections (webview-only).
    if (VIEW === "branches") {
      const pageBtn = e.target.closest("[data-page]");
      if (pageBtn) {
        const dir = pageBtn.getAttribute("data-page");
        branchPage = dir === "prev" ? branchPage - 1 : branchPage + 1;
        renderBranches(); // clamps the page; restores scroll, then jump to top
        const brows = root.querySelector(".brows");
        if (brows) brows.scrollTop = 0;
        return;
      }
      const menuToggle = e.target.closest("[data-menu-toggle]");
      if (menuToggle) {
        const id = menuToggle.getAttribute("data-menu-toggle");
        openMenu = openMenu === id ? "" : id;
        renderBranches();
        return;
      }
      const user = e.target.closest("[data-user]");
      if (user) {
        const name = user.getAttribute("data-user");
        const i = branchFilters.users.indexOf(name);
        if (i === -1) branchFilters.users.push(name);
        else branchFilters.users.splice(i, 1);
        branchPage = 0;
        persist();
        renderBranches();
        return;
      }
      // Location multi-select: toggle like Updated by (menu stays open).
      const loc = e.target.closest("[data-loc]");
      if (loc) {
        const id = loc.getAttribute("data-loc");
        const i = branchFilters.locations.indexOf(id);
        if (i === -1) branchFilters.locations.push(id);
        else branchFilters.locations.splice(i, 1);
        branchPage = 0;
        persist();
        renderBranches();
        return;
      }
      const sort = e.target.closest("[data-sort]");
      if (sort) {
        branchFilters.sort =
          sort.getAttribute("data-sort") || "recentlyUpdated";
        openMenu = "";
        branchPage = 0;
        persist();
        renderBranches();
        return;
      }
      // PR Status single-select: webview-only filter, no message to the extension.
      const prStatus = e.target.closest("[data-prstatus]");
      if (prStatus) {
        branchFilters.prStatus =
          prStatus.getAttribute("data-prstatus") || "all";
        openMenu = "";
        branchPage = 0;
        persist();
        renderBranches();
        return;
      }
      // Reviewer single-select: webview-only filter, no message to the extension.
      const reviewer = e.target.closest("[data-reviewer]");
      if (reviewer) {
        branchFilters.reviewer =
          reviewer.getAttribute("data-reviewer") || "all";
        openMenu = "";
        branchPage = 0;
        persist();
        renderBranches();
        return;
      }
      // Clear Filters: resets author + Location + PR Status + Reviewer (not
      // Sort). Webview-only; the disabled attribute is the rendered guard,
      // re-checked here so a stale click can't fire when nothing is filtering.
      const clearFilters = e.target.closest("[data-action='clearFilters']");
      if (clearFilters) {
        if (clearFilters.disabled) return;
        branchFilters.users = [];
        branchFilters.locations = [];
        branchFilters.prStatus = "all";
        branchFilters.reviewer = "all";
        openMenu = "";
        branchPage = 0;
        persist();
        renderBranches();
        return;
      }
      // Click outside any open menu closes it (but let real actions below run).
      if (openMenu && !e.target.closest(".bfilter")) {
        openMenu = "";
        renderBranches();
        // fall through so an action target still fires
      }
    }
    const btn = e.target.closest("[data-action]");
    if (btn) {
      e.stopPropagation();
      const action = btn.getAttribute("data-action");
      // Show an in-progress spinner for actions that do real work the user waits
      // on (git/network/window). Webview-only actions below return early before
      // this matters, so it is safe to mark here for any matching action.
      if (BUSY_ACTIONS.has(action)) markBusy(btn);
      // Skills modal is handled entirely in the webview: the list is already
      // in the data, so there is no round-trip to the extension.
      if (action === "showSkills") {
        openSkills(btn.getAttribute("data-session"));
        return;
      }
      // Settings is a webview-only page — no round trip to the extension.
      if (action === "openSettings") {
        openSettings();
        return;
      }
      if (action === "closeSettings") {
        closeSettings();
        return;
      }
      // Sidebar "Branches" toolbar button: ask the extension to open (or reveal)
      // the dedicated branches editor tab. No in-sidebar overlay is rendered.
      if (action === "openBranches") {
        send("openBranches");
        return;
      }
      // Create a worktree from a branch row, carrying which branch and whether
      // it is remote-only so the extension knows to set up remote tracking.
      if (action === "worktreeFromBranch") {
        send("worktreeFromBranch", {
          branch: btn.getAttribute("data-branch") || undefined,
          remoteOnly: btn.getAttribute("data-remote") === "1",
        });
        return;
      }
      // Delete the local branch only (the remote ref is left untouched). Carry
      // whether the PR merged so the extension knows it can force-delete a branch
      // whose squash-merge left it looking unmerged.
      if (action === "deleteBranch") {
        send("deleteBranch", {
          branch: btn.getAttribute("data-branch") || undefined,
          merged: btn.getAttribute("data-merged") === "1",
        });
        return;
      }
      // Explicit Fetch button: carry the Prune checkbox state so the extension
      // fetches with (or without) --prune.
      if (action === "fetchBranches") {
        const prune = root.querySelector("#branches-prune");
        send("fetchBranches", { value: prune ? !!prune.checked : true });
        return;
      }
      // Fetch Open PRs: API-only re-poll of open PR/CI status, no git fetch.
      if (action === "refreshGithub") {
        send("refreshGithub");
        return;
      }
      // Scope button: move the blue pill immediately. The extension's
      // confirmation follows on a later post, but the Git extension can take
      // seconds to register the repo swap (Windows, many worktrees) and the
      // click must not look ignored while it does. The cached data is patched
      // too so a webview-local re-render keeps the optimistic state.
      if (action === "scopeScm") {
        const path = btn.getAttribute("data-path");
        root.querySelectorAll(".scm-scope.active").forEach(function (b) {
          b.classList.remove("active");
        });
        btn.classList.add("active");
        if (lastData && lastData.worktrees) {
          lastData.worktrees.forEach(function (wt) {
            wt.scmActive = wt.path === path;
          });
        }
        send("scopeScm", { path: path || undefined });
        return;
      }
      // Stop one debug session by its VS Code session id. The row is removed by
      // the extension's terminate event, not here, so a session that refuses to
      // die keeps its stop button.
      if (action === "stopDebug") {
        send("stopDebug", {
          debugId: btn.getAttribute("data-debug") || undefined,
        });
        return;
      }
      send(action, {
        path: btn.getAttribute("data-path") || undefined,
        sessionId: btn.getAttribute("data-session") || undefined,
      });
      return;
    }
    // The expand toggle: the Agents bar in the comfortable layout, the card
    // header itself in the compact one. Both carry data-toggle. Controls inside
    // the header are excluded — the GitHub link is a plain anchor the webview
    // lets through to the browser, so it never reaches the data-action branch
    // above and would otherwise toggle the card on its way out.
    const bar = e.target.closest("[data-toggle]");
    if (bar && !e.target.closest("a, button"))
      toggle(bar.getAttribute("data-toggle"));
  });

  root.addEventListener("change", (e) => {
    if (e.target && e.target.id === "gh-enable") {
      send("togglePr", { value: !!e.target.checked });
    } else if (e.target && e.target.id === "scm-enable") {
      send("toggleScm", { value: !!e.target.checked });
    } else if (e.target && e.target.id === "debug-trace") {
      send("toggleTrace", { value: !!e.target.checked });
    } else if (e.target && e.target.id === "poll-seconds") {
      send("setPollSeconds", { seconds: Number(e.target.value) });
    } else if (e.target && e.target.getAttribute("data-perf")) {
      // Each git accelerator has its own switch, so one can be turned off without
      // touching the other. The extension re-reads the repo's config and posts
      // the result, which is what re-renders these; a write that fails therefore
      // springs the switch back on its own.
      send("setGitPerf", {
        perfKey: e.target.getAttribute("data-perf"),
        value: !!e.target.checked,
      });
    } else if (e.target && e.target.id === "branches-prune") {
      // Remember the Prune choice for the next fetch; the value is read live when
      // Fetch is clicked, so no re-render is needed here.
      branchFilters.prune = !!e.target.checked;
      persist();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (VIEW === "branches") {
      // The branches tab is closed via the editor tab itself; Escape only
      // dismisses an open filter/sort menu.
      if (openMenu) {
        openMenu = "";
        renderBranches();
      }
      return;
    }
    if (settingsOpen) {
      closeSettings();
      return;
    }
    if (modalEl) {
      closeModal();
      return;
    }
  });

  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    // Not when a control inside the header has focus: the compact header holds
    // the New agent button, and a button fires its own click on Enter/Space.
    const bar = e.target.closest("[data-toggle]");
    if (bar && !e.target.closest("button, a")) {
      e.preventDefault();
      toggle(bar.getAttribute("data-toggle"));
      return;
    }
    // Activate a focused agent (or subagent) row — both reveal a terminal, and
    // a subagent's is its parent's. Not when a child button has focus: buttons
    // fire their own click on Enter/Space.
    if (e.target.matches && e.target.matches(".agent-row, .subagent-row")) {
      e.preventDefault();
      send("focusAgent", {
        sessionId: e.target.getAttribute("data-session") || undefined,
      });
    }
  });

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (!msg) return;
    if (VIEW === "branches") {
      // The branches editor tab only consumes its own payload. A stray
      // {type:"update"} (it should never arrive here) is ignored, not rendered.
      if (msg.type === "branches") {
        // Fresh branch + PR payload. The extension re-posts this on every poll
        // (worktree/git changes), so skip the re-render when nothing the view
        // depends on actually changed — only a real change is worth rebuilding
        // the DOM (mirrors the settings view's ghSig dedupe). This is what keeps
        // a background poll from disturbing the user's scroll position.
        const sig = JSON.stringify(msg.data);
        const changed = sig !== lastBranchSig;
        lastBranchSig = sig;
        branchData = msg.data;
        branchesLoading = false;
        // A changed payload rebuilds the DOM (restoring real icons over any
        // spinners). When it is unchanged (a no-op fetch/refresh) re-render only
        // if a spinner is pending, so the button drops its spinner without making
        // background polls churn the DOM; renderBranches preserves scroll.
        if (changed || root.querySelector(".busy")) renderBranches();
      }
      return;
    }
    // Sidebar. Ignore any {type:"branches"} meant for the branches tab.
    if (msg.type === "update") {
      activeSessionId = (msg.data && msg.data.activeSessionId) || "";
      render(msg.data);
      maybeRefreshSettings(msg.data);
    } else if (msg.type === "activeTerminal") {
      // Terminal switch: retint the rows in place — no full re-render, so an
      // open menu/modal or the scroll position is never disturbed.
      activeSessionId = msg.sessionId || "";
      applyActiveTerminal();
    } else if (msg.type === "openSettings") {
      openSettings();
    } else if (msg.type === "visibility") {
      // The extension tells us, because we cannot see it: the panel's iframe is
      // display:none when the view is hidden, and an iframe's document.hidden
      // follows the window rather than its own CSS, so it stays false. Only the
      // elapsed-time tick cares (see tickAges).
      panelVisible = msg.visible !== false;
    }
  });

  /** Sync the .terminal-open classes to activeSessionId without re-rendering.
   *  The chips are always in the markup and CSS-gated, so this is pure class
   *  toggling on the existing DOM. */
  function applyActiveTerminal() {
    const rows = root.querySelectorAll(".agent-row[data-session]");
    let activeRow = null;
    rows.forEach((row) => {
      const on =
        !!activeSessionId &&
        row.getAttribute("data-session") === activeSessionId;
      row.classList.toggle("terminal-open", on);
      if (on) activeRow = row;
    });
    // The card-level marker lives on the Agents bar in the comfortable layout
    // and on the card header in the compact one; only one of the two exists.
    root
      .querySelectorAll(".agents-bar.terminal-open, .card-head.terminal-open")
      .forEach((bar) => bar.classList.remove("terminal-open"));
    const card = activeRow && activeRow.closest(".card");
    const bar = card && card.querySelector(".agents-bar, .card-head");
    if (bar) bar.classList.add("terminal-open");
  }

  // --- Custom hover tooltip --------------------------------------------------
  // Native `title` tooltips have a long, browser-fixed delay. For the agent
  // summary we want a snappier one, so elements carry `data-tip` and we render
  // our own tooltip on document.body (no clipping by card overflow) after 200ms.
  const TIP_DELAY = 200;
  let tipEl = null;
  let tipTimer = null;

  function hideTip() {
    if (tipTimer) {
      clearTimeout(tipTimer);
      tipTimer = null;
    }
    if (tipEl) {
      tipEl.remove();
      tipEl = null;
    }
  }

  function showTip(target) {
    const text = target.getAttribute("data-tip");
    if (!text) return;
    if (tipEl) tipEl.remove();
    const el = document.createElement("div");
    el.className = "tip";
    el.textContent = text;
    document.body.appendChild(el);
    // Position above the element, centered, clamped to the viewport; flip below
    // when there isn't room above.
    const r = target.getBoundingClientRect();
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(4, Math.min(left, window.innerWidth - tw - 4));
    let top = r.top - th - 6;
    if (top < 4) top = r.bottom + 6;
    el.style.left = left + "px";
    el.style.top = top + "px";
    tipEl = el;
  }

  root.addEventListener("mouseover", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) return;
    if (tipTimer) clearTimeout(tipTimer);
    tipTimer = setTimeout(() => showTip(t), TIP_DELAY);
  });
  root.addEventListener("mouseout", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) return;
    // Ignore moves to a child of the same tipped element.
    if (e.relatedTarget && t.contains(e.relatedTarget)) return;
    hideTip();
  });
  // Scrolling moves the anchor out from under a fixed tooltip; just drop it.
  root.addEventListener("scroll", hideTip, true);

  // Mount. The branches editor tab requests its own data; the sidebar asks for
  // a refresh in case it mounted after the first push.
  if (VIEW === "branches") {
    mountBranches();
  } else {
    send("refresh");
  }
})();
