import { expect, test } from "@playwright/test";
import { loginAsDemo, uniqueEmail } from "./helpers";

test("signed-out visitors are sent to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
});

test("demo login, then log out", async ({ page }) => {
  await loginAsDemo(page);
  await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("Astra AI");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("wrong password shows a clear error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(uniqueEmail("nobody"));
  await page.getByLabel("Password").fill("definitely-wrong");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByText("That email and password don't match.")).toBeVisible();
});

test("signup creates a company and its admin", async ({ page }) => {
  const email = uniqueEmail("signup");
  await page.goto("/signup");

  // Validation: short password.
  await page.getByLabel("Company name").fill("E2E Test Consulting");
  await page.getByLabel("Your name").fill("Test Admin");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page.getByText("Use at least 10 characters.")).toBeVisible();

  await page.getByLabel("Password").fill("a-long-enough-password");
  await page.getByRole("button", { name: "Create company" }).click();
  await page.waitForURL("**/dashboard?welcome=1");
  await expect(page.getByRole("status")).toContainText("E2E Test Consulting is set up");
  await expect(page.getByRole("banner")).toContainText("E2E Test Consulting");

  // Same email can't sign up twice.
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL("**/login");
  await page.goto("/signup");
  await page.getByLabel("Company name").fill("Another Co");
  await page.getByLabel("Your name").fill("Someone");
  await page.getByLabel("Work email").fill(email.toUpperCase());
  await page.getByLabel("Password").fill("a-long-enough-password");
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page.getByText("already exists")).toBeVisible();

  // And the new account can log back in.
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-long-enough-password");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL("**/dashboard");
});
