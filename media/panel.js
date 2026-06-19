// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");

  /** Inline codicon-ish SVGs so we stay dependency-free. */
  const icons = {
    add: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 3v10M3 8h10"/></svg>',
    remove:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 8h10"/></svg>',
    terminal:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 4l4 4-4 4M8 12h5"/></svg>',
    reveal:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 2H13a1 1 0 0 1 1 1v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z"/></svg>',
  };

  function esc(s) {
    return String(s).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );
  }

  function send(action, path) {
    vscode.postMessage({ type: "action", action, path });
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

    const cards = wts
      .map((wt) => {
        const badges = [];
        if (wt.isPrimary) badges.push('<span class="badge">primary</span>');
        if (wt.detached)
          badges.push('<span class="badge warn">detached</span>');
        if (wt.locked) badges.push('<span class="badge warn">locked</span>');

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
          '">' +
          '<div class="card-top">' +
          '<span class="dot"></span>' +
          '<span class="branch">' +
          esc(wt.name) +
          "</span>" +
          '<span class="badges">' +
          badges.join("") +
          "</span>" +
          "</div>" +
          '<div class="path">' +
          esc(wt.path) +
          "</div>" +
          '<div class="actions">' +
          openBtn +
          '<button class="act" data-action="terminal" data-path="' +
          esc(wt.path) +
          '">' +
          icons.terminal +
          "Terminal</button>" +
          '<button class="act" data-action="reveal" data-path="' +
          esc(wt.path) +
          '">' +
          icons.reveal +
          "Reveal</button>" +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    root.innerHTML =
      head + (cards || '<div class="empty">No worktrees found.</div>');
  }

  root.addEventListener("click", (e) => {
    const btn = e.target.closest("button.act");
    if (!btn) return;
    send(btn.getAttribute("data-action"), btn.getAttribute("data-path"));
  });

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg && msg.type === "update") render(msg.data);
  });

  // Ask for data in case we mounted after the first push.
  send("refresh");
})();
