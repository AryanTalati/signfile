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
export async function sendFile(page: Page, fixture = "fixtures/agreements/pdf-two-column.pdf", client: { company: string; name: string; email: string; title?: string } = { company: "Globex Test Industries Ltd", name: "Jamie Example", email: "jamie@example.com" }) {
  await uploadAgreement(page, fixture);
  await page.getByRole("link", { name: "Create a File with this template" }).click();
  await page.getByLabel("Client's legal name").fill(client.company);
  await page.getByLabel("Name", { exact: true }).fill(client.name);
  await page.getByLabel("Email").fill(client.email);
  if (client.title) await page.getByLabel("Title (optional)").fill(client.title);
  // Any "Filled by you" values the template needs (fee, dates…).
  for (const input of await page.locator('input[name^="firm:"]').all()) await input.fill("2026-11-19");
  await page.getByRole("button", { name: "Send for signature" }).click();
  await page.waitForURL(/\/files\/[0-9a-f-]{36}\?sent=1/);
  return { fileUrl: page.url().replace("?sent=1", ""), clientLink: await page.getByTestId("signing-link").first().inputValue() };
}

/** Signs as whoever holds the link: consent, then fill every required field, then finish. */
export async function signViaLink(page: Page, link: string, opts: { navigate?: boolean } = {}) {
  if (opts.navigate !== false) await page.goto(link);
  const agree = page.getByRole("button", { name: /I agree/ });
  const progress = page.getByTestId("sign-progress");
  await expect(agree.or(progress)).toBeVisible(); // consent is asked once per signer
  if (await agree.isVisible()) await agree.click();
  await expect(progress).toBeVisible();
  const finish = page.getByRole("button", { name: "Finish and sign" });
  for (let i = 0; i < 20 && !(await finish.isVisible()); i++) {
    const before = await progress.textContent();
    await page.getByRole("button", { name: /^(Start|Next field)$/ }).click();
    const dialog = page.getByRole("dialog");
    // An already-adopted signature fills the next signature field with one tap (no dialog).
    await expect(dialog.or(page.getByText(new RegExp(`^(?!${(before ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$).* done$`)))).toBeVisible();
    if (await dialog.isVisible()) {
      if (await dialog.getByRole("button", { name: "Adopt and sign" }).isVisible()) await dialog.getByRole("button", { name: "Adopt and sign" }).click();
      else {
        await dialog.getByRole("textbox").fill("Test value");
        await dialog.getByRole("button", { name: "Save" }).click();
      }
      await expect(dialog).toBeHidden();
    }
    await expect(progress).not.toHaveText(before ?? "");
  }
  const submitted = page.waitForResponse((r) => r.url().includes("/submit"), { timeout: 30_000 });
  await finish.click();
  const res = await submitted;
  if (!res.ok()) throw new Error(`signing submit failed: ${res.status()} ${await res.text()}`);
  await expect(page.getByTestId("sign-done")).toBeVisible({ timeout: 30_000 });
}

/**
 * On an open signing page (after consent): the visible signable fields must be exactly this
 * signer's, and a submit that smuggles in values for other fields must be rejected.
 */
export async function expectOnlyOwnFields(page: Page, expectedCount: number) {
  await expect(page.locator('[data-testid^="sign-field-"]')).toHaveCount(expectedCount);
  await page.route("**/api/sign/*/submit", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    for (let i = 1; i <= 30; i++) body.values[`f${i}`] ??= "data:image/png;base64,iVBORw0KGgo=";
    await route.continue({ postData: JSON.stringify(body) });
  });
}

/** Hint/placeholder strings that must never appear inside the document area of a signing page. */
export const PLACEHOLDER_HINTS = [/Date added when you sign/i, /Filled in when everyone has signed/i, /added automatically/i];

export async function expectNoPlaceholdersInDocument(page: Page) {
  // Overlays sit inside the page containers; their visible text is what would look like document content.
  await expect(page.locator("[data-page]").first(), "no document pages found to check").toBeVisible(); // otherwise it checks nothing
  const texts = await page.locator("[data-page]").allInnerTexts();
  for (const t of texts) for (const re of PLACEHOLDER_HINTS) expect(t, `placeholder text in document: ${re}`).not.toMatch(re);
}

/** Settings: save title + a typed signature/initials for one-click signing. */
export async function saveMySignature(page: Page, title = "Managing Partner") {
  await page.goto("/settings");
  await page.getByLabel("Your title").fill(title);
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Set up my signature" }).click();
  await page.getByRole("button", { name: "Adopt and sign" }).click();
  await page.getByRole("button", { name: "Adopt and sign" }).click();
  await page.getByTestId("signature-settings").getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save my signature" }).click();
  await expect(page.getByAltText("Your saved signature")).toBeVisible();
}

/** Template editor: switch to "Firm signs when sending" and wait for the save. */
export async function setFirmSignsFirst(page: Page) {
  await page.getByRole("radio", { name: /Firm signs when sending/ }).check();
  await expect(page.getByTestId("save-state")).toHaveText("All changes saved", { timeout: 15_000 });
}
