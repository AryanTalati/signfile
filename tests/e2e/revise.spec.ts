import { expect, test, type Browser, type Page } from "@playwright/test";
import { extractLayout } from "../../src/lib/pdf/extract";
import { sendFile, signupFresh, signViaLink } from "./helpers";

test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image) for uploads");
test.setTimeout(300_000);

/** Upload a revised version: lands on the match summary (not the editor). */
async function uploadRevision(page: Page, fileUrl: string, fixture = "fixtures/agreements/pdf-two-column.pdf") {
  await page.goto(fileUrl);
  await page.getByTestId("revise").click();
  await expect(page.getByTestId("revise-banner")).toBeVisible();
  await page.getByTestId("upload-input").setInputFiles(fixture);
  await page.waitForURL(/\/files\/[0-9a-f-]{36}\/revise\?template=/, { timeout: 120_000 });
}

async function reviseAndResend(page: Page, fileUrl: string) {
  await uploadRevision(page, fileUrl);
  await page.getByTestId("send-revision").click();
  await page.waitForURL(/\/files\/[0-9a-f-]{36}\?revised=1/);
}

async function linkFor(page: Page, role: "client" | "firm") {
  return page.getByTestId(`recipient-${role}`).getByTestId("signing-link").inputValue();
}

async function sealedText(page: Page, fileUrl: string) {
  await page.goto(fileUrl);
  const res = await page.request.get((await page.getByTestId("download-signed").getAttribute("href"))!);
  const pages = await extractLayout(new Uint8Array(await res.body()));
  return pages.map((p) => p.items.map((i) => i.str).join(" ")).join("\n");
}

async function completeBoth(page: Page, browser: Browser, fileUrl: string) {
  await page.goto(fileUrl);
  await signViaLink(await (await browser.newContext()).newPage(), await linkFor(page, "client"));
  await page.goto(fileUrl);
  await signViaLink(page, await linkFor(page, "firm"));
  await page.goto(fileUrl);
  await expect(page.getByTestId("file-status")).toHaveText("Signed");
}

test("revise after 'Changes requested': old version superseded, new links work, certificate covers only the signed version", async ({ page, browser }) => {
  await signupFresh(page, "E2E Revise Co");
  const { fileUrl, clientLink: oldClientLink } = await sendFile(page);
  const c = await (await browser.newContext()).newPage();
  await c.goto(oldClientLink);
  await c.getByRole("button", { name: "Request changes" }).click();
  await c.getByRole("dialog").getByRole("textbox").fill("Please change the payment terms to net 45.");
  await c.getByRole("dialog").getByRole("button", { name: "Send request" }).click();
  await expect(c.getByTestId("sign-responded-changes_requested")).toBeVisible();

  await reviseAndResend(page, fileUrl);
  await expect(page.getByTestId("file-status")).toHaveText("Waiting for client");
  await expect(page.getByTestId("versions")).toContainText("Version 2");
  await expect(page.getByTestId("versions")).toContainText("current");
  await expect(page.getByTestId("versions")).toContainText("superseded");
  const newClientLink = await linkFor(page, "client");
  expect(newClientLink).not.toBe(oldClientLink);
  await expect(page.getByText(/revised "/).first()).toBeVisible(); // revised email to the client

  // The old link no longer works.
  await c.goto(oldClientLink);
  await expect(c.getByTestId("sign-state-replaced")).toBeVisible();

  await completeBoth(page, browser, fileUrl);
  await expect(page.getByTestId("timeline-label").filter({ hasText: "Revised version 2 sent" })).toHaveCount(1);
  const text = await sealedText(page, fileUrl);
  expect(text).toContain("(version 2)");
  expect(text).not.toContain("payment terms to net 45");
  expect(text).not.toMatch(/requested changes/i);
});

test("revise after 'Declined': previous signer must sign again; certificate covers only the signed version", async ({ page, browser }) => {
  await signupFresh(page, "E2E Revise Co");
  const { fileUrl, clientLink: oldClientLink } = await sendFile(page);
  // Client signs version 1, then the firm declines.
  await signViaLink(await (await browser.newContext()).newPage(), oldClientLink);
  await page.goto(fileUrl);
  const firmV1 = await linkFor(page, "firm");
  const f = await (await browser.newContext()).newPage();
  await f.goto(firmV1);
  await f.getByRole("button", { name: "Decline to sign" }).click();
  await f.getByRole("dialog").getByRole("textbox").fill("Wrong rate card attached");
  await f.getByRole("dialog").getByRole("button", { name: "Decline" }).click();
  await f.getByRole("dialog").getByRole("button", { name: "Yes, decline" }).click();
  await expect(f.getByTestId("sign-responded-declined")).toBeVisible();
  await page.goto(fileUrl);
  await expect(page.getByTestId("file-status")).toHaveText("Declined");

  await reviseAndResend(page, fileUrl);
  await expect(page.getByTestId("file-status")).toHaveText("Waiting for client");
  // The client signed v1, so the email asks them to sign again.
  await page.goto("/outbox");
  await page.getByTestId("outbox-row").filter({ hasText: "(version 2) to sign" }).getByTestId("outbox-open").click();
  await expect(page.frameLocator('[data-testid="email-body"]').getByText(/sign this version again/)).toBeVisible();

  await completeBoth(page, browser, fileUrl);
  const text = await sealedText(page, fileUrl);
  expect(text).toContain("(version 2)");
  expect(text).not.toContain("Wrong rate card attached");
  expect(text).not.toMatch(/Declined by/);
});

test("unchanged fields: nothing to review, one click to send; 'What changed?' prefilled and emailed", async ({ page, browser }) => {
  await signupFresh(page, "E2E Revise Co");
  const { fileUrl, clientLink } = await sendFile(page, "fixtures/agreements/pdf-two-column.pdf");
  const c = await (await browser.newContext()).newPage();
  await c.goto(clientLink);
  await c.getByRole("button", { name: "Request changes" }).click();
  await c.getByRole("dialog").getByRole("textbox").fill("Fix the typo in clause 3.");
  await c.getByRole("dialog").getByRole("button", { name: "Send request" }).click();
  await expect(c.getByTestId("sign-responded-changes_requested")).toBeVisible();

  await uploadRevision(page, fileUrl);
  await expect(page.getByTestId("match-summary")).toContainText("8 of 8 fields matched. Nothing to review.");
  await expect(page.getByTestId("flagged-field")).toHaveCount(0);
  await expect(page.getByTestId("review-all")).toBeVisible();
  await expect(page.getByTestId("what-changed")).toHaveValue("Fix the typo in clause 3.");
  await page.getByTestId("send-revision").click(); // the one click
  await page.waitForURL(/\?revised=1/);
  await expect(page.getByTestId("file-status")).toHaveText("Waiting for client");
  // Carried over: same client signer; values; the note is in the audit trail and the email.
  await expect(page.getByTestId("recipient-client")).toContainText("Jamie Example");
  await expect(page.getByTestId("timeline-label").filter({ hasText: "What changed: Fix the typo in clause 3." })).toHaveCount(1);
  await page.goto("/outbox");
  await page.getByTestId("outbox-row").filter({ hasText: "(version 2) to sign" }).getByTestId("outbox-open").click();
  await expect(page.frameLocator('[data-testid="email-body"]').getByText("Fix the typo in clause 3.")).toBeVisible();
});

test("moved and added fields: moved ones match, only the new field is flagged for review", async ({ page, browser }) => {
  await signupFresh(page, "E2E Revise Co");
  const { fileUrl, clientLink } = await sendFile(page, "fixtures/agreements/pdf-two-column.pdf");
  const c = await (await browser.newContext()).newPage();
  await c.goto(clientLink);
  await c.getByRole("button", { name: "Request changes" }).click();
  await c.getByRole("dialog").getByRole("textbox").fill("Please add an initials line for us.");
  await c.getByRole("dialog").getByRole("button", { name: "Send request" }).click();
  await expect(c.getByTestId("sign-responded-changes_requested")).toBeVisible();

  await uploadRevision(page, fileUrl, "fixtures/agreements/pdf-two-column-revised.pdf");
  await expect(page.getByTestId("match-summary")).toContainText("8 of 8 fields matched. 1 field needs a look.");
  await expect(page.getByTestId("flagged-field")).toHaveCount(1);
  await expect(page.getByTestId("flagged-field")).toContainText("Initials");
  await expect(page.getByTestId("flagged-field")).toContainText("new in this version");
  await expect(page.getByTestId("send-revision")).toBeDisabled();

  // Review shows only that field.
  await page.getByTestId("review-flagged").click();
  await expect(page.getByTestId("field")).toHaveCount(1);
  await expect(page.locator('[data-testid="field"][data-field-type="initials"]')).toHaveCount(1);
  await page.getByTestId("review-list").getByRole("button", { name: "Looks right" }).click();
  await expect(page.getByTestId("save-state")).toHaveText("All changes saved", { timeout: 15_000 });
  await page.getByTestId("back-to-revision").click();
  await page.waitForURL(/\/revise\?template=/);
  await expect(page.getByTestId("send-revision")).toBeEnabled();
  await page.getByTestId("send-revision").click();
  await page.waitForURL(/\?revised=1/);
  await expect(page.getByTestId("file-status")).toHaveText("Waiting for client");
});
