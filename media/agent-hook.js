#!/usr/bin/env node
// Claude Code hook reporter for the Worktree View extension.
//
// Configured (via `claude --settings`) to run on lifecycle events. It maps the
// event to an agent status and POSTs it to the extension's localhost listener.
// Identity and endpoint are passed through the environment when the extension
// spawns the agent terminal:
//   WT_AGENT_ID     - the agent this terminal belongs to
//   WT_AGENT_PORT   - port of the extension's status listener
//   WT_AGENT_TOKEN  - shared secret guarding the listener
//
// The desired status is passed as argv[2]. The hook's JSON payload arrives on
// stdin; we drain it but only need the event for the "waiting" message.
"use strict";

const http = require("http");

const status = process.argv[2] || "idle";
const id = process.env.WT_AGENT_ID;
const port = process.env.WT_AGENT_PORT;
const token = process.env.WT_AGENT_TOKEN;

// Always exit cleanly and promptly; a hook must never block or fail the agent.
function done() {
  process.exit(0);
}

if (!id || !port || !token) done();

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => report(parseEvent(raw)));
process.stdin.on("error", () => report(undefined));
// Guard against an stdin that never closes.
setTimeout(() => report(parseEvent(raw)), 500);

function parseEvent(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

let sent = false;
function report(event) {
  if (sent) return;
  sent = true;

  const body = JSON.stringify({
    id: Number(id),
    status,
    token,
    // Surface the notification text so the panel can show why an agent waits.
    message: event && event.message ? String(event.message) : undefined,
  });

  const req = http.request(
    {
      host: "127.0.0.1",
      port: Number(port),
      path: "/status",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
      timeout: 400,
    },
    (res) => {
      res.resume();
      res.on("end", done);
    }
  );
  req.on("error", done);
  req.on("timeout", () => req.destroy());
  req.end(body);
}
