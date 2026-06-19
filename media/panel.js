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
  };

  // Collapsed worktree paths, persisted so re-renders keep the toggle state.
  const collapsed = new Set((vscode.getState() || {}).collapsed || []);
  function persist() {
    vscode.setState({ collapsed: Array.from(collapsed) });
  }

  function esc(s) {
    return String(s).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );
  }

  function send(action, path) {
    vscode.postMessage({ type: "action", action, path });
  }

  function agentRows(agents) {
    if (!agents || !agents.length) {
      return '<div class="agents-empty">No agents yet. Use “Agent” to start one.</div>';
    }
    return (
      '<div class="agents">' +
      agents
        .map(
          (a) =>
            '<div class="agent-row">' +
            '<span class="status-dot ' +
            statusOf(a) +
            '"></span>' +
            '<span class="agent-label">' +
            esc(a.label) +
            "</span>" +
            '<span class="agent-status">' +
            STATUS[statusOf(a)].label +
            "</span>" +
            "</div>"
        )
        .join("") +
      "</div>"
    );
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

  /**
   * Aggregate stat strip: total + a colored marker and count per status.
   * Zero-count statuses are dimmed so the row reads at a glance.
   */
  function statusStrip(agents) {
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
      '<div class="status-strip">' +
      '<span class="stat total" title="Total agents">' +
      agents.length +
      "<span class='stat-label'>agents</span></span>" +
      '<span class="stat-sep"></span>' +
      stat("active") +
      stat("waiting") +
      stat("idle") +
      "</div>"
    );
  }

  function card(wt) {
    const isCollapsed = collapsed.has(wt.path);
    const badges = [];
    if (wt.isPrimary) badges.push('<span class="badge">primary</span>');
    if (wt.detached) badges.push('<span class="badge warn">detached</span>');
    if (wt.locked) badges.push('<span class="badge warn">locked</span>');

    const agents = wt.agents || [];

    const canRemove = wt.inWorkspace && !wt.isPrimary;
    const openBtn = wt.inWorkspace
      ? '<button class="act" data-action="remove" data-path="' +
        esc(wt.path) +
        '"' +
        (canRemove ? "" : " disabled") +
        ">" +
        icons.remove +
        "Remove</button>"
      : '<button class="act primary" data-action="open" data-path="' +
        esc(wt.path) +
        '">' +
        icons.add +
        "Open</button>";

    return (
      '<div class="card' +
      (wt.inWorkspace ? " open" : "") +
      (isCollapsed ? " collapsed" : "") +
      '">' +
      '<div class="card-top" data-toggle="' +
      esc(wt.path) +
      '" role="button" tabindex="0">' +
      '<span class="chevron">' +
      icons.chevron +
      "</span>" +
      '<span class="dot"></span>' +
      '<span class="branch">' +
      esc(wt.name) +
      "</span>" +
      '<span class="badges">' +
      badges.join("") +
      "</span>" +
      "</div>" +
      statusStrip(agents) +
      '<div class="actions">' +
      openBtn +
      '<button class="act agent" data-action="agent" data-path="' +
      esc(wt.path) +
      '" title="Start a Claude CLI session in this worktree">' +
      icons.add +
      "Agent</button>" +
      "</div>" +
      '<div class="card-body">' +
      agentRows(agents) +
      "</div>" +
      "</div>"
    );
  }

  function render(data) {
    if (!data || !data.repoRoot) {
      root.innerHTML =
        '<div class="empty">No git repository in this window.<br/>Open a folder that is a git repository to see its worktrees.</div>';
      return;
    }
    const wts = data.worktrees || [];
    const head =
      '<div class="repo-head"><span>' +
      esc(data.repoName || "Repository") +
      '</span><span class="count">' +
      wts.length +
      (wts.length === 1 ? " worktree" : " worktrees") +
      "</span></div>";

    const cards = wts.map(card).join("");

    root.innerHTML =
      head + (cards || '<div class="empty">No worktrees found.</div>');
  }

  function toggle(path) {
    if (collapsed.has(path)) collapsed.delete(path);
    else collapsed.add(path);
    persist();
    const el = root.querySelector('[data-toggle="' + cssEscape(path) + '"]');
    if (el && el.parentElement) el.parentElement.classList.toggle("collapsed");
  }

  // Minimal attribute-selector escaping for paths in querySelector.
  function cssEscape(s) {
    return String(s).replace(/["\\]/g, "\\$&");
  }

  root.addEventListener("click", (e) => {
    const btn = e.target.closest("button.act");
    if (btn) {
      send(btn.getAttribute("data-action"), btn.getAttribute("data-path"));
      return;
    }
    const header = e.target.closest(".card-top");
    if (header) toggle(header.getAttribute("data-toggle"));
  });

  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const header = e.target.closest(".card-top");
    if (!header) return;
    e.preventDefault();
    toggle(header.getAttribute("data-toggle"));
  });

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg && msg.type === "update") render(msg.data);
  });

  // Ask for data in case we mounted after the first push.
  send("refresh");
})();
