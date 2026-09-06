import { expect, test } from "@playwright/test";

test("la portada convida a entrar quan no hi ha sessió", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Entra" })).toBeVisible();
});

test("la pàgina d'entrada ofereix Google", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /Google/i })).toBeVisible();
});

test("una ruta d'administració desvia qui no ha entrat", async ({ page }) => {
  await page.goto("/admin/sincronitzacio");
  await expect(page).toHaveURL(/\/login$/);
});

test("el títol del portal és TebasFury", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/TebasFury/);
});
