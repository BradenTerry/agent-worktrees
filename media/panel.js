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
          return (
            '<div class="agent-row' +
            (s === "waiting" ? " attention" : "") +
            '" data-action="focusAgent" data-session="' +
            esc(a.sessionId) +
            '" role="button" tabindex="0" title="Click to reveal terminal">' +
            '<span class="status-dot ' +
            s +
            '"></span>' +
            '<span class="agent-label">' +
            esc(a.label) +
            "</span>" +
            '<span class="agent-meta">' +
            esc(agentMeta(a)) +
            "</span>" +
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

  /** Git working-tree summary line: dirty/clean and ahead/behind. */
  function gitLine(g) {
    if (!g) return "";
    const segs = [];
    segs.push(
      g.dirty
        ? '<span class="seg dirty"><span class="gdot"></span>' +
            g.dirty +
            (g.dirty === 1 ? " change" : " changes") +
            "</span>"
        : '<span class="seg clean">✓ clean</span>'
    );
    if (g.ahead) segs.push('<span class="seg">↑' + g.ahead + "</span>");
    if (g.behind) segs.push('<span class="seg">↓' + g.behind + "</span>");
    return '<div class="gitline">' + segs.join("") + "</div>";
  }

  function card(wt) {
    const isCollapsed = !expanded.has(wt.path);
    const badges = [];
    if (wt.detached) badges.push('<span class="badge warn">detached</span>');
    if (wt.locked) badges.push('<span class="badge warn">locked</span>');

    const agents = wt.agents || [];

    const agentBtn =
      '<button class="act agent" data-action="agent" data-path="' +
      esc(wt.path) +
      '" title="Start a Claude session in this worktree">' +
      icons.sparkle +
      "New Agent</button>";

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
      '<span class="dot"></span>' +
      '<span class="branch">' +
      esc(wt.name) +
      "</span>" +
      '<span class="badges">' +
      badges.join("") +
      "</span>" +
      deleteBtn +
      "</div>" +
      '<div class="meta-row">' +
      gitLine(wt.git) +
      '<span class="actions-spacer"></span>' +
      agentBtn +
      "</div>" +
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
      '<button class="tbtn" data-action="agentWorktree" title="Create a worktree with Claude (claude -w) and start an agent in it">' +
      icons.sparkle +
      "Agent &amp; Worktree</button>" +
      '<button class="tbtn ghost" data-tool="collapseAll" title="Collapse all">' +
      icons.collapse +
      "</button>" +
      '<button class="tbtn ghost" data-action="refresh" title="Refresh">' +
      icons.refresh +
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
      (cards || '<div class="empty">No worktrees found.</div>');
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

  root.addEventListener("click", (e) => {
    const tool = e.target.closest("[data-tool='collapseAll']");
    if (tool) {
      collapseAll();
      return;
    }
    const btn = e.target.closest("[data-action]");
    if (btn) {
      e.stopPropagation();
      send(btn.getAttribute("data-action"), {
        path: btn.getAttribute("data-path") || undefined,
        sessionId: btn.getAttribute("data-session") || undefined,
      });
      return;
    }
    const bar = e.target.closest(".agents-bar");
    if (bar) toggle(bar.getAttribute("data-toggle"));
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
    if (msg && msg.type === "update") render(msg.data);
  });

  // Keep relative times fresh without round-tripping to the extension.
  setInterval(() => {
    if (lastData) render(lastData);
  }, 30000);

  // Ask for data in case we mounted after the first push.
  send("refresh");
})();
