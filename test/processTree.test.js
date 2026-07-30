"use strict";
const test = require("node:test");
const assert = require("node:assert");
const {
  parsePsTree,
  parseWindowsTree,
  ancestorsOf,
  isDescendantOf,
  readParentMap,
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
  // What `Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId)" }`
  // emits: one line per process, CRLF, pid first.
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
