// Generates the marketplace screenshots from the live webview UI.
//
//   npm run screenshots
//
// Output PNGs land in images/ and are referenced from MARKETPLACE.md. Re-run
// after any panel.js / panel.css change to keep the listing current.

const path = require("path");
const { test } = require("@playwright/test");
const { OUT_DIR, overviewData, mountPanel } = require("./fixtures");

const shot = (name) => path.join(OUT_DIR, name);

test("overview - worktrees, git status, PRs and agents", async ({ page }) => {
  const data = overviewData();
  await mountPanel(page, { data });
  // Capture the panel body (#root) at its natural content height.
  await page.locator("#root").screenshot({ path: shot("overview.png") });
});

test("pr-status - CI checks and review on the PR row", async ({ page }) => {
  const data = overviewData();
  await mountPanel(page, { data });
  // Crop to the worktree with the richest PR row for a focused close-up.
  await page.locator(".card").nth(1).screenshot({ path: shot("pr-status.png") });
});

test("settings - GitHub PR integration", async ({ page }) => {
  const data = overviewData();
  await mountPanel(page, { data, message: { type: "openSettings" } });
  await page.locator("#root").screenshot({ path: shot("settings.png") });
});
