import { expect, test, type Page } from "@playwright/test";
import { extractLayout } from "../../src/lib/pdf/extract";
import { saveMySignature, sendFile, signupFresh, signViaLink } from "./helpers";

test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image) for uploads");
test.setTimeout(240_000);

async function sealedText(page: Page, fileUrl: string) {
  await page.goto(fileUrl);
  const res = await page.request.get((await page.getByTestId("download-signed").getAttribute("href"))!);
  const pages = await extractLayout(new Uint8Array(await res.body()));
  return pages.map((p) => p.items.map((i) => i.str).join(" ")).join("\n");
}

test("auto-countersign: off by default; when on, the firm's saved signature is applied as soon as the client signs and the File seals", async ({ page, browser }) => {
  await signupFresh(page, "E2E Auto Countersign Co");
  await saveMySignature(page);
  const auto = page.getByTestId("auto-countersign");
  await expect(auto.getByTestId("auto-countersign-status")).toHaveText(/^Off\./);

  // Off: the File waits for the countersigner.
  const off = await sendFile(page);
  await signViaLink(await (await browser.newContext()).newPage(), off.clientLink);
  await page.goto(off.fileUrl);
  await expect(page.getByTestId("file-status")).toHaveText("Waiting for countersign");

  // Turn it on (explicit authorization required).
  await page.goto("/settings");
  await auto.getByRole("button", { name: "Turn on…" }).click();
  await expect(auto.getByRole("button", { name: "Turn on automatic countersigning" })).toBeDisabled();
  await auto.getByRole("checkbox").check();
  await auto.getByRole("button", { name: "Turn on automatic countersigning" }).click();
  await expect(auto.getByTestId("auto-countersign-status")).toHaveText(/^On since/);

  const { fileUrl, clientLink } = await sendFile(page);
  const client = await (await browser.newContext()).newPage();
  await signViaLink(client, clientLink);
  await expect(client.getByTestId("sign-done")).toContainText("Everyone has signed");

  await page.goto(fileUrl);
  await expect(page.getByTestId("file-status")).toHaveText("Signed");
  await expect(page.getByText("Signed and sealed")).toBeVisible();
  await expect(page.getByTestId("recipient-firm").getByTestId("recipient-status")).toHaveText("Signed");
  const labels = await page.getByTestId("timeline-label").allInnerTexts();
  expect(labels.some((l) => /^Countersigned automatically with Test Admin's saved signature \(authorized [A-Z][a-z]{2} \d{1,2}, \d{4}\)$/.test(l))).toBe(true);
  await expect(page.getByText(/^Countersign: /)).toHaveCount(0); // no "please countersign" email

  const text = await sealedText(page, fileUrl);
  expect(text).toMatch(/Countersigned automatically with Test Admin's saved signature/);
  // The signer block says how it was signed, and when/where it was authorized (no raw ISO in a "Browser" row).
  expect(text).toContain("Method Automatic countersign using saved signature");
  const authorized = /Authorized (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC) \/ [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d\d:\d\d [AP]M MST, IP [^,]+, browser (Chrome|Edge|Firefox|Safari) \d+ on (Windows|macOS|Linux)/.exec(text);
  expect(text).not.toContain("Mozilla/5.0"); // short browser summary; the full string stays in the audit record
  expect(authorized, "Authorized row").toBeTruthy();
  expect(text).not.toMatch(/Automatic countersign authorized \d{4}-/);
  // "Agreed to e-sign" is the authorization time, not the signing time.
  expect(text).toContain(`Agreed to e-sign ${authorized![1]} / `);
  expect(text).toMatch(/Test Admin agreed to sign electronically in advance, by authorizing automatic countersign on [A-Z][a-z]{2} \d{1,2}, \d{4}/);

  // Turning it off applies to the next File.
  await page.goto("/settings");
  await auto.getByRole("button", { name: "Turn off" }).click();
  await expect(auto.getByTestId("auto-countersign-status")).toHaveText(/^Off\./);
});
