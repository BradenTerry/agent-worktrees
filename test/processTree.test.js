"use strict";
const test = require("node:test");
const assert = require("node:assert");
const {
  parsePsTree,
  parseWindowsTree,
  ancestorsOf,
  isDescendantOf,
  readParentMap,
  namesClaude,
  readCommandLine,
  parentMapSnapshot,
  clearParentMapSnapshot,
} = require("../out/processTree.js");

/**
 * Finding the terminal an agent runs in, by process ancestry.
 *
 * The parsing is what these cover, because it is the part that differs per
 * platform and the part a Mac cannot exercise: the Windows branch is unreachable
 * in this suite, so its format is asserted against captured output instead. The
 * real-world shape both parsers must survive is the one that caused the bug -
 * `claude -w` puts a second claude process between the shell and the session the
 * registry names, so the link is an *ancestor*, never a parent.
 */

test("parsePsTree reads `ps -Ao pid=,ppid=` with its right-aligned padding", () => {
  // Real macOS output: both columns space-padded, no header (the `=` suppresses
  // it), and a leading blank column for low pids.
  const out = [
    "    1     0",
    "  399     1",
    "47236 47199",
    "62919 47236",
    "63074 62919",
    "",
  ].join("\n");
  const map = parsePsTree(out);
  assert.strictEqual(map.get(63074), 62919);
  assert.strictEqual(map.get(1), 0);
  assert.strictEqual(map.size, 5, "the trailing blank line is not a process");
});

test("parsePsTree skips anything that is not two integers", () => {
  const map = parsePsTree("  PID  PPID\n 100 1\ngarbage\n 200 zzz\n 300 1\n");
  assert.deepStrictEqual([...map.entries()], [
    [100, 1],
    [300, 1],
  ]);
});

test("parseWindowsTree reads the PowerShell one-liner's pid,ppid with CRLF", () => {
  // What the command in treeCommand() emits - `$_.ProcessId.ToString() + ',' +
  // $_.ParentProcessId.ToString()`, deliberately concatenation rather than an
  // interpolated "$(...)" string - one line per process, CRLF, pid first.
  const out = "0,0\r\n4,0\r\n8112,4\r\n9240,8112\r\n9612,9240\r\n\r\n";
  const map = parseWindowsTree(out);
  assert.strictEqual(map.get(9612), 9240);
  assert.strictEqual(map.get(8112), 4);
  assert.strictEqual(map.size, 5);
});

test("parseWindowsTree ignores a header or a PowerShell warning line", () => {
  const map = parseWindowsTree(
    "ProcessId,ParentProcessId\r\nWARNING: something\r\n1234,1\r\n"
  );
  assert.deepStrictEqual([...map.entries()], [[1234, 1]]);
});

test("parseWindowsTree does not accept wmic's reversed CSV as pid,ppid", () => {
  // wmic emits Node,ParentProcessId,ProcessId - the opposite order. Parsing it
  // as if it were ours would invert every relationship, so a three-field line is
  // rejected outright rather than guessed at.
  const map = parseWindowsTree("Node,ParentProcessId,ProcessId\r\nDESKTOP,8112,9240\r\n");
  assert.strictEqual(map.size, 0);
});

test("ancestorsOf walks to the root, nearest first", () => {
  // The shape that matters: shell -> claude (the one we launched) -> claude (the
  // one the registry names). Resolution has to reach the shell from the leaf.
  const map = new Map([
    [63074, 62919],
    [62919, 47236],
    [47236, 47199],
    [47199, 1],
    [1, 0],
  ]);
  assert.deepStrictEqual(ancestorsOf(63074, map), [62919, 47236, 47199, 1]);
});

test("ancestorsOf stops at an unknown or zero parent", () => {
  assert.deepStrictEqual(ancestorsOf(500, new Map([[500, 400]])), [400]);
  assert.deepStrictEqual(ancestorsOf(500, new Map([[500, 0]])), [], "pid 0 is not an ancestor");
  assert.deepStrictEqual(ancestorsOf(500, new Map()), [], "unknown pid has no ancestry");
});

test("ancestorsOf survives a cycle instead of hanging the click", () => {
  const map = new Map([
    [10, 20],
    [20, 30],
    [30, 10],
  ]);
  assert.deepStrictEqual(ancestorsOf(10, map), [20, 30]);
});

test("isDescendantOf answers the terminal question through the middle process", () => {
  const map = new Map([
    [63074, 62919], // registry's claude
    [62919, 47236], // the claude -w we launched
    [47236, 47199], // the terminal's shell
    [99999, 47199], // an unrelated shell in the same window
  ]);
  assert.strictEqual(isDescendantOf(63074, 47236, map), true, "found beneath its shell");
  assert.strictEqual(isDescendantOf(63074, 63074, map), true, "a pid is its own match");
  assert.strictEqual(
    isDescendantOf(63074, 99999, map),
    false,
    "not beneath a sibling shell, which is what keeps the wrong terminal from being revealed"
  );
});

test("readParentMap resolves to an empty map when the process listing fails", async () => {
  const boom = (_file, _args, _opts, cb) => cb(new Error("ENOENT"), "", "");
  assert.strictEqual((await readParentMap(boom)).size, 0);
  const threw = () => {
    throw new Error("spawn failed");
  };
  assert.strictEqual((await readParentMap(threw)).size, 0, "a throwing spawn is not a rejection");
});

test("readParentMap parses this platform's output through the right parser", async () => {
  // The command is chosen by platform, so feed each parser's format and assert
  // the one for the host wins. This is what proves the Windows branch is wired to
  // the Windows parser rather than only its regex being right.
  const posix = "  100     1\n  200   100\n";
  const win = "100,1\r\n200,100\r\n";
  const fake = (_file, _args, _opts, cb) =>
    cb(null, process.platform === "win32" ? win : posix, "");
  const map = await readParentMap(fake);
  assert.strictEqual(map.get(200), 100);
  assert.strictEqual(map.size, 2);
});

// --- identity, the gate on every kill -----------------------------------------

test("namesClaude accepts the shapes Claude actually runs as", () => {
  // Observed on 2.1.220: the plain argv0, and the versioned binary whose own name
  // is a version number - only its path says claude.
  assert.strictEqual(namesClaude("claude --session-id c14fdb55"), true);
  assert.strictEqual(
    namesClaude("/Users/b/.local/share/claude/versions/2.1.220 --session-id x"),
    true,
    "the versioned binary is named for its version, not for claude"
  );
  assert.strictEqual(
    namesClaude("node.exe C:\\Users\\b\\AppData\\Local\\claude\\cli.js"),
    true,
    "on Windows the process name is node; the path is what identifies it"
  );
});

test("namesClaude rejects a recycled pid, which is the whole point", () => {
  // The failure this guards: a session killed with SIGKILL leaves its registry
  // file behind, the OS hands its pid to something else, and the row still looks
  // live because the liveness probe only asks whether the pid exists. Stop would
  // then force-kill a stranger's process tree.
  assert.strictEqual(namesClaude("/usr/bin/postgres -D /var/lib/pg"), false);
  assert.strictEqual(namesClaude(""), false, "no command line is not a match");
  assert.strictEqual(namesClaude("svchost.exe -k netsvcs"), false);
});

test("namesClaude ignores claude in the arguments of something else", () => {
  // The gate used to test the whole command line, so any process holding a
  // file from ~/.claude open matched - and matching is what lets Stop kill it.
  // A recycled pid running one of these was a stranger's process tree away
  // from being force-killed.
  assert.strictEqual(namesClaude("vim /Users/b/.claude/settings.json"), false);
  assert.strictEqual(namesClaude("tail -f /Users/b/.claude/sessions/567.json"), false);
  assert.strictEqual(namesClaude("rg --files /Users/b/.claude/projects"), false);
  assert.strictEqual(
    namesClaude("node /Users/b/scripts/parse.js /Users/b/.claude/x.jsonl"),
    false,
    "a JS runtime running someone else's script over a claude data file"
  );
});

test("namesClaude still accepts the real shapes after tightening", () => {
  // Every accepted shape identifies Claude by the *program*, never by an
  // argument: argv0 named claude, argv0 living in a claude directory, or a
  // runtime whose script is Claude's own entry point.
  assert.strictEqual(namesClaude("/opt/homebrew/bin/claude --session-id x"), true);
  assert.strictEqual(namesClaude("claude.exe --session-id x"), true);
  assert.strictEqual(
    namesClaude("/Users/b/.claude/local/node_modules/.bin/claude -w"),
    true
  );
  assert.strictEqual(
    namesClaude("node /Users/b/.claude/local/node_modules/@anthropic-ai/claude-code/cli.js"),
    true,
    "the entry script lives under a claude directory and ends in .js"
  );
});

test("readCommandLine yields the empty string rather than throwing", async () => {
  const gone = (_f, _a, _o, cb) => cb(new Error("no such process"), "", "");
  assert.strictEqual(await readCommandLine(999999, gone), "");
  const threw = () => {
    throw new Error("spawn failed");
  };
  assert.strictEqual(await readCommandLine(1, threw), "");
});

test("readCommandLine trims the trailing newline ps and powershell both add", async () => {
  const fake = (_f, _a, _o, cb) => cb(null, "claude --session-id abc\n", "");
  assert.strictEqual(await readCommandLine(1, fake), "claude --session-id abc");
});

// --- one listing per burst ----------------------------------------------------

test("parentMapSnapshot shares one listing across a burst, then re-reads", async () => {
  // Removing a worktree stops every agent in it at once. Without sharing, that is
  // one process-table read per agent - on Windows, one PowerShell cold start each.
  clearParentMapSnapshot();
  const first = parentMapSnapshot(1_000);
  const second = parentMapSnapshot(1_500);
  assert.strictEqual(first, second, "same in-flight promise, not a second listing");
  const later = parentMapSnapshot(2_100);
  assert.notStrictEqual(later, first, "past the TTL it reads again");
  await Promise.all([first, second, later]);
  clearParentMapSnapshot();
});
