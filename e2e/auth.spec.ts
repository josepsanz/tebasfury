import { expect, test } from "@playwright/test";

test("the homepage invites you to sign in when there is no session", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("the sign-in page offers Google", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /Google/i })).toBeVisible();
});

test("an admin route redirects anyone who has not signed in", async ({ page }) => {
  await page.goto("/admin/sync");
  await expect(page).toHaveURL(/\/login$/);
});

test("the portal is titled TebasFury", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/TebasFury/);
});

test("the sign-out control is hidden without a session", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
});

test("the sync endpoint refuses an unsigned request", async ({ request }) => {
  const res = await request.post("/api/sync", { data: { trigger: "manual" } });
  expect(res.status()).toBe(401);
});

test("the player sweep endpoint refuses an unsigned request", async ({ request }) => {
  const res = await request.post("/api/sync/players", { data: { trigger: "players-schedule" } });
  expect(res.status()).toBe(401);
});

// The standings and progress views need a session — any league manager's, not a
// particular permission — exactly like `/admin/sync` needs one plus a permission.
// This suite never signs in through Google (see the dummy env above), so these
// routes are only reachable here as an unauthenticated visitor, which means the
// one thing provable end-to-end is the same thing already proven for the admin
// route: the guard redirects rather than 404ing or leaking content. The pages'
// own markup — headings, the last-synced line, the four charts, the details/table
// view — is exercised visually against real data in Step 14, with a real session.

test("the standings page redirects anyone who has not signed in", async ({ page }) => {
  await page.goto("/standings");
  await expect(page).toHaveURL(/\/login$/);
});

test("the progress page redirects anyone who has not signed in", async ({ page }) => {
  await page.goto("/progress");
  await expect(page).toHaveURL(/\/login$/);
});

test("the standings and progress links are hidden without a session", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Standings" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Progress" })).toHaveCount(0);
});

test("the players page redirects anyone who has not signed in", async ({ page }) => {
  await page.goto("/players");
  await expect(page).toHaveURL(/\/login$/);
});

test("the players link is hidden without a session", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Players" })).toHaveCount(0);
});

test("a player page redirects anyone who has not signed in", async ({ page }) => {
  // The guard has to run before the lookup, or an anonymous visitor learns which ids
  // exist from the difference between a redirect and a 404.
  await page.goto("/players/9999");
  await expect(page).toHaveURL(/\/login$/);
});

test("the claim page redirects anyone who has not signed in", async ({ page }) => {
  await page.goto("/claim");
  await expect(page).toHaveURL(/\/login$/);
});

test("a team page redirects anyone who has not signed in", async ({ page }) => {
  await page.goto("/teams/38128693");
  await expect(page).toHaveURL(/\/login$/);
});
