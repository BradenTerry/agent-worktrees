"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  linkPathsIntoWorktree,
  unlinkPathFromWorktree,
  linkFailures,
  stripExtendedPrefix,
} = require("../out/links.js");

// --- Windows extended-length paths ------------------------------------------
// Pure string logic, so the Windows-only shape is verified on every platform.
// Windows reports a junction through readlink as "\\?\C:\repo\certs"; comparing
// that raw against a normal absolute path never matches, which would make every
// refresh treat a healthy junction as stale and rebuild it (and make unlink
// refuse to remove it as "not ours").

test("stripExtendedPrefix removes the Windows \\\\?\\ prefix", () => {
  assert.strictEqual(
    stripExtendedPrefix("\\\\?\\C:\\repo\\certs"),
    "C:\\repo\\certs"
  );
});

test("stripExtendedPrefix leaves ordinary paths untouched", () => {
  assert.strictEqual(stripExtendedPrefix("C:\\repo\\certs"), "C:\\repo\\certs");
  assert.strictEqual(stripExtendedPrefix("/home/me/repo"), "/home/me/repo");
  assert.strictEqual(stripExtendedPrefix(""), "");
});

test("stripExtendedPrefix only strips a leading prefix", () => {
  // A UNC path must not be mangled, and the prefix is never removed mid-string.
  assert.strictEqual(
    stripExtendedPrefix("\\\\server\\share\\f"),
    "\\\\server\\share\\f"
  );
});

/**
 * Whether this machine can create *symlinks*. On Windows that needs Developer
 * Mode or elevation. The feature deliberately does not depend on it (files fall
 * back to a hard link, directories to a junction), so only the handful of tests
 * asserting the symlink mechanism itself are gated on this. Every behavioural
 * test below runs everywhere, which is what proves the Windows fallbacks work.
 */
const CAN_SYMLINK = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "awt-symcap-"));
  try {
    fs.writeFileSync(path.join(dir, "src.txt"), "x");
    fs.symlinkSync(path.join(dir, "src.txt"), path.join(dir, "link.txt"), "file");
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

const symlinkTest = (name, fn) => test(name, { skip: !CAN_SYMLINK }, fn);

/**
 * Fresh repo + worktree dir pair under a temp root, cleaned up by the caller.
 * The worktree is nested inside the repo exactly as the panel creates them
 * (`.claude/worktrees/<name>`), which is also what keeps the Windows hard-link
 * fallback on a single volume.
 */
function makeRepoAndWorktree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awt-links-"));
  const repo = path.join(root, "repo");
  const worktree = path.join(root, "repo", ".claude", "worktrees", "wt");
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  return { root, repo, worktree };
}

// --- Behaviour: true on every platform, whatever link mechanism was used -----

test("a linked file reads back the repo's content", async () => {
  const { root, repo, worktree } = makeRepoAndWorktree();
  try {
    fs.writeFileSync(path.join(repo, "appsettings.local.json"), '{"ok":1}');
    const out = await linkPathsIntoWorktree(repo, worktree, [
      "appsettings.local.json",
    ]);
    assert.strictEqual(out[0].status, "linked");
    assert.strictEqual(
      fs.readFileSync(path.join(worktree, "appsettings.local.json"), "utf8"),
      '{"ok":1}'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("editing the repo's copy in place is visible through the link", async () => {
  // This is the invariant the whole feature rests on, and it holds for a
  // symlink and for the Windows hard-link fallback alike.
  const { root, repo, worktree } = makeRepoAndWorktree();
  try {
    const source = path.join(repo, ".env");
    fs.writeFileSync(source, "KEY=one");
    await linkPathsIntoWorktree(repo, worktree, [".env"]);
    fs.writeFileSync(source, "KEY=two");
    assert.strictEqual(
      fs.readFileSync(path.join(worktree, ".env"), "utf8"),
      "KEY=two"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("creates parent directories for a nested linked path", async () => {
  const { root, repo, worktree } = makeRepoAndWorktree();
  try {
    fs.mkdirSync(path.join(repo, "tests", "cfg"), { recursive: true });
    fs.writeFileSync(path.join(repo, "tests", "cfg", "secrets.json"), "x");
    const out = await linkPathsIntoWorktree(repo, worktree, [
      "tests/cfg/secrets.json",
    ]);
    assert.strictEqual(out[0].status, "linked");
    assert.strictEqual(
      fs.readFileSync(
        path.join(worktree, "tests", "cfg", "secrets.json"),
        "utf8"
      ),
      "x"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("links a directory (junction on Windows, dir symlink elsewhere)", async () => {
  const { root, repo, worktree } = makeRepoAndWorktree();
  try {
    fs.mkdirSync(path.join(repo, "certs"));
    fs.writeFileSync(path.join(repo, "certs", "dev.pem"), "cert");
    const out = await linkPathsIntoWorktree(repo, worktree, ["certs"]);
    assert.strictEqual(out[0].status, "linked");
    assert.strictEqual(
      fs.readFileSync(path.join(worktree, "certs", "dev.pem"), "utf8"),
      "cert"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a trailing slash and a backslash path both resolve", async () => {
  const { root, repo, worktree } = makeRepoAndWorktree();
  try {
    fs.mkdirSync(path.join(repo, "certs"));
    fs.writeFileSync(path.join(repo, "certs", "dev.pem"), "cert");
    fs.mkdirSync(path.join(repo, "cfg"));
    fs.writeFileSync(path.join(repo, "cfg", "a.json"), "a");
    const out = await linkPathsIntoWorktree(repo, worktree, [
      "certs/",
      "cfg\\a.json",
    ]);
    assert.strictEqual(out[0].status, "linked");
    assert.strictEqual(out[1].status, "linked");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("re-running is idempotent: an existing correct link is left alone", async () => {
  const { root, repo, worktree } = makeRepoAndWorktree();
  try {
    fs.writeFileSync(path.join(repo, "a.json"), "a");
    const first = await linkPathsIntoWorktree(repo, worktree, ["a.json"]);
    assert.strictEqual(first[0].status, "linked");
    const second = await linkPathsIntoWorktree(repo, worktree, ["a.json"]);
    assert.strictEqual(second[0].status, "unchanged");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("re-running over a linked directory is idempotent", async () => {
  // Regression guard: a Windows junction reports through readlink as an
  // extended-length path ("\\\\?\\C:\\..."), which a naive compare reads as a
  // different target - tearing the link down and rebuilding it on every refresh.
  const { root, repo, worktree } = makeRepoAndWorktree();
  try {
    fs.mkdirSync(path.join(repo, "certs"));
    fs.writeFileSync(path.join(repo, "certs", "dev.pem"), "cert");
    await linkPathsIntoWorktree(repo, worktree, ["certs"]);
    const second = await linkPathsIntoWorktree(repo, worktree, ["certs"]);
    assert.strictEqual(second[0].status, "unchanged");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("never overwrites a real file the worktree already has", async () => {
  const { root, repo, worktree } = makeRepoAndWorktree();
  try {
    fs.writeFileSync(path.join(repo, "config.json"), "SOURCE");
    fs.writeFileSync(path.join(worktree, "config.json"), "REAL");
    const out = await linkPathsIntoWorktree(repo, worktree, ["config.json"]);
    assert.strictEqual(out[0].status, "skipped-real");
    assert.strictEqual(
      fs.readFileSync(path.join(worktree, "config.json"), "utf8"),
      "REAL"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reports a missing source instead of throwing", async () => {
  const { root, repo, worktree } = makeRepoAndWorktree();
  try {
    const out = await linkPathsIntoWorktree(repo, worktree, ["nope.json"]);
    assert.strictEqual(out[0].status, "missing-source");
    assert.strictEqual(linkFailures(out).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a path that escapes the repository", async () => {
  const { root, repo, worktree } = makeRepoAndWorktree();
  try {
    fs.writeFileSync(path.join(root, "outside.json"), "secret");
    const out = await linkPathsIntoWorktree(repo, worktree, ["../outside.json"]);
    assert.strictEqual(out[0].status, "invalid");
    assert.strictEqual(linkFailures(out).length, 1);
    assert.strictEqual(
      fs.existsSync(path.join(worktree, "outside.json")),
      false
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ignores blank entries", async () => {
  const { root, repo, worktree } = makeRepoAndWorktree();
  try {
    const out = await linkPathsIntoWorktree(repo, worktree, ["", "   "]);
    assert.strictEqual(out.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- The Windows hard-link fallback -----------------------------------------
// A hard link is what Windows uses when it will not grant a file symlink. It is
// indistinguishable from a regular file by lstat, so it is recognised by device
// + inode identity instead. fs.link works on POSIX too, so the exact detection
// path Windows relies on is exercised on every platform here.

test("a hard link to the source counts as our link, not a real file", async () => {
  const { root, repo, worktree } = makeRepoAndWorktree();
  try {
    fs.writeFileSync(path.join(repo, "a.json"), "a");
    fs.linkSync(path.join(repo, "a.json"), path.join(worktree, "a.json"));
    const out = await linkPathsIntoWorktree(repo, worktree, ["a.json"]);
    // Recognised as already linked - not reported as a real file in the way.
    assert.strictEqual(out[0].status, "unchanged");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("unlink removes a hard link and leaves the repo's file intact", async () => {
  const { root, repo, worktree } = makeRepoAndWorktree();
  try {
    fs.writeFileSync(path.join(repo, "a.json"), "a");
    fs.linkSync(path.join(repo, "a.json"), path.join(worktree, "a.json"));
    assert.strictEqual(
      await unlinkPathFromWorktree(repo, worktree, "a.json"),
      true
    );
    assert.strictEqual(fs.existsSync(path.join(worktree, "a.json")), false);
    assert.strictEqual(fs.readFileSync(path.join(repo, "a.json"), "utf8"), "a");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- Unlinking ---------------------------------------------------------------

test("unlink removes the link we made and leaves the source intact", async () => {
  const { root, repo, worktree } = makeRepoAndWorktree();
  try {
    fs.writeFileSync(path.join(repo, "a.json"), "a");
    await linkPathsIntoWorktree(repo, worktree, ["a.json"]);
    assert.strictEqual(
      await unlinkPathFromWorktree(repo, worktree, "a.json"),
      true
    );
    assert.strictEqual(fs.existsSync(path.join(worktree, "a.json")), false);
    assert.strictEqual(fs.readFileSync(path.join(repo, "a.json"), "utf8"), "a");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("unlink removes a linked directory and leaves its contents intact", async () => {
  // The win32 path here needs rmdir rather than unlink; POSIX needs the reverse.
  const { root, repo, worktree } = makeRepoAndWorktree();
  try {
    fs.mkdirSync(path.join(repo, "certs"));
    fs.writeFileSync(path.join(repo, "certs", "dev.pem"), "cert");
    await linkPathsIntoWorktree(repo, worktree, ["certs"]);
    assert.strictEqual(
      await unlinkPathFromWorktree(repo, worktree, "certs"),
      true
    );
    assert.strictEqual(fs.existsSync(path.join(worktree, "certs")), false);
    assert.strictEqual(
      fs.readFileSync(path.join(repo, "certs", "dev.pem"), "utf8"),
      "cert"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// No link is created here, so this safety guarantee is asserted on every
// platform, including a Windows box without symlink privileges.
test("unlink never deletes a real file in the worktree", async () => {
  const { root, repo, worktree } = makeRepoAndWorktree();
  try {
    fs.writeFileSync(path.join(repo, "a.json"), "source");
    fs.writeFileSync(path.join(worktree, "a.json"), "REAL");
    assert.strictEqual(
      await unlinkPathFromWorktree(repo, worktree, "a.json"),
      false
    );
    assert.strictEqual(
      fs.readFileSync(path.join(worktree, "a.json"), "utf8"),
      "REAL"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- Mechanism-specific: only where symlinks are actually permitted ----------

symlinkTest("a linked file is a real symlink where symlinks are allowed", async () => {
  const { root, repo, worktree } = makeRepoAndWorktree();
  try {
    fs.writeFileSync(path.join(repo, "a.json"), "a");
    const out = await linkPathsIntoWorktree(repo, worktree, ["a.json"]);
    assert.strictEqual(out[0].method, "symlink");
    assert.ok(fs.lstatSync(path.join(worktree, "a.json")).isSymbolicLink());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

symlinkTest("re-points a stale symlink to the current source", async () => {
  const { root, repo, worktree } = makeRepoAndWorktree();
  try {
    const stray = path.join(root, "stray.json");
    fs.writeFileSync(stray, "stray");
    fs.symlinkSync(stray, path.join(worktree, "a.json"));
    fs.writeFileSync(path.join(repo, "a.json"), "real");
    const out = await linkPathsIntoWorktree(repo, worktree, ["a.json"]);
    assert.strictEqual(out[0].status, "linked");
    assert.strictEqual(
      fs.readFileSync(path.join(worktree, "a.json"), "utf8"),
      "real"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

symlinkTest("unlink leaves a symlink that points somewhere else alone", async () => {
  const { root, repo, worktree } = makeRepoAndWorktree();
  try {
    const stray = path.join(root, "stray.json");
    fs.writeFileSync(stray, "stray");
    fs.writeFileSync(path.join(repo, "a.json"), "source");
    fs.symlinkSync(stray, path.join(worktree, "a.json"));
    assert.strictEqual(
      await unlinkPathFromWorktree(repo, worktree, "a.json"),
      false
    );
    assert.ok(fs.lstatSync(path.join(worktree, "a.json")).isSymbolicLink());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

symlinkTest("a relative symlink pointing at the source counts as ours", async () => {
  // Not a shape we create, but one a user may have made by hand; it must be
  // recognised rather than rebuilt on every refresh.
  const { root, repo, worktree } = makeRepoAndWorktree();
  try {
    fs.writeFileSync(path.join(repo, "a.json"), "a");
    const target = path.join(worktree, "a.json");
    fs.symlinkSync(
      path.relative(path.dirname(target), path.join(repo, "a.json")),
      target
    );
    const out = await linkPathsIntoWorktree(repo, worktree, ["a.json"]);
    assert.strictEqual(out[0].status, "unchanged");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
