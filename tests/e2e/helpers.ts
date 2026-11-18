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
