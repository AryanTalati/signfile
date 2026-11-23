import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { parseCsv } from "../../src/lib/bulk/core";
import { signupFresh, uploadAgreement } from "./helpers";

/** Bulk send from CSV. Desktop Chromium only; test addresses (example.com) are captured, never emailed. */
test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image)");
test.skip(({ browserName, isMobile }) => browserName !== "chromium" || !!isMobile, "desktop Chromium only");
test.setTimeout(240_000);

// 3 valid rows, a bad email, a missing client name, and a duplicate of row 1.
const SAMPLE = readFileSync("fixtures/bulk/clients-sample.csv");

async function openBulk(page: Page) {
  await uploadAgreement(page, "fixtures/agreements/pdf-two-column.pdf");
  await page.getByRole("link", { name: "Bulk send from CSV" }).click();
  await page.waitForURL(/\/templates\/[0-9a-f-]{36}\/bulk$/);
}
async function uploadCsv(page: Page, buffer = SAMPLE) {
  await page.getByTestId("bulk-upload").setInputFiles({ name: "clients.csv", mimeType: "text/csv", buffer });
  await expect(page.getByTestId("map-signer_email")).toHaveValue("2"); // headers mapped automatically
  await page.getByTestId("validate").click();
  await expect(page.getByTestId("preview")).toBeVisible();
}
const statuses = (page: Page) => page.getByTestId("preview-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-status")));
async function runAndWait(page: Page) {
  await page.getByTestId("start").click();
  await page.getByTestId("confirm-start").click();
  await page.waitForURL(/\/bulk\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("batch-status")).toHaveText("Finished", { timeout: 60_000 });
}

test("valid rows become sent Files, bad rows are skipped with reasons, the result CSV matches; re-upload skips them unless Resend", async ({ page }) => {
  await signupFresh(page, "E2E Bulk Co");
  await openBulk(page);
  // The header row for this template (no "Filled by you" fields: signer columns only).
  const tpl = await page.request.get((await page.getByTestId("csv-template").getAttribute("href"))!);
  expect(parseCsv(await tpl.text())[0]).toEqual(["client_legal_name", "signer_name", "signer_email", "signer_title", "reference", "external_id", "cc_emails"]);

  await uploadCsv(page);
  expect(await statuses(page)).toEqual(["ready", "ready", "ready", "invalid", "invalid", "duplicate"]);
  const reasons = await page.getByTestId("row-reason").allInnerTexts();
  expect(reasons).toEqual(['"not-an-email" isn\'t a valid email', "Client legal name is empty", "same signer as row 1 (same external_id)"]);
  await expect(page.getByTestId("preview-summary")).toHaveText("3 ready to send, 3 will be skipped.");

  await runAndWait(page);
  await expect(page.getByTestId("batch-summary")).toHaveText("3 sent, 3 skipped");
  const rows = page.getByTestId("batch-row");
  await expect(rows.filter({ hasText: "Sent" })).toHaveCount(3);
  // Each File is a normal File: open one.
  await rows.first().getByRole("link", { name: "Sent" }).click();
  await expect(page.getByTestId("file-status")).toHaveText("Waiting for client");
  await expect(page.getByTestId("timeline-label").filter({ hasText: "File created by Test Admin (bulk send from CSV)" })).toHaveCount(1);
  await page.goBack();

  // Result CSV: every input row + status, File link or skip reason.
  const res = await page.request.get((await page.getByTestId("result-csv").getAttribute("href"))!);
  const out = parseCsv(await res.text());
  expect(out[0]).toEqual(["client_legal_name", "signer_name", "signer_email", "signer_title", "reference", "external_id", "file_status", "file_link", "skip_reason"]);
  expect(out.slice(1).map((r) => r[6])).toEqual(["sent", "sent", "sent", "skipped", "skipped", "skipped"]);
  expect(out[1][7]).toMatch(/\/files\/[0-9a-f-]{36}$/);
  expect(out[4][8]).toBe('"not-an-email" isn\'t a valid email');
  expect(out.slice(1).map((r) => r[0])).toEqual(parseCsv(SAMPLE.toString()).slice(1).map((r) => r[0]));
  // Three signing emails (captured: test addresses), one per sent File.
  await page.goto("/outbox");
  await expect(page.getByTestId("outbox-row").filter({ hasText: "please sign" })).toHaveCount(3);

  // Same CSV again: the three already-sent rows are skipped...
  await page.goto("/templates");
  await page.getByTestId("template-row").first().click();
  await page.getByRole("link", { name: "Bulk send from CSV" }).click();
  await uploadCsv(page);
  expect(await statuses(page)).toEqual(["already_sent", "already_sent", "already_sent", "invalid", "invalid", "duplicate"]);
  await expect(page.getByTestId("start")).toHaveCount(0); // nothing to send
  // ...unless the firm ticks Resend for one of them.
  await page.getByTestId("resend-2").check();
  await expect(page.getByTestId("preview-summary")).toHaveText("1 ready to send, 5 will be skipped.");
  await runAndWait(page);
  await expect(page.getByTestId("batch-summary")).toHaveText("1 sent, 5 skipped");
  await page.goto("/bulk");
  await expect(page.getByTestId("batch-history-row")).toHaveCount(2);
});

test("Validate only creates nothing: no Files, no emails, no run in history; the validation CSV shows what would happen", async ({ page }) => {
  await signupFresh(page, "E2E Bulk Co");
  await openBulk(page);
  await uploadCsv(page);
  const download = page.waitForEvent("download");
  await page.getByTestId("validation-csv").click();
  const csv = parseCsv(readFileSync(await (await download).path()).toString());
  expect(csv.slice(1).map((r) => r[6])).toEqual(["would send", "would send", "would send", "skipped", "skipped", "skipped"]);

  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: /Acme Test Holdings/ })).toHaveCount(0);
  await page.goto("/outbox");
  await expect(page.getByTestId("outbox-row")).toHaveCount(0);
  await page.goto("/bulk");
  await expect(page.getByTestId("batch-history-row")).toHaveCount(0);
});

test("a CSV can be chosen with the styled button; its name is shown", async ({ page }) => {
  await signupFresh(page, "E2E Bulk Co");
  await openBulk(page);
  await expect(page.getByText("Choose CSV file")).toBeVisible();
  await expect(page.getByTestId("csv-name")).toHaveText("or drop it here");
  const chooser = page.waitForEvent("filechooser");
  await page.getByText("Choose CSV file").click();
  await (await chooser).setFiles({ name: "clients.csv", mimeType: "text/csv", buffer: SAMPLE });
  await expect(page.getByTestId("csv-name")).toHaveText("clients.csv");
  await expect(page.getByTestId("mapping")).toBeVisible();
});
