"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { normalizePath } = require("../out/worktreeUtils.js");

test("normalizePath strips trailing slashes", () => {
  assert.strictEqual(normalizePath("/a/b/"), "/a/b");
  assert.strictEqual(normalizePath("/a/b"), "/a/b");
});
