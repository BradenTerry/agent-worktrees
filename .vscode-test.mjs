import { defineConfig } from "@vscode/test-cli";

// Runs the compiled integration tests inside a real VS Code extension host
// (downloaded by @vscode/test-electron). This is the only way to exercise the
// vscode API surface — extension activation, commands, the built-in Git
// extension API — on the actual OS, which is how we get real Windows coverage in
// CI instead of testing on a laptop by hand.
export default defineConfig({
  files: "out/test/integration/**/*.test.js",
  version: "stable",
  mocha: {
    ui: "tdd",
    timeout: 60000,
  },
});
