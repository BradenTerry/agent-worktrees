// Playwright config for the marketplace screenshot suite only. The functional
// tests run under `node --test` (test/*.test.js); this is kept separate so the
// two never collide.
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./screenshots",
  // Deterministic output: one worker, retries off.
  workers: 1,
  retries: 0,
  use: {
    ...devices["Desktop Chrome"],
    // Crisp 2x images for the marketplace listing.
    deviceScaleFactor: 2,
    colorScheme: "dark",
  },
  reporter: "list",
});
