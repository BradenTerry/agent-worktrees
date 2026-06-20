// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");

  /** Inline codicon-ish SVGs so we stay dependency-free. */
  const icons = {
    add: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 3v10M3 8h10"/></svg>',
    remove:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 8h10"/></svg>',
    chevron:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 4l4 4-4 4"/></svg>',
    sparkle:
      '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l1.3 3.7L13 6l-3.7 1.3L8 11 6.7 7.3 3 6l3.7-1.3z"/></svg>',
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
    edit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M11 2l3 3-7 7-3.5.5.5-3.5z"/></svg>',
    window:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1.5" y="3" width="13" height="10" rx="1.2"/><path d="M1.5 6h13"/></svg>',
    skill:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 2l5 2.5L8 7 3 4.5 8 2zM3 8l5 2.5L13 8M3 11.5L8 14l5-2.5"/></svg>',
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
  };

  // Worktree paths whose agent list is expanded, persisted so re-renders keep
  // the toggle state. Cards start collapsed: the Agents bar shows the counts and
  // reveals the rows on click.
  const expanded = new Set((vscode.getState() || {}).expanded || []);
  function persist() {
    vscode.setState({ expanded: Array.from(expanded) });
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

  /** Compact relative time, e.g. "just now", "3m", "2h". */
  function rel(ts) {
    if (!ts) return "";
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 10) return "just now";
    if (s < 60) return s + "s";
    const m = Math.round(s / 60);
    if (m < 60) return m + "m";
    return Math.round(m / 60) + "h";
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

  /** Per-agent secondary text, derived from status and timestamps. */
  function agentMeta(a) {
    const s = statusOf(a);
    if (s === "active") return "running · " + rel(a.startedAt);
    if (s === "waiting") return "needs input";
    if (a.lastActivity && a.lastActivity - a.startedAt > 1500) {
      return "done · " + rel(a.lastActivity);
    }
    return "idle";
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
          // Full, untruncated text for the hover tooltip: the work summary, with
          // the user-given name as a prefix when one is set. The label in the row
          // is clipped with an ellipsis, so this is how you read the whole thing.
          const fullInfo = a.summary
            ? a.name
              ? a.name + " — " + a.summary
              : a.summary
            : a.label;
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
            '<span class="agent-meta">' +
            esc(agentMeta(a)) +
            "</span>" +
            skillChip +
            '<span class="row-actions">' +
            '<button class="iconbtn" data-action="rename" data-session="' +
            esc(a.sessionId) +
            '" title="Rename agent">' +
            icons.edit +
            "</button>" +
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
    for (const a of agents) counts[statusOf(a)]++;

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
      '<span class="agents-bar-stats">' +
      stat("active") +
      stat("waiting") +
      stat("idle") +
      "</span>" +
      "</div>"
    );
  }

  /** Git working-tree summary line: diff totals and ahead/behind. */
  function gitLine(g, path) {
    // Scope the Source Control view to this worktree. Opt-in (Settings →
    // Integrations); sits to the left of the diff totals when enabled.
    const scopeBtn =
      lastData && lastData.scmEnabled
        ? '<button class="iconbtn scm-scope" data-action="scopeScm" data-path="' +
          esc(path) +
          '" title="Show only this worktree in Source Control">' +
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
   * One-line PR summary for a worktree branch: state + number, CI rollup, review
   * decision and comment count, the whole row linking out to the PR. Rendered
   * only when PR data is present (the integration is on and a PR exists).
   */
  function prLine(pr) {
    if (!pr) return "";
    const st = PR_STATE[pr.state] || PR_STATE.open;
    const segs = [];

    segs.push(
      '<span class="pr-state ' +
        st.cls +
        '">' +
        st.label +
        " #" +
        pr.number +
        "</span>"
    );

    // CI checks: one colored, counted segment per non-zero state (passing,
    // failing, running) so the whole rollup is visible at a glance.
    if (pr.checks && pr.checks !== "none") {
      const pass = pr.checksPass || 0;
      const fail = pr.checksFail || 0;
      const pending = pr.checksPending || 0;
      const total = pass + fail + pending;
      const plural = (n) => (n === 1 ? "" : "s");
      if (pass)
        segs.push(
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
        segs.push(
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
        segs.push(
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

    // Review decision.
    if (pr.review === "approved")
      segs.push(
        '<span class="pr-seg approved" title="Approved">' +
          icons.check +
          (pr.approvals ? pr.approvals : "") +
          "</span>"
      );
    else if (pr.review === "changes")
      segs.push(
        '<span class="pr-seg changes" title="Changes requested">' +
          icons.cross +
          "</span>"
      );
    else if (pr.review === "required")
      segs.push(
        '<span class="pr-seg required" title="Review requested">@</span>'
      );

    if (pr.comments)
      segs.push(
        '<span class="pr-seg comments" title="' +
          pr.comments +
          ' comment(s)">' +
          icons.comment +
          pr.comments +
          "</span>"
      );

    return (
      '<a class="prline" href="' +
      esc(pr.url) +
      '" title="' +
      esc(pr.title) +
      ' — open on GitHub">' +
      '<span class="pr-ico">' +
      icons.pr +
      "</span>" +
      segs.join("") +
      '<span class="pr-open">' +
      icons.external +
      "</span>" +
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
      icons.sparkle +
      "Agent</button>";

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
      gitLine(wt.git, wt.path) +
      '<span class="actions-spacer"></span>' +
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
    const wts = data.worktrees || [];
    const cards = wts.map(card).join("");
    root.innerHTML =
      toolbar(data) +
      '<div class="cards">' +
      (cards || '<div class="empty">No worktrees found.</div>') +
      "</div>";
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
      label: "Integrations",
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
      "<li>Commit statuses</li>" +
      "<li>Checks</li>" +
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

  // Keep relative times fresh without round-tripping to the extension.
  setInterval(() => {
    if (lastData) render(lastData);
  }, 30000);

  // Ask for data in case we mounted after the first push.
  send("refresh");
})();
