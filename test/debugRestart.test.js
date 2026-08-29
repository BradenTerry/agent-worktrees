"use strict";
/**
 * Restarting a debug session the panel started.
 *
 * debugRun.ts is the one debug module that cannot be split away from the vscode
 * API - it is the API calls that are the feature - so `vscode` is stubbed in the
 * require cache before `out/debugRun.js` loads, the same way prsService.test.js
 * does it. The stub is a scriptable fake extension host: launching records the
 * configuration it was handed and fires the session-start event VS Code would,
 * so a restart can be driven end to end and inspected as the card sees it.
 *
 * What is worth pinning down here is that a restart is a *relaunch*: it re-runs
 * the pre-launch task (the reason to restart is the change you just made), it
 * does not re-ask the ${input:...} questions, and the row stays on the card in
 * between so the click is visibly doing something.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const OUT = path.join(__dirname, "..", "out");

// --- stub "vscode" (resolve it to a bare id, then seed the cache) ------------
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "vscode") return "vscode";
  return origResolve.call(this, request, ...rest);
};

/** Everything the fake host recorded, reset per test. */
const host = {
  started: [],
  stopped: [],
  tasks: [],
  prompts: 0,
  warnings: [],
  /** Sessions the fake host considers running, by id. */
  sessions: new Map(),
  /** Next startDebugging outcome. */
  startResult: true,
  /** Whether stopping a session terminates it (a session that will not die
   *  sets this false). */
  stopTerminates: false,
  nextId: 1,
};

const startHandlers = [];
const terminateHandlers = [];
const taskEndHandlers = [];

const sub = (list, h) => {
  list.push(h);
  return {
    dispose() {
      const i = list.indexOf(h);
      if (i >= 0) list.splice(i, 1);
    },
  };
};

const vscodeStub = {
  EventEmitter: class {
    constructor() {
      this.handlers = [];
      this.event = (h) => sub(this.handlers, h);
    }
    fire(v) {
      this.handlers.slice().forEach((h) => h(v));
    }
    dispose() {}
  },
  ThemeIcon: class {
    constructor(id) {
      this.id = id;
    }
  },
  ProgressLocation: { Notification: 15 },
  TaskScope: { Workspace: 1 },
  TaskRevealKind: { Silent: 1 },
  TaskPanelKind: { Dedicated: 2 },
  Task: class {
    constructor(definition, scope, name, source, execution) {
      Object.assign(this, { definition, scope, name, source, execution });
    }
  },
  ShellExecution: class {
    constructor(command, args, options) {
      Object.assign(this, { command, args, options });
    }
  },
  workspace: { workspaceFolders: [] },
  window: {
    createOutputChannel: () => ({ appendLine() {}, show() {} }),
    showWarningMessage: (m) => host.warnings.push(m),
    showErrorMessage: (m) => host.warnings.push(m),
    showInformationMessage: () => {},
    showInputBox: async () => {
      host.prompts++;
      return "fast";
    },
    // Accepts the first item as soon as the pick is shown, which is the
    // "pick a launch configuration, start it with debugging" path.
    createQuickPick: () => {
      const qp = {
        items: [],
        selectedItems: [],
        activeItems: [],
        onDidAccept: (h) => (qp.accept = h),
        onDidTriggerItemButton: () => {},
        onDidHide: (h) => (qp.hidden = h),
        show() {
          qp.selectedItems = [qp.items[0]];
          setTimeout(() => qp.accept(), 0);
        },
        hide() {
          if (qp.hidden) qp.hidden();
        },
        dispose() {},
      };
      return qp;
    },
    withProgress: (_opts, cb) => cb({ report() {} }, { onCancellationRequested() {} }),
  },
  tasks: {
    executeTask: async (task) => {
      host.tasks.push(task);
      const execution = { task, terminate() {} };
      // The end event lands after runLaunchTask has subscribed to it.
      setTimeout(
        () => taskEndHandlers.slice().forEach((h) => h({ execution, exitCode: 0 })),
        0
      );
      return execution;
    },
    onDidEndTaskProcess: (h) => sub(taskEndHandlers, h),
  },
  debug: {
    onDidStartDebugSession: (h) => sub(startHandlers, h),
    onDidTerminateDebugSession: (h) => sub(terminateHandlers, h),
    startDebugging: async (folder, config) => {
      host.started.push(config);
      if (!host.startResult) return false;
      const session = {
        id: `s${host.nextId++}`,
        name: config.name,
        configuration: config,
      };
      host.sessions.set(session.id, session);
      startHandlers.slice().forEach((h) => h(session));
      return true;
    },
    stopDebugging: async (session) => {
      host.stopped.push(session.id);
      if (host.stopTerminates) terminate(session);
    },
  },
};

require.cache["vscode"] = {
  id: "vscode",
  filename: "vscode",
  loaded: true,
  exports: vscodeStub,
};

/** Fire the terminate event the extension host would. */
function terminate(session) {
  host.sessions.delete(session.id);
  terminateHandlers.slice().forEach((h) => h(session));
}

const { DebugSessionTracker, startWorktreeDebug } = require(
  path.join(OUT, "debugRun.js")
);

// --- a worktree with something to launch ------------------------------------

const LAUNCH = {
  version: "0.2.0",
  configurations: [
    {
      name: "Run API",
      type: "node",
      request: "launch",
      program: "${workspaceFolder}/app.js",
      args: ["--mode", "${input:mode}"],
      preLaunchTask: "build",
    },
  ],
  inputs: [{ id: "mode", type: "promptString", description: "Mode" }],
};
const TASKS = {
  version: "2.0.0",
  tasks: [{ label: "build", type: "shell", command: "echo", args: ["built"] }],
};

/** A throwaway worktree carrying the two files the launch reads. */
function makeWorktree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "awt-debug-"));
  fs.mkdirSync(path.join(dir, ".vscode"));
  fs.writeFileSync(
    path.join(dir, ".vscode", "launch.json"),
    JSON.stringify(LAUNCH)
  );
  fs.writeFileSync(
    path.join(dir, ".vscode", "tasks.json"),
    JSON.stringify(TASKS)
  );
  return dir;
}

function reset() {
  host.started = [];
  host.stopped = [];
  host.tasks = [];
  host.prompts = 0;
  host.warnings = [];
  host.sessions.clear();
  host.startResult = true;
  host.stopTerminates = false;
  host.nextId = 1;
}

/** Let the queued macrotasks (the quick pick's accept, the task's end event)
 *  run. */
const settle = () => new Promise((r) => setImmediate(r));

test("a restart relaunches the same configuration, rebuilding first", async () => {
  reset();
  const dir = makeWorktree();
  const tracker = new DebugSessionTracker();

  const started = await startWorktreeDebug(dir, "wt", tracker);
  assert.strictEqual(started, 1, "the launch started one session");
  assert.strictEqual(host.tasks.length, 1, "the pre-launch task ran once");
  assert.strictEqual(host.prompts, 1, "the input was asked once");

  const rows = tracker.forWorktree(dir);
  assert.deepStrictEqual(
    rows.map((r) => r.label),
    ["Run API"],
    "the card shows the session, under its unsuffixed name"
  );
  const id = rows[0].id;
  const launched = host.started[0];

  const restart = tracker.restart(id);
  await settle();

  // The session is stopped, but the row is still there and says why.
  assert.deepStrictEqual(host.stopped, [id], "the session was stopped");
  const during = tracker.forWorktree(dir);
  assert.strictEqual(during.length, 1, "the row stays while the restart runs");
  assert.strictEqual(during[0].restarting, true, "and is marked restarting");
  assert.strictEqual(during[0].label, "Run API", "still naming its config");
  assert.strictEqual(host.started.length, 1, "nothing relaunched yet");

  terminate(host.sessions.get(id));
  await restart;

  assert.strictEqual(host.tasks.length, 2, "the pre-launch task ran again");
  assert.strictEqual(host.prompts, 1, "the input was not asked again");
  assert.strictEqual(host.started.length, 2, "the configuration was relaunched");
  assert.deepStrictEqual(
    host.started[1],
    launched,
    "with exactly the configuration that was running"
  );

  const after = tracker.forWorktree(dir);
  assert.strictEqual(after.length, 1, "the replacement took over the row");
  assert.notStrictEqual(after[0].id, id, "it is a new session");
  assert.ok(!after[0].restarting, "and the row is no longer marked");

  tracker.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a restart whose relaunch is refused drops the row", async () => {
  reset();
  const dir = makeWorktree();
  const tracker = new DebugSessionTracker();
  await startWorktreeDebug(dir, "wt", tracker);
  const id = tracker.forWorktree(dir)[0].id;

  // The adapter refuses the second launch (a program deleted under it, say).
  host.startResult = false;
  host.stopTerminates = true;
  await tracker.restart(id);

  assert.deepStrictEqual(
    tracker.forWorktree(dir),
    [],
    "nothing is left claiming to run"
  );
  assert.ok(
    host.warnings.some((w) => w.includes("Could not start")),
    "and the failure was reported"
  );

  tracker.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a session that will not stop is not restarted", async (t) => {
  reset();
  const dir = makeWorktree();
  const tracker = new DebugSessionTracker();
  await startWorktreeDebug(dir, "wt", tracker);
  const id = tracker.forWorktree(dir)[0].id;

  t.mock.timers.enable({ apis: ["setTimeout"] });
  const restart = tracker.restart(id);
  // Let restart get as far as waiting on the terminate that never comes, then
  // run the wait out.
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(10_000);
  await restart;

  assert.strictEqual(host.started.length, 1, "nothing was launched a second time");
  assert.ok(
    host.warnings.some((w) => w.includes("did not stop")),
    "and the reason was reported"
  );
  const rows = tracker.forWorktree(dir);
  assert.strictEqual(rows.length, 1, "the still-running session keeps its row");
  assert.ok(!rows[0].restarting, "which stops claiming to be restarting");

  tracker.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});
