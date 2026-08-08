"use strict";
const test = require("node:test");
const assert = require("node:assert");
const {
  parseLaunchJson,
  debugTargets,
  resolveTarget,
  prepareConfig,
  launchTasksOf,
  taggedWorktree,
  taggedNoDebug,
  taggedBaseName,
  WORKTREE_KEY,
  NO_DEBUG_KEY,
} = require("../out/debugTargets.js");

const WT = "/repo/.claude/worktrees/feature";

/** A minimal valid launch.json body. */
function launch(configs, compounds) {
  return JSON.stringify({
    version: "0.2.0",
    configurations: configs,
    ...(compounds ? { compounds } : {}),
  });
}

test("parses a plain launch.json", () => {
  const file = parseLaunchJson(
    launch([{ name: "Run API", type: "node", request: "launch" }])
  );
  assert.equal(file.configurations.length, 1);
  assert.equal(file.configurations[0].name, "Run API");
  assert.deepEqual(file.compounds, []);
});

test("strips line and block comments, JSONC-style", () => {
  const text = `{
    // the version
    "version": "0.2.0",
    /* the configurations
       span several lines */
    "configurations": [
      { "name": "Run API", "type": "node", "request": "launch" } // trailing note
    ]
  }`;
  const file = parseLaunchJson(text);
  assert.equal(file.configurations.length, 1);
  assert.equal(file.configurations[0].name, "Run API");
});

test("keeps // inside a string value", () => {
  const file = parseLaunchJson(
    launch([
      {
        name: "Attach",
        type: "node",
        request: "attach",
        url: "https://localhost:5001/app",
      },
    ])
  );
  assert.equal(file.configurations[0].url, "https://localhost:5001/app");
});

test("keeps a comment-like sequence inside an escaped string", () => {
  const text =
    '{"configurations":[{"name":"Odd \\" /* not a comment */","type":"node","request":"launch"}]}';
  const file = parseLaunchJson(text);
  assert.equal(file.configurations.length, 1);
  assert.equal(file.configurations[0].name, 'Odd " /* not a comment */');
});

test("tolerates trailing commas", () => {
  const text = `{
    "configurations": [
      { "name": "Run API", "type": "node", "request": "launch", },
    ],
  }`;
  assert.equal(parseLaunchJson(text).configurations.length, 1);
});

test("does not treat a comma inside a string as trailing", () => {
  const file = parseLaunchJson(
    launch([
      { name: "Run", type: "node", request: "launch", args: ["a,}", "b"] },
    ])
  );
  assert.deepEqual(file.configurations[0].args, ["a,}", "b"]);
});

test("malformed or empty input yields no targets rather than throwing", () => {
  for (const text of ["", "{", "not json", "[]", '"a string"', "null"]) {
    const file = parseLaunchJson(text);
    assert.deepEqual(file.configurations, [], `for ${JSON.stringify(text)}`);
    assert.deepEqual(file.compounds, []);
  }
});

test("drops configurations missing name, type or request", () => {
  const file = parseLaunchJson(
    launch([
      { name: "Good", type: "node", request: "launch" },
      { name: "No type", request: "launch" },
      { type: "node", request: "launch" },
      { name: "No request", type: "node" },
      { name: "", type: "node", request: "launch" },
      "a string",
      null,
    ])
  );
  assert.deepEqual(
    file.configurations.map((c) => c.name),
    ["Good"]
  );
});

test("lists configurations then compounds, with member counts", () => {
  const file = parseLaunchJson(
    launch(
      [
        { name: "API", type: "node", request: "launch" },
        { name: "Web", type: "chrome", request: "launch" },
      ],
      [{ name: "Full stack", configurations: ["API", "Web"] }]
    )
  );
  const targets = debugTargets(file);
  assert.deepEqual(targets, [
    { name: "API", kind: "config", type: "node" },
    { name: "Web", kind: "config", type: "chrome" },
    { name: "Full stack", kind: "compound", count: 2 },
  ]);
});

test("a compound counts only members that exist", () => {
  const file = parseLaunchJson(
    launch(
      [{ name: "API", type: "node", request: "launch" }],
      [{ name: "Partly there", configurations: ["API", "Gone"] }]
    )
  );
  const compound = debugTargets(file).find((t) => t.kind === "compound");
  assert.equal(compound.count, 1);
});

test("a compound with no surviving members is not offered", () => {
  const file = parseLaunchJson(
    launch(
      [{ name: "API", type: "node", request: "launch" }],
      [{ name: "All gone", configurations: ["Nope"] }]
    )
  );
  assert.deepEqual(
    debugTargets(file).map((t) => t.name),
    ["API"]
  );
});

test("compound members given as multi-root objects are ignored", () => {
  const file = parseLaunchJson(
    launch(
      [{ name: "API", type: "node", request: "launch" }],
      [
        {
          name: "Cross folder",
          configurations: [{ folder: "other", name: "API" }],
        },
      ]
    )
  );
  assert.deepEqual(file.compounds, []);
});

test("resolveTarget returns the single config, or a compound's members in order", () => {
  const file = parseLaunchJson(
    launch(
      [
        { name: "API", type: "node", request: "launch" },
        { name: "Web", type: "chrome", request: "launch" },
      ],
      [{ name: "Full stack", configurations: ["Web", "API"] }]
    )
  );
  assert.deepEqual(
    resolveTarget(file, { name: "API", kind: "config" }).map((c) => c.name),
    ["API"]
  );
  assert.deepEqual(
    resolveTarget(file, { name: "Full stack", kind: "compound" }).map(
      (c) => c.name
    ),
    ["Web", "API"]
  );
  assert.deepEqual(resolveTarget(file, { name: "Gone", kind: "config" }), []);
  assert.deepEqual(
    resolveTarget(file, { name: "Gone", kind: "compound" }),
    []
  );
});

test("prepareConfig points the folder variables at the worktree", () => {
  const out = prepareConfig(
    {
      name: "Run API",
      type: "node",
      request: "launch",
      program: "${workspaceFolder}/src/index.js",
      legacy: "${workspaceRoot}/old.js",
      label: "${workspaceFolderBasename} build",
    },
    WT,
    "feature",
    "feature"
  );
  assert.equal(out.program, `${WT}/src/index.js`);
  assert.equal(out.legacy, `${WT}/old.js`);
  assert.equal(out.label, "feature build");
});

test("prepareConfig suffixes the session name but keeps the base name", () => {
  const out = prepareConfig(
    { name: "Run Extension", type: "node", request: "launch" },
    WT,
    "feature",
    "feature"
  );
  // The suffix disambiguates VS Code's own worktree-agnostic views.
  assert.equal(out.name, "Run Extension (feature)");
  // The card row reads this instead, since the card already says the worktree.
  assert.equal(taggedBaseName(out, out.name), "Run Extension");
});

test("prepareConfig names an unnamed configuration, base name included", () => {
  const out = prepareConfig({ type: "node", request: "launch" }, WT, "feature", "feature");
  assert.equal(out.name, "Launch (feature)");
  assert.equal(taggedBaseName(out, out.name), "Launch");
});

test("taggedBaseName falls back for a session started without the tag", () => {
  // A session from a previous version, or a config round-tripped through
  // something that dropped unknown properties: the row keeps the full name
  // rather than losing its label.
  assert.equal(taggedBaseName({ name: "Run (feature)" }, "Run (feature)"), "Run (feature)");
  assert.equal(taggedBaseName(undefined, "Run (feature)"), "Run (feature)");
  assert.equal(taggedBaseName({ agentWorktreesBaseName: "" }, "Run (feature)"), "Run (feature)");
});

test("prepareConfig substitutes inside nested arrays and objects", () => {
  const out = prepareConfig(
    {
      name: "Run",
      type: "node",
      request: "launch",
      args: ["--root", "${workspaceFolder}/data"],
      env: { CONFIG: "${workspaceFolder}/.env" },
      nested: { deep: [{ path: "${workspaceFolder}/x" }] },
    },
    WT,
    "feature",
    "feature"
  );
  assert.deepEqual(out.args, ["--root", `${WT}/data`]);
  assert.equal(out.env.CONFIG, `${WT}/.env`);
  assert.equal(out.nested.deep[0].path, `${WT}/x`);
});

test("prepareConfig leaves other variables for VS Code to resolve", () => {
  const out = prepareConfig(
    {
      name: "Run",
      type: "node",
      request: "launch",
      program: "${file}",
      port: "${config:myext.port}",
    },
    WT,
    "feature",
    "feature"
  );
  assert.equal(out.program, "${file}");
  assert.equal(out.port, "${config:myext.port}");
});

test("prepareConfig defaults cwd to the worktree but never overrides one", () => {
  const withoutCwd = prepareConfig(
    { name: "Run", type: "node", request: "launch" },
    WT,
    "feature",
    "feature"
  );
  assert.equal(withoutCwd.cwd, WT);

  const withCwd = prepareConfig(
    { name: "Run", type: "node", request: "launch", cwd: "/elsewhere" },
    WT,
    "feature",
    "feature"
  );
  assert.equal(withCwd.cwd, "/elsewhere");
});

test("prepareConfig names the session after the config and worktree", () => {
  const out = prepareConfig(
    { name: "Run API", type: "node", request: "launch" },
    WT,
    "feature/login",
    "feature"
  );
  assert.equal(out.name, "Run API (feature/login)");
});

test("prepareConfig does not mutate the parsed configuration", () => {
  const config = {
    name: "Run",
    type: "node",
    request: "launch",
    program: "${workspaceFolder}/a.js",
    args: ["${workspaceFolder}/b"],
  };
  prepareConfig(config, WT, "feature", "feature");
  assert.equal(config.program, "${workspaceFolder}/a.js");
  assert.deepEqual(config.args, ["${workspaceFolder}/b"]);
  assert.equal(config.name, "Run");
  assert.equal(config[WORKTREE_KEY], undefined);
});

test("a prepared config carries its worktree, and noDebug only when asked", () => {
  const debugged = prepareConfig(
    { name: "Run", type: "node", request: "launch" },
    WT,
    "feature",
    "feature"
  );
  assert.equal(taggedWorktree(debugged), WT);
  assert.equal(taggedNoDebug(debugged), false);
  assert.equal(debugged[NO_DEBUG_KEY], undefined);

  const ran = prepareConfig(
    { name: "Run", type: "node", request: "launch" },
    WT,
    "feature",
    "feature",
    true
  );
  assert.equal(taggedNoDebug(ran), true);
});

test("prepareConfig strips the task labels so VS Code cannot run them in the primary", () => {
  // Regression: leaving preLaunchTask in place made VS Code resolve it against
  // the workspace folder, building the primary worktree and then debugging the
  // worktree's unrebuilt output.
  const out = prepareConfig(
    {
      name: "Run API",
      type: "coreclr",
      request: "launch",
      preLaunchTask: "build",
      postDebugTask: "clean",
      program: "${workspaceFolder}/bin/Debug/net8.0/App.dll",
    },
    WT,
    "feature",
    "feature"
  );
  assert.equal(out.preLaunchTask, undefined);
  assert.equal(out.postDebugTask, undefined);
  assert.equal(out.program, `${WT}/bin/Debug/net8.0/App.dll`);
});

test("launchTasksOf reports the labels prepareConfig removes", () => {
  assert.deepEqual(
    launchTasksOf({
      name: "Run",
      type: "node",
      request: "launch",
      preLaunchTask: "npm: compile",
      postDebugTask: "npm: clean",
    }),
    { preLaunchTask: "npm: compile", postDebugTask: "npm: clean" }
  );
  assert.deepEqual(
    launchTasksOf({ name: "Run", type: "node", request: "launch" }),
    {}
  );
  assert.deepEqual(
    launchTasksOf({
      name: "Run",
      type: "node",
      request: "launch",
      preLaunchTask: "",
    }),
    {}
  );
});

test("an untagged session is not claimed as ours", () => {
  for (const config of [
    undefined,
    null,
    {},
    { name: "Run" },
    { [WORKTREE_KEY]: "" },
    { [WORKTREE_KEY]: 42 },
    "a string",
  ]) {
    assert.equal(taggedWorktree(config), undefined);
    assert.equal(taggedNoDebug(config), false);
  }
});
