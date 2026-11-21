import { expect, test, type Page } from "@playwright/test";
import { extractLayout } from "../../src/lib/pdf/extract";
import { sendFile, signupFresh, signViaLink, uploadAgreement } from "./helpers";

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

test("firm-filled dates default to today, stamp as 'November 20, 2026' in the surrounding font and size", async ({ page, browser }) => {
  await signupFresh(page, "E2E Certificate Co");
  await uploadAgreement(page, "fixtures/agreements/pdf-date-blanks.pdf");
  await page.getByRole("link", { name: "Create a File with this template" }).click();
  // Today in the sender's own time zone (not the server's, not a remembered value).
  const today = await page.evaluate(() => new Date().toLocaleDateString("en-CA"));
  const pickers = page.getByTestId("date-fill");
  await expect(pickers.first()).toHaveValue(today);
  const pretty = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
  await expect(page.getByText(`Appears in the agreement as ${pretty}.`).first()).toBeVisible();
  await page.getByLabel("Client's legal name").fill("Initech Test Co.");
  await page.getByLabel("Name", { exact: true }).fill("Sam Example");
  await page.getByLabel("Email").fill("sam@example.com");
  await page.getByRole("button", { name: "Send for signature" }).click();
  await page.waitForURL(/\/files\/[0-9a-f-]{36}\?sent=1/);
  const fileUrl = page.url().replace("?sent=1", "");
  const clientLink = await page.getByTestId("signing-link").first().inputValue();
  await signViaLink(await (await browser.newContext()).newPage(), clientLink);
  await page.goto(fileUrl);
  await signViaLink(page, await page.getByTestId("recipient-firm").getByTestId("signing-link").inputValue());

  await page.goto(fileUrl);
  const res = await page.request.get((await page.getByTestId("download-signed").getAttribute("href"))!);
  const layout = await extractLayout(new Uint8Array(await res.body()));
  const all = layout.flatMap((p) => p.items);
  expect(all.map((i) => i.str).join(" ")).not.toContain(today); // never the raw yyyy-mm-dd
  // "Dated: ____" on the last agreement page: the stamped date matches the label's font and size.
  const page3 = layout.find((p) => p.items.some((i) => /^Dated:?/.test(i.str)))!;
  const label = page3.items.find((i) => /^Dated:?/.test(i.str))!;
  const stamped = page3.items.find((i) => i.str.includes(pretty) && Math.abs(i.baseline - label.baseline) < 6)!;
  expect(stamped, `"${pretty}" stamped next to "Dated:"`).toBeTruthy();
  expect(stamped.family).toBe(label.family);
  expect(Math.abs(stamped.h - label.h)).toBeLessThan(0.6);
});
