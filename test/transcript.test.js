"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  findTranscript,
  readTitle,
  TranscriptReader,
} = require("../out/transcript.js");

/**
 * The work summary on an agent row, read from Claude's transcript.
 *
 * This is the one thing the hooks carried that the session registry does not,
 * so if it stops working every row on a card falls back to "Claude 1",
 * "Claude 2".
 */

/** A transcript built from JSONL records, plus the projects dir holding it. */
function seed(sessionId, records, { project = "-home-u-repo" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awt-projects-"));
  const dir = path.join(root, project);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${sessionId}.jsonl`),
    records.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n"
  );
  return root;
}

const msg = { type: "assistant", message: { content: "..." } };

test("readTitle takes the newest title, whichever kind wrote it", async () => {
  const root = seed("s1", [
    msg,
    { type: "ai-title", aiTitle: "first pass" },
    msg,
    { type: "custom-title", customTitle: "renamed by hand" },
    msg,
  ]);
  const file = await findTranscript(root, "s1");
  assert.strictEqual(readTitle(file), "renamed by hand");
  fs.rmSync(root, { recursive: true, force: true });
});

test("readTitle collapses whitespace and bounds the length", async () => {
  const long = "x".repeat(300);
  const root = seed("s1", [{ type: "ai-title", aiTitle: `port  the\tgit ${long}` }]);
  const title = readTitle(await findTranscript(root, "s1"));
  assert.ok(title.startsWith("port the git x"), title.slice(0, 20));
  assert.strictEqual(title.length, 120, "a row is not a paragraph");
  fs.rmSync(root, { recursive: true, force: true });
});

test("readTitle survives a transcript with no title yet", async () => {
  // A session Claude has not summarized: the row falls back to its ordinal.
  const root = seed("s1", [msg, msg]);
  assert.strictEqual(readTitle(await findTranscript(root, "s1")), "");
  fs.rmSync(root, { recursive: true, force: true });
});

test("readTitle ignores a truncated record and keeps scanning", async () => {
  // The tail read starts mid-file, so the first line is usually a fragment.
  const root = seed("s1", [
    '{"type":"ai-title","aiTi',
    { type: "ai-title", aiTitle: "the real one" },
  ]);
  assert.strictEqual(readTitle(await findTranscript(root, "s1")), "the real one");
  fs.rmSync(root, { recursive: true, force: true });
});

test("readTitle returns nothing for an empty or missing transcript", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "awt-empty-"));
  const empty = path.join(dir, "empty.jsonl");
  fs.writeFileSync(empty, "");
  assert.strictEqual(readTitle(empty), "");
  assert.strictEqual(readTitle(path.join(dir, "gone.jsonl")), "");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("findTranscript locates the session across project directories", async () => {
  // The directory name is Claude's encoding of the cwd, so the session's own
  // file is what we look for rather than reproducing that encoding.
  const root = seed("s1", [msg], { project: "-Users-someone-other-repo" });
  fs.mkdirSync(path.join(root, "-home-u-repo"), { recursive: true });
  assert.ok((await findTranscript(root, "s1")).endsWith("s1.jsonl"));
  assert.strictEqual(await findTranscript(root, "nope"), undefined);
  assert.strictEqual(await findTranscript(root, ""), undefined);
  assert.strictEqual(await findTranscript("/no/such/dir", "s1"), undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

test("TranscriptReader re-reads only after the transcript is written again", async () => {
  const root = seed("s1", [{ type: "ai-title", aiTitle: "first" }]);
  const reader = new TranscriptReader(root);
  assert.strictEqual(await reader.titleFor("s1"), "first");

  const file = await findTranscript(root, "s1");
  fs.appendFileSync(file, JSON.stringify({ type: "ai-title", aiTitle: "second" }) + "\n");
  // Appending moves the mtime, which is the cache key.
  assert.strictEqual(await reader.titleFor("s1"), "second");

  // The mtime is the whole cache key, in either direction: a transcript stamped
  // backwards (a restore, a clock adjustment) is still a change, so it re-reads
  // rather than serving what it had.
  fs.writeFileSync(file, JSON.stringify({ type: "ai-title", aiTitle: "third" }) + "\n");
  fs.utimesSync(file, new Date(0), new Date(0));
  assert.strictEqual(await reader.titleFor("s1"), "third");
  fs.rmSync(root, { recursive: true, force: true });
});

test("TranscriptReader forgets a session whose transcript is gone", async () => {
  const root = seed("s1", [{ type: "ai-title", aiTitle: "first" }]);
  const reader = new TranscriptReader(root);
  assert.strictEqual(await reader.titleFor("s1"), "first");
  fs.rmSync(path.join(root, "-home-u-repo", "s1.jsonl"));
  assert.strictEqual(await reader.titleFor("s1"), "");
  fs.rmSync(root, { recursive: true, force: true });
});

test("TranscriptReader drops sessions that are no longer live", async () => {
  // Otherwise both caches grow for the life of the window.
  const root = seed("s1", [{ type: "ai-title", aiTitle: "first" }]);
  const reader = new TranscriptReader(root);
  await reader.titleFor("s1");
  reader.retain(new Set(["s2"]));
  fs.rmSync(path.join(root, "-home-u-repo", "s1.jsonl"));
  // Nothing cached to serve, and the file is gone, so it reads as untitled.
  assert.strictEqual(await reader.titleFor("s1"), "");
  fs.rmSync(root, { recursive: true, force: true });
});
