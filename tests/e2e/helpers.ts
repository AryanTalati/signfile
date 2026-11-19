import { expect, type Page } from "@playwright/test";

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

/** Uploads a fixture, creates and sends a File, returns the client's signing link. */
export async function sendFile(page: Page, fixture = "fixtures/agreements/pdf-two-column.pdf", client = { company: "Globex Test Industries Ltd", name: "Jamie Example", email: "jamie@example.com" }) {
  await uploadAgreement(page, fixture);
  await page.getByRole("link", { name: "Create a File with this template" }).click();
  await page.getByLabel("Client's legal name").fill(client.company);
  await page.getByLabel("Name", { exact: true }).fill(client.name);
  await page.getByLabel("Email").fill(client.email);
  await page.getByRole("button", { name: "Send for signature" }).click();
  await page.waitForURL(/\/files\/[0-9a-f-]{36}\?sent=1/);
  return { fileUrl: page.url().replace("?sent=1", ""), clientLink: await page.getByTestId("signing-link").first().inputValue() };
}

/** Signs as whoever holds the link: consent, then fill every required field, then finish. */
export async function signViaLink(page: Page, link: string) {
  await page.goto(link);
  await page.getByRole("button", { name: /I agree/ }).click();
  const progress = page.getByTestId("sign-progress");
  await expect(progress).toBeVisible();
  const finish = page.getByRole("button", { name: "Finish and sign" });
  for (let i = 0; i < 20 && !(await finish.isVisible()); i++) {
    const before = await progress.textContent();
    await page.getByRole("button", { name: /^(Start|Next field)$/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    if (await dialog.getByRole("button", { name: "Adopt and sign" }).isVisible()) await dialog.getByRole("button", { name: "Adopt and sign" }).click();
    else {
      await dialog.getByRole("textbox").fill("Test value");
      await dialog.getByRole("button", { name: "Save" }).click();
    }
    await expect(dialog).toBeHidden();
    await expect(progress).not.toHaveText(before ?? "");
  }
  const submitted = page.waitForResponse((r) => r.url().includes("/submit"), { timeout: 30_000 });
  await finish.click();
  const res = await submitted;
  if (!res.ok()) throw new Error(`signing submit failed: ${res.status()} ${await res.text()}`);
  await expect(page.getByTestId("sign-done")).toBeVisible({ timeout: 30_000 });
}
