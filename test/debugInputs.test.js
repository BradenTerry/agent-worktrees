"use strict";
const test = require("node:test");
const assert = require("node:assert");
const {
  parseInputs,
  inputRefs,
  applyInputValues,
} = require("../out/debugInputs.js");
const {
  parseLaunchJson,
  prepareConfig,
  taggedFromInput,
  FROM_INPUT_KEY,
} = require("../out/debugTargets.js");
const { parseTaskInputs } = require("../out/debugTasks.js");

const WT = "/repo/.claude/worktrees/feature";

test("parses the three input types", () => {
  const inputs = parseInputs({
    inputs: [
      { id: "name", type: "promptString", description: "Who?", default: "me" },
      { id: "secret", type: "promptString", password: true },
      {
        id: "env",
        type: "pickString",
        options: ["dev", { label: "Production", value: "prod" }],
        default: "dev",
      },
      { id: "pid", type: "command", command: "extension.pickProcess" },
    ],
  });
  assert.deepEqual(inputs, [
    { id: "name", type: "promptString", description: "Who?", default: "me" },
    { id: "secret", type: "promptString", password: true },
    {
      id: "env",
      type: "pickString",
      default: "dev",
      options: [
        { label: "dev", value: "dev" },
        { label: "Production", value: "prod" },
      ],
    },
    { id: "pid", type: "command", command: "extension.pickProcess" },
  ]);
});

test("keeps a command input's args, which are the inputs to the command", () => {
  const [input] = parseInputs({
    inputs: [
      {
        id: "pid",
        type: "command",
        command: "extension.pickProcess",
        args: { cwd: "${workspaceFolder}", filter: "node" },
      },
    ],
  });
  assert.deepEqual(input.args, { cwd: "${workspaceFolder}", filter: "node" });
});

test("drops entries that could not be prompted for", () => {
  const inputs = parseInputs({
    inputs: [
      { id: "", type: "promptString" },
      { type: "promptString" },
      { id: "unknown", type: "somethingElse" },
      { id: "empty", type: "pickString", options: [] },
      { id: "badOptions", type: "pickString", options: [{ label: "a" }, 7] },
      { id: "noCommand", type: "command" },
      { id: "blankCommand", type: "command", command: "" },
      "not an object",
      null,
    ],
  });
  assert.deepEqual(inputs, []);
});

test("the first declaration of a duplicated id wins", () => {
  const inputs = parseInputs({
    inputs: [
      { id: "env", type: "promptString", default: "first" },
      { id: "env", type: "promptString", default: "second" },
    ],
  });
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].default, "first");
});

test("no inputs section, or a broken one, yields no declarations", () => {
  assert.deepEqual(parseInputs({}), []);
  assert.deepEqual(parseInputs({ inputs: {} }), []);
  assert.deepEqual(parseInputs(undefined), []);
  assert.deepEqual(parseInputs("nope"), []);
});

test("a launch.json exposes its inputs alongside its configurations", () => {
  const file = parseLaunchJson(`{
    // JSONC, as always
    "version": "0.2.0",
    "configurations": [
      { "name": "Run", "type": "node", "request": "launch" },
    ],
    "inputs": [
      { "id": "port", "type": "promptString", "default": "3000" },
    ],
  }`);
  assert.equal(file.configurations.length, 1);
  assert.deepEqual(file.inputs, [
    { id: "port", type: "promptString", default: "3000" },
  ]);
});

test("a tasks.json declares its own inputs, separate from launch.json's", () => {
  const inputs = parseTaskInputs(
    JSON.stringify({
      version: "2.0.0",
      tasks: [{ type: "shell", label: "build", command: "make" }],
      inputs: [{ id: "config", type: "pickString", options: ["Debug"] }],
    })
  );
  assert.deepEqual(inputs, [
    {
      id: "config",
      type: "pickString",
      options: [{ label: "Debug", value: "Debug" }],
    },
  ]);
});

test("collects referenced ids in order, once each, from anywhere in a config", () => {
  const refs = inputRefs({
    name: "Run",
    program: "${workspaceFolder}/${input:entry}",
    args: ["--env", "${input:env}", "--tag=${input:env}"],
    env: { LEVEL: "${input:level}" },
    nested: [{ deep: ["${input:entry}", "${input:last}"] }],
  });
  assert.deepEqual(refs, ["entry", "env", "level", "last"]);
});

test("no inputs referenced is an empty list, so nothing is prompted", () => {
  assert.deepEqual(inputRefs({ name: "Run", program: "app.js" }), []);
  assert.deepEqual(inputRefs("${env:HOME}/${command:pickFile}"), []);
  assert.deepEqual(inputRefs(undefined), []);
});

test("substitutes values, including several in one string", () => {
  const out = applyInputValues(
    {
      program: "${workspaceFolder}/${input:entry}",
      args: ["--env=${input:env}", "${input:env}:${input:level}"],
      port: 5000,
      stop: true,
    },
    { entry: "server.js", env: "prod", level: "warn" }
  );
  assert.deepEqual(out, {
    program: "${workspaceFolder}/server.js",
    args: ["--env=prod", "prod:warn"],
    port: 5000,
    stop: true,
  });
});

test("an empty answer substitutes, rather than being treated as unresolved", () => {
  assert.equal(applyInputValues("--flag=${input:x}", { x: "" }), "--flag=");
});

test("an id with no value is left verbatim, never emptied", () => {
  assert.equal(
    applyInputValues("${input:known}/${input:unknown}", { known: "a" }),
    "a/${input:unknown}"
  );
});

test("does not mutate the parsed configuration", () => {
  const config = { name: "Run", args: ["${input:env}"] };
  applyInputValues(config, { env: "prod" });
  assert.deepEqual(config.args, ["${input:env}"]);
});

test("a session is only claimed as input-fed when it is tagged as one", () => {
  assert.equal(taggedFromInput({ [FROM_INPUT_KEY]: true }), true);
  for (const config of [
    undefined,
    null,
    {},
    { name: "Run" },
    { [FROM_INPUT_KEY]: false },
    { [FROM_INPUT_KEY]: "true" },
    "a string",
  ]) {
    assert.equal(taggedFromInput(config), false);
  }
});

test("a value carrying folder variables is rewritten to the worktree", () => {
  // Inputs resolve first, so an answer of "${workspaceFolder}/logs" still points
  // at the worktree rather than the primary checkout.
  const withInputs = applyInputValues(
    { name: "Run", type: "node", request: "launch", args: ["${input:out}"] },
    { out: "${workspaceFolder}/logs" }
  );
  const prepared = prepareConfig(withInputs, WT, "feature", "primary");
  assert.deepEqual(prepared.args, [`${WT}/logs`]);
});
