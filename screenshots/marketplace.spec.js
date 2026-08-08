// Generates the marketplace screenshots from the live webview UI.
//
//   npm run screenshots
//
// Output PNGs land in images/ and are referenced from MARKETPLACE.md. Re-run
// after any panel.js / panel.css change to keep the listing current.

const path = require("path");
const { test } = require("@playwright/test");
const { OUT_DIR, overviewData, branchesData, mountPanel } = require("./fixtures");

const shot = (name) => path.join(OUT_DIR, name);

test("overview - worktrees, git status, PRs and agents", async ({ page }) => {
  const data = overviewData();
  await mountPanel(page, { data });
  // Capture the panel body (#root) at its natural content height.
  await page.locator("#root").screenshot({ path: shot("overview.png"), animations: "disabled" });
});

test("pr-status - CI checks and review on the PR row", async ({ page }) => {
  const data = overviewData();
  await mountPanel(page, { data });
  // Crop to the worktree with the richest PR row for a focused close-up.
  await page.locator(".card").nth(1).screenshot({ path: shot("pr-status.png"), animations: "disabled" });
});

test("collapsed - every card shut", async ({ page }) => {
  const data = overviewData();
  // A locked worktree, so its glyph shows up on one of the four.
  data.worktrees[2].locked = true;
  await mountPanel(page, { data });
  // Collapsed through the toolbar control rather than by setting the class, so
  // this shows what the real path produces. The harness seeds every card as
  // expanded, so the button's first click is the collapsing one.
  await page.locator("[data-tool='collapseAll']").click();
  await page.locator("#root").screenshot({
    path: shot("collapsed.png"),
    animations: "disabled",
  });
});

test("agents-view - every agent in one list", async ({ page }) => {
  const data = overviewData();
  await mountPanel(page, { data });
  // Switched through the real toolbar control rather than by seeding the state,
  // so the image shows what a click actually produces.
  await page.locator("[data-tool='view'][data-view='agents']").click();
  await page.locator("#root").screenshot({
    path: shot("agents-view.png"),
    animations: "disabled",
  });
});

test("preferences - the agents view's status order", async ({ page }) => {
  const data = overviewData();
  await mountPanel(page, { data, message: { type: "openSettings" }, height: 620 });
  await page.locator('.settings-tab[data-tab="preferences"]').click();
  await page.locator("#root").screenshot({
    path: shot("preferences.png"),
    animations: "disabled",
  });
});

test("settings - GitHub PR integration", async ({ page }) => {
  const data = overviewData();
  await mountPanel(page, { data, message: { type: "openSettings" } });
  await page.locator("#root").screenshot({ path: shot("settings.png"), animations: "disabled" });
});

test("linked-files - gitignored config linked into every worktree", async ({ page }) => {
  const data = overviewData();
  await mountPanel(page, { data, message: { type: "openSettings" }, height: 620 });
  await page.locator('.settings-tab[data-tab="linked"]').click();
  await page.locator("#root").screenshot({ path: shot("linked-files.png"), animations: "disabled" });
});

test("branches - all branches with PR status and filters", async ({ page }) => {
  const data = branchesData();
  // The branches view opens as a full editor tab, so render it wide like one.
  // No filter is selected by default, so the listing shows the full variety of
  // branches/PR states the view can display.
  await mountPanel(page, {
    data,
    view: "branches",
    width: 1000,
    height: 760,
  });
  await page.locator("#root").screenshot({ path: shot("branches.png"), animations: "disabled" });
});

test("skills - per-agent skills modal", async ({ page }) => {
  const data = overviewData();
  // Shorter viewport so the modal frames over the panel without acres of dim.
  await mountPanel(page, { data, height: 600 });
  // Open the skills list for the checkout agent (task-spec, source-generator).
  await page.locator('.skill-chip[data-session="s-co-1"]').click();
  await page.waitForSelector(".modal-backdrop .skill-list");
  // Full viewport: the dimmed panel stays visible behind the centered modal.
  await page.screenshot({ path: shot("skills.png"), animations: "disabled" });
});
