import { expect, test, type Page } from "@playwright/test";
import { extractLayout } from "../../src/lib/pdf/extract";
import { sendFile, signupFresh, signViaLink } from "./helpers";

test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image) for uploads");
test.setTimeout(240_000);

/** Text of the sealed PDF, split into the agreement pages and the certificate. */
export async function sealedParts(page: Page, fileUrl: string) {
  await page.goto(fileUrl);
  const res = await page.request.get((await page.getByTestId("download-signed").getAttribute("href"))!);
  const pages = (await extractLayout(new Uint8Array(await res.body()))).map((p) => p.items.map((i) => i.str).join(" "));
  const at = pages.findIndex((p) => p.includes("Certificate of Completion"));
  return { agreement: pages.slice(0, at).join("\n"), certificate: pages.slice(at).join("\n") };
}

/** Opens a signing link, agrees, and types `value` into this signer's first field of `type`. */
async function typeInto(page: Page, link: string, type: string, value: string) {
  await page.goto(link);
  await page.getByRole("button", { name: /I agree/ }).click();
  await page.getByTestId(`sign-field-${type}`).first().click();
  await page.getByRole("dialog").getByRole("textbox").fill(value);
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

test("certificate shows each signer's title as used in the signed document", async ({ page, browser }) => {
  await signupFresh(page, "E2E Certificate Co");
  // Profile title differs from what the firm signer uses in this agreement.
  await page.goto("/settings");
  await page.getByLabel("Your title").fill("CEO");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  // No client title on the File: the client types one at signing.
  const { fileUrl, clientLink } = await sendFile(page);
  const c = await (await browser.newContext()).newPage();
  await typeInto(c, clientLink, "title", "ceo");
  await signViaLink(c, clientLink, { navigate: false });

  await page.goto(fileUrl);
  const firmLink = await page.getByTestId("recipient-firm").getByTestId("signing-link").inputValue();
  await typeInto(page, firmLink, "title", "Managing Partner");
  await signViaLink(page, firmLink, { navigate: false });

  const { agreement, certificate } = await sealedParts(page, fileUrl);
  expect(agreement).toContain("ceo");
  expect(agreement).toContain("Managing Partner");
  expect(certificate).toMatch(/Title\s+ceo/);
  expect(certificate).toMatch(/Title\s+Managing Partner/);
  expect(certificate).not.toMatch(/Title\s+CEO/); // not the profile title
  expect(certificate).toContain("Title changed from CEO to Managing Partner by Test Admin");

  // Times: UTC first, then the firm's time zone (taken from the browser at signup).
  const stamp = String.raw`\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC / [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d\d:\d\d [AP]M MST`;
  expect(certificate).toMatch(new RegExp(`Completed ${stamp}`));
  expect(certificate).toContain("Event log (UTC / America/Phoenix)");
  expect(certificate).toMatch(new RegExp(`${stamp}\\s+All parties signed`));
  expect(certificate).not.toMatch(/UTC (?!\/)[A-Z][a-z]+ /); // no event line with UTC only
});
