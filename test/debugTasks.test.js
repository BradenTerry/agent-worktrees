"use strict";
const test = require("node:test");
const assert = require("node:assert");
const {
  parseTasksJson,
  taskLabel,
  findTask,
  taskSpec,
  npmScriptSpec,
} = require("../out/debugTasks.js");

const WT = "/repo/.claude/worktrees/feature";
const OPTS = { platform: "linux", sep: "/", basename: "feature" };

function tasksJson(tasks) {
  return JSON.stringify({ version: "2.0.0", tasks });
}

test("labels an npm task the way launch.json refers to it", () => {
  assert.equal(taskLabel({ type: "npm", script: "compile" }), "npm: compile");
  assert.equal(
    taskLabel({ type: "npm", script: "compile", label: "build it" }),
    "build it"
  );
  assert.equal(taskLabel({ type: "shell", command: "make" }), undefined);
});

test("finds the task a preLaunchTask names", () => {
  const tasks = parseTasksJson(
    tasksJson([
      { type: "npm", script: "watch", isBackground: true },
      { type: "npm", script: "compile" },
      { label: "build", type: "shell", command: "dotnet", args: ["build"] },
    ])
  );
  assert.equal(findTask(tasks, "npm: compile").script, "compile");
  assert.equal(findTask(tasks, "build").command, "dotnet");
  assert.equal(findTask(tasks, "nope"), undefined);
});

test("an npm task runs npm run <script> in the worktree", () => {
  const spec = taskSpec({ type: "npm", script: "compile" }, WT, OPTS);
  assert.deepEqual(spec, {
    label: "npm: compile",
    command: "npm",
    args: ["run", "compile"],
    cwd: WT,
    isBackground: false,
  });
});

test("an npm task's path selects a subfolder of the worktree", () => {
  const spec = taskSpec({ type: "npm", script: "build", path: "web/" }, WT, OPTS);
  assert.equal(spec.cwd, `${WT}/web`);
});

test("a shell task keeps its command and args, rooted at the worktree", () => {
  const spec = taskSpec(
    {
      label: "build",
      type: "shell",
      command: "dotnet",
      args: ["build", "${workspaceFolder}/App.csproj"],
    },
    WT,
    OPTS
  );
  assert.equal(spec.command, "dotnet");
  assert.deepEqual(spec.args, ["build", `${WT}/App.csproj`]);
  assert.equal(spec.cwd, WT);
});

test("args given as quoting objects are unwrapped", () => {
  const spec = taskSpec(
    {
      label: "build",
      type: "shell",
      command: "make",
      args: [{ value: "all", quoting: "escape" }, "-j4", 42],
    },
    WT,
    OPTS
  );
  assert.deepEqual(spec.args, ["all", "-j4"]);
});

test("a relative options.cwd resolves under the worktree, an absolute one wins", () => {
  const relative = taskSpec(
    { label: "b", type: "shell", command: "make", options: { cwd: "src" } },
    WT,
    OPTS
  );
  assert.equal(relative.cwd, `${WT}/src`);

  const viaVariable = taskSpec(
    {
      label: "b",
      type: "shell",
      command: "make",
      options: { cwd: "${workspaceFolder}/api" },
    },
    WT,
    OPTS
  );
  assert.equal(viaVariable.cwd, `${WT}/api`);

  const absolute = taskSpec(
    { label: "b", type: "shell", command: "make", options: { cwd: "/opt/x" } },
    WT,
    OPTS
  );
  assert.equal(absolute.cwd, "/opt/x");
});

test("a Windows absolute cwd is not appended to the worktree", () => {
  const spec = taskSpec(
    { label: "b", type: "shell", command: "make", options: { cwd: "C:\\build" } },
    "C:\\repo\\wt",
    { platform: "windows", sep: "\\", basename: "wt" }
  );
  assert.equal(spec.cwd, "C:\\build");
});

test("platform overrides win over the base definition", () => {
  const task = {
    label: "build",
    type: "shell",
    command: "./build.sh",
    windows: { command: "build.cmd", args: ["/p:Release"] },
  };
  const onLinux = taskSpec(task, WT, OPTS);
  assert.equal(onLinux.command, "./build.sh");

  const onWindows = taskSpec(task, "C:\\repo\\wt", {
    platform: "windows",
    sep: "\\",
    basename: "wt",
  });
  assert.equal(onWindows.command, "build.cmd");
  assert.deepEqual(onWindows.args, ["/p:Release"]);
});

test("a background task is marked so the caller does not wait for it", () => {
  const spec = taskSpec(
    { type: "npm", script: "watch", isBackground: true },
    WT,
    OPTS
  );
  assert.equal(spec.isBackground, true);
});

test("a task type we cannot reproduce yields no spec", () => {
  for (const task of [
    { label: "b", type: "typescript", tsconfig: "tsconfig.json" },
    { label: "b", type: "gulp", task: "default" },
    { label: "b", type: "shell" },
    { type: "npm" },
    { label: "b" },
  ]) {
    assert.equal(taskSpec(task, WT, OPTS), undefined, JSON.stringify(task));
  }
});

test("tasks.json parsing tolerates comments and a missing tasks array", () => {
  const withComments = `{
    // the version
    "version": "2.0.0",
    "tasks": [ { "type": "npm", "script": "compile" }, ]
  }`;
  assert.equal(parseTasksJson(withComments).length, 1);
  assert.deepEqual(parseTasksJson("{}"), []);
  assert.deepEqual(parseTasksJson("not json"), []);
  assert.deepEqual(parseTasksJson('{"tasks": "nope"}'), []);
});

test("npm scripts are inferred when no tasks.json defines the label", () => {
  const pkg = JSON.stringify({ scripts: { compile: "tsc -p ./", test: "node" } });
  const spec = npmScriptSpec("npm: compile", pkg, WT);
  assert.deepEqual(spec, {
    label: "npm: compile",
    command: "npm",
    args: ["run", "compile"],
    cwd: WT,
    isBackground: false,
  });
  assert.equal(npmScriptSpec("npm: missing", pkg, WT), undefined);
  assert.equal(npmScriptSpec("build", pkg, WT), undefined);
  assert.equal(npmScriptSpec("npm: compile", "not json", WT), undefined);
  assert.equal(npmScriptSpec("npm: compile", "{}", WT), undefined);
});
