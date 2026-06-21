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
    trash:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 4h10M6 4V3h4v1M5 4l.5 9h5L11 4"/></svg>',
    refresh:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M13 8a5 5 0 1 1-1.5-3.5M13 3v2.5h-2.5"/></svg>',
    collapse:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M5 6l3-3 3 3M5 10l3 3 3-3"/></svg>',
    window:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1.5" y="3" width="13" height="10" rx="1.2"/><path d="M1.5 6h13"/></svg>',
    skill:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 2l5 2.5L8 7 3 4.5 8 2zM3 8l5 2.5L13 8M3 11.5L8 14l5-2.5"/></svg>',
    robot:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.4V2"/><circle cx="8" cy="1.6" r="0.6" fill="currentColor"/><rect x="3" y="4" width="10" height="8" rx="2"/><path d="M3 8H1.6M14.4 8H13"/><circle cx="6" cy="8" r="0.9" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r="0.9" fill="currentColor" stroke="none"/></svg>',
    gear: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5L3.4 3.4"/></svg>',
    pr: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="4" cy="3.5" r="1.6"/><circle cx="4" cy="12.5" r="1.6"/><circle cx="12" cy="12.5" r="1.6"/><path d="M4 5.1v5.8M12 11V7a2.5 2.5 0 0 0-2.5-2.5H7M9 2.5L7 4.5l2 2"/></svg>',
    branch:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="5" cy="3.5" r="1.5"/><circle cx="5" cy="12.5" r="1.5"/><circle cx="11" cy="5" r="1.5"/><path d="M5 5v6"/><path d="M11 6.5c0 3-3 2.7-6 2.7"/></svg>',
    check:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3.5 8.5l3 3 6-6.5"/></svg>',
    cross:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    dot: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="3.2"/></svg>',
    comment:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>',
    external:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h4v4"/><path d="M13 3L7.5 8.5"/><path d="M11 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3"/></svg>',
    behind:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v7M5 6.5l3 3 3-3"/><path d="M3.5 13.5h9"/></svg>',
    autoMerge:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="3.5" r="1.5"/><circle cx="4" cy="12.5" r="1.5"/><circle cx="12" cy="6" r="1.5"/><path d="M4 5v6"/><path d="M11.7 7.4C11 10 7 9.5 4 9.5"/></svg>',
  };

  // Worktree paths whose agent list is expanded, persisted so re-renders keep
  // the toggle state. Cards start collapsed: the Agents bar shows the counts and
  // reveals the rows on click.
  const expanded = new Set((vscode.getState() || {}).expanded || []);

  // Branches-overlay filter/sort selections, persisted alongside `expanded` so
  // reopening the overlay restores the last view. `authors` is a list of logins
  // (multi-select); `reviews` is one of the REVIEW_FILTERS keys or ""; `sort` is
  // one of the SORT_OPTIONS keys.
  const savedState = vscode.getState() || {};
  const branchFilters = {
    authors: Array.isArray(savedState.branchAuthors)
      ? savedState.branchAuthors.slice()
      : [],
    reviews:
      typeof savedState.branchReviews === "string"
        ? savedState.branchReviews
        : "",
    assignedToYou: savedState.branchAssignedToYou === true,
    sort:
      typeof savedState.branchSort === "string" ? savedState.branchSort : "newest",
  };
  function persist() {
    vscode.setState({
      expanded: Array.from(expanded),
      branchAuthors: branchFilters.authors.slice(),
      branchReviews: branchFilters.reviews,
      branchAssignedToYou: branchFilters.assignedToYou,
      branchSort: branchFilters.sort,
    });
  }

  // Last data we rendered, so the relative-time tick can re-render in place.
  let lastData = null;

  function esc(s) {
    return String(s).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );
  }

  function send(action, extra) {
    vscode.postMessage(Object.assign({ type: "action", action }, extra || {}));
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

  function agentRows(agents) {
    if (!agents || !agents.length) {
      return '<div class="agents-empty">No agents yet. Use “New Agent” to start one.</div>';
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
          const subs = a.subagents || 0;
          const subChip = subs
            ? '<span class="subagent-chip" title="' +
              subs +
              " subagent" +
              (subs === 1 ? "" : "s") +
              ' used">' +
              icons.robot +
              subs +
              "</span>"
            : "";
          return (
            '<div class="agent-row' +
            (s === "waiting" ? " attention" : "") +
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
            subChip +
            skillChip +
            '<span class="row-actions">' +
            '<button class="iconbtn" data-action="stopAgent" data-session="' +
            esc(a.sessionId) +
            '" title="Stop agent">' +
            icons.stop +
            "</button>" +
            "</span>" +
            "</div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  /**
   * Collapsible "Agents" bar at the bottom of a card: it toggles the agent list
   * and carries the per-status counts. Zero-count statuses are dimmed so the row
   * reads at a glance.
   */
  function agentsBar(agents, path) {
    const counts = { active: 0, waiting: 0, idle: 0 };
    let subTotal = 0;
    for (const a of agents) {
      counts[statusOf(a)]++;
      subTotal += a.subagents || 0;
    }

    const subStat = subTotal
      ? '<span class="agents-bar-subagents" title="' +
        subTotal +
        " subagent" +
        (subTotal === 1 ? "" : "s") +
        ' used in this worktree">' +
        icons.robot +
        subTotal +
        "</span>"
      : "";

    const stat = (key) =>
      '<span class="stat ' +
      key +
      (counts[key] ? "" : " zero") +
      '" title="' +
      STATUS[key].label +
      '"><span class="status-dot ' +
      key +
      '"></span>' +
      counts[key] +
      "</span>";

    return (
      '<div class="agents-bar" data-toggle="' +
      esc(path) +
      '" role="button" tabindex="0">' +
      '<span class="chevron">' +
      icons.chevron +
      "</span>" +
      '<span class="agents-bar-label">Agents</span>' +
      '<span class="agents-bar-count">' +
      agents.length +
      "</span>" +
      subStat +
      '<span class="agents-bar-stats">' +
      stat("active") +
      stat("waiting") +
      stat("idle") +
      "</span>" +
      "</div>"
    );
  }

  /** Git working-tree summary line: diff totals and ahead/behind. */
  function gitLine(g, path, scmActive) {
    // Scope the Source Control view to this worktree. Opt-in (Settings →
    // Integrations); sits to the left of the diff totals when enabled. The
    // active state marks the worktree whose repo is currently shown in Source
    // Control (the scope is already set).
    const scopeBtn =
      lastData && lastData.scmEnabled
        ? '<button class="iconbtn scm-scope' +
          (scmActive ? " active" : "") +
          '" data-action="scopeScm" data-path="' +
          esc(path) +
          '" title="' +
          (scmActive
            ? "Showing in Source Control. Click to re-scope to this worktree."
            : "Show only this worktree in Source Control") +
          '">' +
          icons.branch +
          "</button>"
        : "";
    if (!g) return scopeBtn ? '<div class="gitline">' + scopeBtn + "</div>" : "";
    const segs = [];
    if (g.dirty)
      segs.push(
        '<span class="seg dirty"><span class="gdot"></span>' +
          g.dirty +
          (g.dirty === 1 ? " change" : " changes") +
          "</span>"
      );
    if (g.insertions || g.deletions) {
      segs.push('<span class="seg ins">+' + (g.insertions || 0) + "</span>");
      segs.push('<span class="seg del">−' + (g.deletions || 0) + "</span>");
    } else {
      segs.push('<span class="seg none">+/- 0</span>');
    }
    segs.push(
      '<span class="seg ahead" title="Commits to push">↑' +
        (g.ahead || 0) +
        "</span>"
    );
    segs.push(
      '<span class="seg behind" title="Commits to pull">↓' +
        (g.behind || 0) +
        "</span>"
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
   * exists).
   */
  function prLine(pr) {
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
          ' pending">@' +
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

    const rows = [
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
        "</div>",
    ];
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

    return (
      '<a class="prline" href="' +
      esc(pr.url) +
      '" title="' +
      esc(pr.title) +
      ' — open on GitHub">' +
      rows.join("") +
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

    const agentBtn =
      '<button class="act agent" data-action="agent" data-path="' +
      esc(wt.path) +
      '" title="Start a Claude session in this worktree">' +
      '<span class="agent-plus">+</span>' +
      icons.agentMark +
      "</button>";

    // Open this worktree in its own VS Code window (focuses an existing one if
    // already open). Available for every worktree, including the primary.
    const openWindowBtn =
      '<button class="act ghost iconact" data-action="openWindow" data-path="' +
      esc(wt.path) +
      '" title="Open this worktree in a new VS Code window">' +
      icons.window +
      "</button>";

    // Delete (git worktree remove) — never for the primary worktree.
    const deleteBtn = wt.isPrimary
      ? ""
      : '<button class="act ghost danger" data-action="removeWorktree" data-path="' +
        esc(wt.path) +
        '" title="Delete this worktree from disk">' +
        icons.trash +
        "</button>";

    return (
      '<div class="card' +
      (wt.inWorkspace ? " open" : "") +
      (isCollapsed ? " collapsed" : "") +
      '">' +
      '<div class="card-top">' +
      '<span class="branch">' +
      esc(wt.name) +
      "</span>" +
      '<span class="badges">' +
      badges.join("") +
      "</span>" +
      openWindowBtn +
      deleteBtn +
      "</div>" +
      '<hr class="card-sep" />' +
      '<div class="meta-row">' +
      gitLine(wt.git, wt.path, wt.scmActive) +
      "</div>" +
      '<div class="agent-action-row">' +
      agentBtn +
      "</div>" +
      prLine(wt.pr) +
      agentsBar(agents, wt.path) +
      '<div class="card-body">' +
      agentRows(agents) +
      "</div>" +
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
      '<button class="tbtn icon" data-action="agentWorktree" title="New Agent &amp; Worktree: create a worktree with Claude (claude -w) and start an agent in it">' +
      icons.agentWorktree +
      "</button>" +
      '<button class="tbtn ghost" data-action="openBranches" title="Branches: list every branch and create a worktree from one">' +
      icons.branch +
      "</button>" +
      '<button class="tbtn ghost" data-tool="collapseAll" title="Collapse all">' +
      icons.collapse +
      "</button>" +
      "</span>" +
      "</div>"
    );
  }

  function renderConsent(data) {
    const hooks = data.hooks || [];
    const rows = hooks
      .map(
        (h) =>
          '<li class="hook"><code class="hook-name">' +
          esc(h.label) +
          "</code><span class='hook-why'>" +
          esc(h.description) +
          "</span></li>"
      )
      .join("");

    root.innerHTML =
      '<div class="consent">' +
      '<h2 class="consent-title">Enable agent status tracking</h2>' +
      '<p class="consent-lead">Agent Worktrees reads Claude Code hook events to show whether each ' +
      "agent is <b>active</b>, <b>waiting</b> on you, or <b>idle</b>. To do that it must add the " +
      "hooks below to your global Claude settings file:</p>" +
      '<p class="consent-path"><code>~/.claude/settings.json</code></p>' +
      '<ul class="hooks">' +
      rows +
      "</ul>" +
      '<p class="consent-note">Each hook runs a small bundled Node script that writes a status ' +
      "file per session. Nothing is sent anywhere. You can remove the hooks anytime by editing that file.</p>" +
      '<button class="accept primary" data-action="acceptHooks">Accept &amp; add hooks</button>' +
      "</div>";
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
    if (data && data.hooksInstalled === false) {
      renderConsent(data);
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

  function ghSig(data) {
    return JSON.stringify([
      (data && data.github) || null,
      (data && data.prEnabled) !== false,
      (data && data.scmEnabled) === true,
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

    const disconnect = gh.hasToken
      ? '<button class="gh-disconnect" data-gh="disconnect">Disconnect</button>'
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
      tokenField +
      links +
      disconnect +
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
  }

  function saveToken() {
    const input = root.querySelector("#gh-token");
    const token = input && input.value.trim();
    if (!token) return;
    send("setGithubToken", { token });
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

  // Single-select Reviews filter. Each entry maps a PR to a boolean predicate.
  const REVIEW_FILTERS = [
    { id: "none", label: "No reviews", test: (pr) => pr.review === "none" },
    {
      id: "required",
      label: "Review required",
      test: (pr) => pr.review === "required",
    },
    { id: "approved", label: "Approved", test: (pr) => pr.review === "approved" },
    {
      id: "changes",
      label: "Changes requested",
      test: (pr) => pr.review === "changes",
    },
    {
      id: "reviewedByYou",
      label: "Reviewed by you",
      test: (pr) => !!pr.reviewedByViewer,
    },
    {
      id: "notReviewedByYou",
      label: "Not reviewed by you",
      test: (pr) => !pr.reviewedByViewer,
    },
    {
      id: "awaitingYou",
      label: "Awaiting review from you",
      test: (pr) => !!pr.reviewRequestedFromViewer,
    },
  ];

  // Single-select Sort. `prSort` true entries fall back to branch-name order
  // when PR data is unavailable.
  const SORT_OPTIONS = [
    { id: "newest", label: "Newest", prSort: true },
    { id: "oldest", label: "Oldest", prSort: true },
    { id: "mostCommented", label: "Most commented", prSort: true },
    { id: "leastCommented", label: "Least commented", prSort: true },
    { id: "recentlyUpdated", label: "Recently updated", prSort: true },
    { id: "leastRecentlyUpdated", label: "Least recently updated", prSort: true },
  ];

  /** True when the GitHub integration is connected and PR display is enabled. */
  function prAvailable(data) {
    const gh = data && data.github;
    return !!(gh && gh.connected && data.prEnabled !== false);
  }

  /** Any PR-based narrowing active? Used to hide no-PR rows (R16). */
  function prFilterActive() {
    return (
      branchFilters.authors.length > 0 ||
      !!branchFilters.reviews ||
      branchFilters.assignedToYou
    );
  }

  function timeVal(s) {
    const t = s ? Date.parse(s) : NaN;
    return isNaN(t) ? 0 : t;
  }

  /** Apply the active filters + sort to the branch list, client-side. */
  function visibleBranches(data) {
    const all = (data && data.branches) || [];
    const pr = prAvailable(data);
    const sortOpt =
      SORT_OPTIONS.find((s) => s.id === branchFilters.sort) || SORT_OPTIONS[0];
    const reviewFilter = pr
      ? REVIEW_FILTERS.find((r) => r.id === branchFilters.reviews)
      : null;
    const authorSet = pr ? new Set(branchFilters.authors) : new Set();
    const viewer = (data && data.viewerLogin) || "";

    let rows = all.slice();

    if (pr) {
      // While any PR-based filter is active, drop rows with no PR (R16).
      const filterActive = prFilterActive();
      rows = rows.filter((b) => {
        const p = b.pr;
        if (filterActive && !p) return false;
        if (!p) return true;
        if (authorSet.size && !authorSet.has(p.author)) return false;
        if (reviewFilter && !reviewFilter.test(p)) return false;
        if (
          branchFilters.assignedToYou &&
          !(Array.isArray(p.assignees) && p.assignees.indexOf(viewer) !== -1)
        )
          return false;
        return true;
      });
    }

    // Sort. PR sorts need PR data; rows without a PR sort to the end, and when
    // PR data is unavailable entirely we fall back to branch-name order.
    if (pr && sortOpt.prSort) {
      const dir = (a, b) => {
        const pa = a.pr;
        const pb = b.pr;
        if (!pa && !pb) return a.name.localeCompare(b.name);
        if (!pa) return 1;
        if (!pb) return -1;
        switch (sortOpt.id) {
          case "oldest":
            return timeVal(pa.createdAt) - timeVal(pb.createdAt);
          case "mostCommented":
            return (pb.comments || 0) - (pa.comments || 0);
          case "leastCommented":
            return (pa.comments || 0) - (pb.comments || 0);
          case "recentlyUpdated":
            return timeVal(pb.updatedAt) - timeVal(pa.updatedAt);
          case "leastRecentlyUpdated":
            return timeVal(pa.updatedAt) - timeVal(pb.updatedAt);
          case "newest":
          default:
            return timeVal(pb.createdAt) - timeVal(pa.createdAt);
        }
      };
      rows.sort(dir);
    } else {
      rows.sort((a, b) => a.name.localeCompare(b.name));
    }
    return rows;
  }

  /** Distinct PR authors, "you" pinned first (R12). */
  function authorOptions(data) {
    const viewer = (data && data.viewerLogin) || "";
    const seen = new Set();
    const out = [];
    for (const b of (data && data.branches) || []) {
      const a = b.pr && b.pr.author;
      if (a && !seen.has(a)) {
        seen.add(a);
        out.push(a);
      }
    }
    out.sort((a, b) => a.localeCompare(b));
    if (viewer && seen.has(viewer)) {
      return [viewer].concat(out.filter((a) => a !== viewer));
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
    const pr = prAvailable(data);
    const sortOpt =
      SORT_OPTIONS.find((s) => s.id === branchFilters.sort) || SORT_OPTIONS[0];

    let controls = "";

    if (pr) {
      const viewer = (data && data.viewerLogin) || "";
      const authors = authorOptions(data);
      const selected = new Set(branchFilters.authors);
      const authorItems = authors.length
        ? authors
            .map(
              (a) =>
                '<button class="bfilter-item" role="menuitemcheckbox" data-author="' +
                esc(a) +
                '" aria-checked="' +
                selected.has(a) +
                '"><span class="bcheck">' +
                (selected.has(a) ? icons.check : "") +
                "</span>" +
                esc(a) +
                (a === viewer ? ' <span class="bdim">(you)</span>' : "") +
                "</button>"
            )
            .join("")
        : '<div class="bfilter-empty">No PR authors</div>';
      const authorSummary = branchFilters.authors.length
        ? branchFilters.authors.length + " selected"
        : "Any";

      const reviewItems = (
        '<button class="bfilter-item" role="menuitemradio" data-review="" aria-checked="' +
        (!branchFilters.reviews) +
        '"><span class="bcheck">' +
        (!branchFilters.reviews ? icons.check : "") +
        "</span>Any</button>" +
        REVIEW_FILTERS.map(
          (r) =>
            '<button class="bfilter-item" role="menuitemradio" data-review="' +
            r.id +
            '" aria-checked="' +
            (branchFilters.reviews === r.id) +
            '"><span class="bcheck">' +
            (branchFilters.reviews === r.id ? icons.check : "") +
            "</span>" +
            esc(r.label) +
            "</button>"
        ).join("")
      );
      const rf = REVIEW_FILTERS.find((r) => r.id === branchFilters.reviews);
      const reviewSummary = rf ? rf.label : "Any";

      const presets =
        '<div class="bpresets">' +
        '<button class="bchip' +
        (branchFilters.authors.length === 1 &&
        branchFilters.authors[0] === viewer
          ? " on"
          : "") +
        '" data-preset="yourPrs">Your PRs</button>' +
        '<button class="bchip' +
        (branchFilters.reviews === "awaitingYou" ? " on" : "") +
        '" data-preset="awaitingReview">Awaiting your review</button>' +
        '<button class="bchip' +
        (branchFilters.assignedToYou ? " on" : "") +
        '" data-preset="assigned">Assigned to you</button>' +
        "</div>";

      controls =
        menu("author", "Author", authorSummary, authorItems) +
        menu("reviews", "Reviews", reviewSummary, reviewItems) +
        presets;
    }

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

    return (
      '<div class="bfilter-bar">' +
      controls +
      menu("sort", "Sort", sortOpt.label, sortItems) +
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
    const pr = prAvailable(data) ? b.pr : null;
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

    // Ahead/behind vs upstream, shown only for branches that track a remote and
    // are actually diverged (an in-sync row stays uncluttered).
    const segs = [];
    if (b.hasRemote && b.ahead)
      segs.push(
        '<span class="bseg ahead" title="Commits to push">↑' + b.ahead + "</span>"
      );
    if (b.hasRemote && b.behind)
      segs.push(
        '<span class="bseg behind" title="Commits to pull">↓' + b.behind + "</span>"
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
      : '<button class="bcreate primary" data-action="worktreeFromBranch" data-branch="' +
        esc(b.name) +
        '" data-remote="' +
        (b.remoteOnly ? "1" : "0") +
        '" title="Create a worktree for this branch and start a Claude agent in it">' +
        icons.agentMark +
        "Create worktree &amp; start agent</button>";

    // Only branches the signed-in user authored (their PR's author) can be
    // deleted, since git itself carries no branch ownership. When both a local
    // ref and origin/<branch> exist the extension prompts for the scope.
    const mine =
      pr && data && data.viewerLogin && pr.author === data.viewerLogin;
    const deleteBtn = mine
      ? '<button class="bdelete danger" data-action="deleteBranch" data-branch="' +
        esc(b.name) +
        '" data-remote="' +
        (b.remoteOnly ? "1" : "0") +
        '" data-hasremote="' +
        (b.hasRemote ? "1" : "0") +
        '" title="Delete this branch (local and/or remote)">' +
        icons.trash +
        "Delete</button>"
      : "";

    const url = branchUrl(data, b.name);
    const nameLink = url
      ? '<a class="brow-link" href="' +
        esc(url) +
        '" title="View this branch on GitHub" target="_blank" rel="noopener noreferrer">' +
        icons.external +
        "</a>"
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
      '<button class="branches-refresh" data-action="refreshBranches" title="Reload branches">' +
      icons.refresh +
      "</button>" +
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
      else if (kind === "disconnect") send("clearGithubToken");
      return;
    }
    // Settings tab switch (webview-only; no round trip).
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
      const author = e.target.closest("[data-author]");
      if (author) {
        const name = author.getAttribute("data-author");
        const i = branchFilters.authors.indexOf(name);
        if (i === -1) branchFilters.authors.push(name);
        else branchFilters.authors.splice(i, 1);
        branchPage = 0;
        persist();
        renderBranches();
        return;
      }
      const review = e.target.closest("[data-review]");
      if (review) {
        branchFilters.reviews = review.getAttribute("data-review") || "";
        openMenu = "";
        branchPage = 0;
        persist();
        renderBranches();
        return;
      }
      const sort = e.target.closest("[data-sort]");
      if (sort) {
        branchFilters.sort = sort.getAttribute("data-sort") || "newest";
        openMenu = "";
        branchPage = 0;
        persist();
        renderBranches();
        return;
      }
      const preset = e.target.closest("[data-preset]");
      if (preset) {
        const kind = preset.getAttribute("data-preset");
        const viewer = (branchData && branchData.viewerLogin) || "";
        if (kind === "yourPrs") {
          const on =
            branchFilters.authors.length === 1 &&
            branchFilters.authors[0] === viewer;
          branchFilters.authors = on || !viewer ? [] : [viewer];
        } else if (kind === "awaitingReview") {
          branchFilters.reviews =
            branchFilters.reviews === "awaitingYou" ? "" : "awaitingYou";
        } else if (kind === "assigned") {
          branchFilters.assignedToYou = !branchFilters.assignedToYou;
        }
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
      // Delete a user-owned branch; the extension prompts for local/remote/both
      // when both refs exist. Carry which sides exist so it knows what to offer.
      if (action === "deleteBranch") {
        send("deleteBranch", {
          branch: btn.getAttribute("data-branch") || undefined,
          remoteOnly: btn.getAttribute("data-remote") === "1",
          hasRemote: btn.getAttribute("data-hasremote") === "1",
        });
        return;
      }
      send(action, {
        path: btn.getAttribute("data-path") || undefined,
        sessionId: btn.getAttribute("data-session") || undefined,
      });
      return;
    }
    const bar = e.target.closest(".agents-bar");
    if (bar) toggle(bar.getAttribute("data-toggle"));
  });

  root.addEventListener("change", (e) => {
    if (e.target && e.target.id === "gh-enable") {
      send("togglePr", { value: !!e.target.checked });
    } else if (e.target && e.target.id === "scm-enable") {
      send("toggleScm", { value: !!e.target.checked });
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
    const bar = e.target.closest(".agents-bar");
    if (bar) {
      e.preventDefault();
      toggle(bar.getAttribute("data-toggle"));
      return;
    }
    // Activate a focused agent row (but not when a child button has focus —
    // buttons fire their own click on Enter/Space).
    if (e.target.matches && e.target.matches(".agent-row")) {
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
        if (changed) renderBranches();
      }
      return;
    }
    // Sidebar. Ignore any {type:"branches"} meant for the branches tab.
    if (msg.type === "update") {
      render(msg.data);
      maybeRefreshSettings(msg.data);
    } else if (msg.type === "openSettings") {
      openSettings();
    }
  });

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
