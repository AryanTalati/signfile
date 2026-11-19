import type { Page } from "@playwright/test";

/** Every account the tests create uses this domain, so teardown can find and purge them. */
export const E2E_DOMAIN = "signfile-e2e.example";

export const uniqueEmail = (tag: string) =>
  `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${E2E_DOMAIN}`;

export async function loginAsDemo(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Log in to the demo" }).click();
  await page.waitForURL("**/dashboard");
}

/** Signs up a throwaway company (purged in teardown) so tests never touch the demo account. */
export async function signupFresh(page: Page, company = `E2E Co ${Math.random().toString(36).slice(2, 7)}`) {
  await page.goto("/signup");
  await page.getByLabel("Company name").fill(company);
  await page.getByLabel("Your name").fill("Test Admin");
  await page.getByLabel("Work email").fill(uniqueEmail("tpl"));
  await page.getByLabel("Password").fill("a-long-enough-password");
  await page.getByRole("button", { name: "Create company" }).click();
  await page.waitForURL("**/dashboard?welcome=1");
}

/** Uploads a fixture on /templates/new and waits for the editor. */
export async function uploadAgreement(page: Page, file: string) {
  await page.goto("/templates/new");
  await page.getByTestId("upload-input").setInputFiles(file);
  await page.waitForURL(/\/templates\/[0-9a-f-]{36}/, { timeout: 120_000 });
}
