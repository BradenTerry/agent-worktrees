"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  usableNodePath,
  launcherName,
  launcherScript,
  hookCommandFor,
  electronEnableArgs,
} = require("../out/nodeRuntime.js");

/** A runtime literal, with the fields a test does not care about defaulted. */
const runtime = (exec, extra = {}) => ({
  exec,
  viaElectron: true,
  enableArgs: [],
  ...extra,
});

/**
 * How the hook command names an interpreter for the emitter. The extension does
 * not require `node` on PATH: it prefers one when it finds a usable one, and
 * otherwise runs the emitter on VS Code's own Node through a launcher that sets
 * ELECTRON_RUN_AS_NODE.
 */

test("usableNodePath takes a modern node from the probe output", () => {
  assert.strictEqual(usableNodePath("/usr/bin/node|20.11.1\n"), "/usr/bin/node");
});

test("usableNodePath rejects a node older than the emitter supports", () => {
  assert.strictEqual(usableNodePath("/usr/bin/node|16.20.2\n"), undefined);
});

test("usableNodePath rejects unusable probe output", () => {
  for (const out of ["", "\n", "/usr/bin/node", "|20.11.1", "/usr/bin/node|"]) {
    assert.strictEqual(usableNodePath(out), undefined, JSON.stringify(out));
  }
});

test("hookCommandFor runs a PATH node directly, by absolute path", () => {
  const command = hookCommandFor(
    runtime("/usr/local/bin/node", { viaElectron: false }),
    { emitter: "/store/emit.mjs", launcher: "/store/emit.sh", sessions: "/s" },
  );
  assert.strictEqual(
    command,
    '"/usr/local/bin/node" --no-warnings "/store/emit.mjs" --dir "/s"',
  );
});

test("hookCommandFor goes through the launcher for VS Code's node", () => {
  const command = hookCommandFor(
    runtime("/Applications/Visual Studio Code.app/Code"),
    { emitter: "/store/emit.mjs", launcher: "/store/emit.sh", sessions: "/s" },
  );
  // The launcher already carries the interpreter and the emitter; only the
  // state dir still has to reach the emitter's argv.
  assert.strictEqual(command, '"/store/emit.sh" --dir "/s"');
});

test("launcherName is a .cmd on Windows so cmd.exe will run it", () => {
  assert.ok(launcherName("win32").endsWith(".cmd"));
  assert.ok(launcherName("darwin").endsWith(".sh"));
  assert.ok(launcherName("linux").endsWith(".sh"));
});

test("electronEnableArgs only flags Microsoft's own Electron builds", () => {
  // Their builds disable the runAsNode fuse, so the env var alone is ignored;
  // every other build would die on the unknown option.
  assert.deepStrictEqual(
    electronEnableArgs({ electron: "32.0.0", "microsoft-build": "1" }),
    ["--ms-enable-electron-run-as-node"],
  );
  assert.deepStrictEqual(electronEnableArgs({ electron: "32.0.0" }), []);
  assert.deepStrictEqual(electronEnableArgs({ node: "20.11.1" }), []);
});

test("the launcher passes the enable flag after the emitter path", () => {
  // Before it, an Electron that does not know the flag dies on an unknown
  // option; after it, the flag is just an argument the emitter ignores.
  const rt = runtime("/Apps/Code", { enableArgs: ["--ms-enable"] });
  const posix = launcherScript("linux", rt, "/store/emit.mjs");
  assert.ok(posix.includes('"/store/emit.mjs" --ms-enable "$@"'));
  const win = launcherScript("win32", rt, "C:\\emit.mjs");
  assert.ok(win.includes('"C:\\emit.mjs" --ms-enable %*'));
});

test("the POSIX launcher sets the env var and forwards its arguments", () => {
  const body = launcherScript("linux", runtime("/Apps/Code"), "/store/emit.mjs");
  assert.ok(body.startsWith("#!/bin/sh\n"));
  assert.match(body, /ELECTRON_RUN_AS_NODE=1 exec /);
  assert.match(body, /--no-warnings/);
  assert.ok(body.includes('"$@"'));
});

test("the POSIX launcher quotes paths a shell would otherwise mangle", () => {
  const body = launcherScript(
    "darwin",
    runtime('/Apps/Code "beta"'),
    "/store/$dir/emit.mjs",
  );
  assert.ok(body.includes('"/Apps/Code \\"beta\\""'));
  assert.ok(body.includes('"/store/\\$dir/emit.mjs"'));
});

test("the Windows launcher is a CRLF batch file that forwards %*", () => {
  const body = launcherScript(
    "win32",
    runtime("C:\\Code.exe"),
    "C:\\store\\emit.mjs",
  );
  assert.ok(body.startsWith("@echo off\r\n"));
  assert.ok(body.includes('\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n'));
  assert.ok(body.includes('"C:\\Code.exe" --no-warnings'));
  assert.ok(body.trimEnd().endsWith("%*"));
  assert.ok(!body.includes("\n\n"), "no bare LF line endings");
});

test("the Windows launcher escapes % so a path is not read as a variable", () => {
  const body = launcherScript(
    "win32",
    runtime("C:\\100%\\Code.exe"),
    "C:\\emit.mjs",
  );
  assert.ok(body.includes('"C:\\100%%\\Code.exe"'));
});

test("a generated launcher really runs the script with the args it was given", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "awt-launcher-"));
  try {
    // Stands in for the emitter: reports what reached it, so this covers the
    // launcher's contract (env var set, argv forwarded) on the real shell.
    const probe = path.join(dir, "probe.mjs");
    fs.writeFileSync(
      probe,
      "console.log(JSON.stringify({" +
        " args: process.argv.slice(2)," +
        " env: process.env.ELECTRON_RUN_AS_NODE }));\n",
    );
    const file = path.join(dir, launcherName(process.platform));
    fs.writeFileSync(
      file,
      launcherScript(process.platform, runtime(process.execPath), probe),
      { mode: 0o755 },
    );

    // A dir with a space in it: the quoting is the point of the test.
    const stateDir = path.join(dir, "session state");
    // Windows needs a shell (node refuses to spawn a .cmd without one), and a
    // shell takes the whole command as one string: an args array alongside
    // `shell` is what DEP0190 warns about, since node concatenates them
    // unescaped. Quoting here mirrors the hook command in settings.json.
    const res =
      process.platform === "win32"
        ? spawnSync(`"${file}" --dir "${stateDir}"`, {
            encoding: "utf8",
            shell: true,
          })
        : spawnSync(file, ["--dir", stateDir], { encoding: "utf8" });

    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stderr, "", "stderr becomes a Claude hook error");
    assert.deepStrictEqual(JSON.parse(res.stdout), {
      args: ["--dir", stateDir],
      env: "1",
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
