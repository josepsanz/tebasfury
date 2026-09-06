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
