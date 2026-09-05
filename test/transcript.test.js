"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  findTranscript,
  readTitle,
  readTail,
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

/**
 * Skills. A Skill tool call is an ordinary `tool_use` block, so the list is
 * recoverable from the transcript - but it accumulates over a whole session, so
 * unlike the title it cannot come from the tail alone.
 */

const skillCall = (skill) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "tool_use", name: "Skill", input: { skill } }] },
});

test("normalizeSkill reduces every form to a bare name", () => {
  const { normalizeSkill } = require("../out/transcript.js");
  assert.strictEqual(normalizeSkill("pdf"), "pdf");
  assert.strictEqual(normalizeSkill("plugin:code-review"), "code-review");
  assert.strictEqual(normalizeSkill("path/to/tdd-workflow"), "tdd-workflow");
  // Every path segment is stripped, so even a traversal-shaped value reduces to
  // its last segment - which is only ever rendered as a chip label.
  assert.strictEqual(normalizeSkill("../etc"), "etc");
  // Anything that is not a plausible name is dropped rather than shown.
  for (const raw of ["", "  ", "/", "-x", "!!", 3, null, undefined]) {
    assert.strictEqual(normalizeSkill(raw), undefined, JSON.stringify(raw));
  }
});

test("scanTranscript finds skills anywhere in the transcript, deduped in order", async () => {
  const { scanTranscript } = require("../out/transcript.js");
  const root = seed("s1", [
    skillCall("plugin:code-review"),
    ...Array.from({ length: 400 }, () => msg), // push the early call out of any tail
    skillCall("pdf"),
    skillCall("code-review"), // same skill by its bare name
  ]);
  const file = await findTranscript(root, "s1");
  assert.deepStrictEqual((await scanTranscript(file)).skills, ["code-review", "pdf"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("scanTranscript takes the newest title in the whole file", async () => {
  const { scanTranscript } = require("../out/transcript.js");
  const root = seed("s1", [
    { type: "ai-title", aiTitle: "first pass" },
    ...Array.from({ length: 400 }, () => msg),
    { type: "custom-title", customTitle: "renamed by hand" },
    ...Array.from({ length: 400 }, () => msg),
  ]);
  const file = await findTranscript(root, "s1");
  assert.strictEqual((await scanTranscript(file)).title, "renamed by hand");
  fs.rmSync(root, { recursive: true, force: true });
});

test("scanTranscript reads a last record written without its newline", async () => {
  // A transcript being appended to right now often ends mid-write, and that
  // last record is the likeliest place for the newest title.
  const { scanTranscript } = require("../out/transcript.js");
  const root = seed("s1", [msg]);
  const file = await findTranscript(root, "s1");
  fs.appendFileSync(file, JSON.stringify({ type: "ai-title", aiTitle: "no newline" }));
  assert.strictEqual((await scanTranscript(file)).title, "no newline");
  fs.rmSync(root, { recursive: true, force: true });
});

/** Records enough to bury anything before them past the 64KB tail. */
const PAST_TAIL = Array.from({ length: 2000 }, () => msg);

/** Await until `read()` reports what we are waiting for, or give up. Used for the
 *  full skill scan, which deliberately does not block the read that starts it. */
async function eventually(read, want, label) {
  for (let i = 0; i < 100; i++) {
    if (JSON.stringify(await read()) === JSON.stringify(want)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.deepStrictEqual(await read(), want, label);
}

test("skillsFor keeps a skill used before the tail, and adds new ones", async () => {
  const root = seed("s1", [skillCall("code-review"), ...PAST_TAIL]);
  const reader = new TranscriptReader(root);
  // Buried past the tail, so only the background scan can find it.
  await eventually(
    () => reader.skillsFor("s1"),
    ["code-review"],
    "the full scan fills in the skills the tail cannot see"
  );

  // A skill invoked while the window is open arrives in the tail.
  const file = await findTranscript(root, "s1");
  fs.appendFileSync(file, JSON.stringify(skillCall("pdf")) + "\n");
  assert.deepStrictEqual(await reader.skillsFor("s1"), ["code-review", "pdf"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("the first read does not wait on the full skill scan", async () => {
  // Awaiting it put a multi-megabyte read per live session in front of the
  // panel's first render. The tail is what the first read is allowed to cost, so
  // a skill only the whole-file scan can see must NOT be there yet.
  const root = seed("s1", [skillCall("code-review"), ...PAST_TAIL, skillCall("pdf")]);
  const reader = new TranscriptReader(root);
  assert.deepStrictEqual(
    await reader.skillsFor("s1"),
    ["pdf"],
    "only what the tail showed"
  );
  // ...and the buried one lands on a later read, in first-use order.
  await eventually(() => reader.skillsFor("s1"), ["code-review", "pdf"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a session dropped mid-scan does not come back", async () => {
  const root = seed("s1", [skillCall("code-review"), ...PAST_TAIL]);
  const reader = new TranscriptReader(root);
  await reader.skillsFor("s1"); // starts the scan
  reader.retain(new Set()); // the session ended before it finished
  await new Promise((r) => setTimeout(r, 150)); // let the scan land
  fs.rmSync(path.join(root, "-home-u-repo", "s1.jsonl"));
  // A scan that finishes after its session was dropped must write nothing back,
  // or every cache here grows for the life of the window.
  assert.deepStrictEqual(await reader.skillsFor("s1"), []);
  fs.rmSync(root, { recursive: true, force: true });
});

/**
 * The title, once seen, is remembered. Claude writes one when it summarizes the
 * work, not on every turn, so a session titled once (the app titling it, a
 * rename) has that record hundreds of kilobytes back by the time it has run a
 * while - at which point the tail alone finds nothing and the row would fall
 * back to "Claude 1" while Claude itself still calls the session something.
 */

test("titleFor keeps a title that has scrolled out of the tail", async () => {
  const root = seed("s1", [{ type: "custom-title", customTitle: "named once" }]);
  const reader = new TranscriptReader(root);
  assert.strictEqual(await reader.titleFor("s1"), "named once");

  // The session runs on, and the title record is now far behind the tail.
  const file = await findTranscript(root, "s1");
  fs.appendFileSync(file, PAST_TAIL.map((r) => JSON.stringify(r)).join("\n") + "\n");
  assert.strictEqual(
    await reader.titleFor("s1"),
    "named once",
    "a tail with no title says nothing new, so it must not erase the title"
  );

  // A newer title still wins.
  fs.appendFileSync(file, JSON.stringify({ type: "ai-title", aiTitle: "later work" }) + "\n");
  assert.strictEqual(await reader.titleFor("s1"), "later work");
  fs.rmSync(root, { recursive: true, force: true });
});

test("titleFor recovers a title buried before the tail", async () => {
  // A window opening onto a session that was titled long ago: the tail cannot
  // see it, so the one full scan is what fills it in.
  const root = seed("s1", [{ type: "ai-title", aiTitle: "buried title" }, ...PAST_TAIL]);
  const reader = new TranscriptReader(root);
  assert.strictEqual(await reader.titleFor("s1"), "", "the tail alone has nothing");
  await eventually(() => reader.titleFor("s1"), "buried title", "the full scan finds it");
  fs.rmSync(root, { recursive: true, force: true });
});

test("the full scan does not overwrite a newer title from the tail", async () => {
  const root = seed("s1", [
    { type: "ai-title", aiTitle: "buried title" },
    ...PAST_TAIL,
    { type: "ai-title", aiTitle: "current title" },
  ]);
  const reader = new TranscriptReader(root);
  assert.strictEqual(await reader.titleFor("s1"), "current title");
  await new Promise((r) => setTimeout(r, 150)); // let the scan land
  assert.strictEqual(await reader.titleFor("s1"), "current title");
  fs.rmSync(root, { recursive: true, force: true });
});

test("skillsFor is empty for a session that has invoked none", async () => {
  const root = seed("s1", [msg, msg]);
  const reader = new TranscriptReader(root);
  assert.deepStrictEqual(await reader.skillsFor("s1"), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test("TranscriptReader picks up a transcript that did not exist yet", async () => {
  // Claude registers a session several seconds before it writes the session's
  // first transcript record, and the registry file appearing is exactly what
  // wakes the panel — so the first lookup for a newly started session always
  // misses. Remembering that miss left the row labelled "Claude 1" with no
  // skills and no subagent rows for as long as the window stayed open.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awt-projects-"));
  const dir = path.join(root, "-home-u-repo");
  fs.mkdirSync(dir, { recursive: true });
  const reader = new TranscriptReader(root);
  assert.strictEqual(await reader.titleFor("s1"), "");
  assert.deepStrictEqual(await reader.subagentsFor("s1"), []);

  fs.writeFileSync(
    path.join(dir, "s1.jsonl"),
    JSON.stringify({ type: "ai-title", aiTitle: "late start" }) + "\n"
  );
  const subs = path.join(dir, "s1", "subagents");
  fs.mkdirSync(subs, { recursive: true });
  fs.writeFileSync(
    path.join(subs, "agent-a1.meta.json"),
    JSON.stringify({ agentType: "Explore", description: "look around" })
  );
  fs.writeFileSync(
    path.join(subs, "agent-a1.jsonl"),
    JSON.stringify({
      type: "user",
      cwd: "/home/u/repo",
      timestamp: new Date().toISOString(),
      message: { content: "go" },
    }) + "\n"
  );

  assert.strictEqual(await reader.titleFor("s1"), "late start");
  assert.deepStrictEqual(
    (await reader.subagentsFor("s1")).map((s) => s.task),
    ["look around"]
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("readTail ignores the receipt for a backgrounded subagent", async () => {
  // A backgrounded Agent call is answered the moment it launches: the parent
  // gets "Async agent launched successfully", not an outcome. Counting that as
  // the call's result retired every subagent a second or two after it started,
  // which is why no row was ever seen. Completion arrives later, as a
  // <task-notification> naming the subagent's own id.
  const launch = {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_agent",
          content: [
            { type: "text", text: "Async agent launched successfully. agentId: aa11" },
          ],
        },
      ],
    },
  };
  const root = seed("s1", [launch]);
  let tail = readTail(await findTranscript(root, "s1"));
  assert.deepStrictEqual(tail.finished, [], "a launch receipt retires nothing");

  const file = await findTranscript(root, "s1");
  fs.appendFileSync(
    file,
    JSON.stringify({
      type: "user",
      message: {
        content: "<task-notification>\n<task-id>aa11</task-id>\n</task-notification>",
      },
    }) + "\n"
  );
  tail = readTail(file);
  assert.deepStrictEqual(tail.finished, ["aa11"], "the notification retires it");

  // A synchronous subagent still reports through its tool result, so a real
  // result is collected exactly as before.
  fs.appendFileSync(
    file,
    JSON.stringify({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "toolu_sync", content: "all done" },
        ],
      },
    }) + "\n"
  );
  assert.ok(readTail(file).finished.includes("toolu_sync"));
  fs.rmSync(root, { recursive: true, force: true });
});
