"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { pruneOurHooks } = require("../out/hookCleanup.js");

/**
 * Taking the extension's hooks back out of the user's global settings.json.
 *
 * The pruning has to be exact in both directions: every entry we added goes,
 * and nothing else is touched. This file is the user's, shared with every Claude
 * session on their machine, and they never asked us to edit anyone else's hooks.
 */

const OURS = 'node --no-warnings "/store/hooks/agent-worktrees-emit.mjs" --dir "/store/sessions"';
/** The other command shape we shipped: the launcher that ran the emitter. */
const OURS_LAUNCHER = '"/store/hooks/agent-worktrees-emit.sh" --dir "/store/sessions"';
const THEIRS = "npm run lint";

test("removes our hook, whichever command shape installed it", () => {
  for (const command of [OURS, OURS_LAUNCHER]) {
    const settings = {
      hooks: { Stop: [{ hooks: [{ type: "command", command }] }] },
    };
    assert.strictEqual(pruneOurHooks(settings), true, command);
    assert.deepStrictEqual(settings, {});
  }
});

test("leaves the user's own hooks alone", () => {
  const settings = {
    hooks: { Stop: [{ hooks: [{ type: "command", command: THEIRS }] }] },
  };
  assert.strictEqual(pruneOurHooks(settings), false);
  assert.deepStrictEqual(settings.hooks.Stop, [
    { hooks: [{ type: "command", command: THEIRS }] },
  ]);
});

test("keeps a user hook that shares an event with ours", () => {
  const settings = {
    hooks: {
      Stop: [
        { hooks: [{ type: "command", command: OURS }] },
        { hooks: [{ type: "command", command: THEIRS }] },
      ],
    },
  };
  assert.strictEqual(pruneOurHooks(settings), true);
  assert.deepStrictEqual(settings.hooks.Stop, [
    { hooks: [{ type: "command", command: THEIRS }] },
  ]);
});

test("keeps a user hook that shares an entry with ours", () => {
  // One matcher entry can hold several commands; only ours comes out, and the
  // entry survives with its matcher intact.
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: "*",
          hooks: [
            { type: "command", command: OURS },
            { type: "command", command: THEIRS },
          ],
        },
      ],
    },
  };
  assert.strictEqual(pruneOurHooks(settings), true);
  assert.deepStrictEqual(settings.hooks.PreToolUse, [
    { matcher: "*", hooks: [{ type: "command", command: THEIRS }] },
  ]);
});

test("drops an event that held nothing but ours, and hooks when empty", () => {
  const settings = {
    model: "opus",
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: OURS }] }],
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: OURS }] }],
    },
  };
  assert.strictEqual(pruneOurHooks(settings), true);
  // The rest of the user's settings are untouched.
  assert.deepStrictEqual(settings, { model: "opus" });
});

test("is a no-op on settings that never had hooks, and is idempotent", () => {
  assert.strictEqual(pruneOurHooks({}), false);
  assert.strictEqual(pruneOurHooks({ hooks: {} }), false);
  assert.strictEqual(pruneOurHooks({ hooks: { Stop: "nonsense" } }), false);
  const settings = {
    hooks: { Stop: [{ hooks: [{ type: "command", command: OURS }] }] },
  };
  assert.strictEqual(pruneOurHooks(settings), true);
  assert.strictEqual(pruneOurHooks(settings), false, "nothing left to remove");
});
