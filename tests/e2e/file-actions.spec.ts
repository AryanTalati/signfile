import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { existsSync } from "node:fs";
import { sendFile, signupFresh } from "./helpers";

test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image) for uploads");
test.setTimeout(180_000);

test("void: reason required, links stop working, signer emailed, logged", async ({ page, browser }) => {
  await signupFresh(page, "E2E Void Co");
  const { fileUrl, clientLink } = await sendFile(page);
  await page.getByRole("button", { name: "Void this File" }).click();
  await page.getByRole("button", { name: "Void File" }).click(); // empty reason: blocked by the form
  await expect(page.getByTestId("file-status")).not.toHaveText("Voided");
  await page.getByLabel(/Why are you voiding it/).fill("Client chose a different scope");
  await page.getByRole("button", { name: "Void File" }).click();
  await expect(page.getByTestId("file-status")).toHaveText("Voided");
  await page.goto(fileUrl);
  await expect(page.getByTestId("file-status")).toHaveText("Voided");
  await expect(page.getByText("Reason: Client chose a different scope")).toBeVisible();
  await expect(page.getByText(/Voided: "/)).toBeVisible(); // email to the signer in the File's emails
  await expect(page.getByTestId("file-actions")).toHaveCount(0);
  // Timeline: plain English, never raw event names.
  const labels = await page.getByTestId("timeline-label").allInnerTexts();
  expect(labels).toContain("Voided by Test Admin: Client chose a different scope");
  expect(labels.some((l) => l.startsWith("Sent to Jamie Example"))).toBe(true);
  for (const l of labels) expect(l).not.toMatch(/\b[a-z]+\.[a-z_]+\b/);

  const c = await (await browser.newContext()).newPage();
  await c.goto(clientLink);
  await expect(c.getByTestId("sign-state-voided")).toContainText("This agreement was voided");
  const res = await c.request.post(clientLink.replace("/sign/", "/api/sign/") + "/consent");
  expect(res.status()).toBe(409);
});

test("resend: once per 10 minutes per signer", async ({ page }) => {
  await signupFresh(page, "E2E Resend Co");
  const { fileUrl } = await sendFile(page);
  // Right after sending: too soon.
  await page.getByRole("button", { name: /Resend to/ }).click();
  await expect(page.getByText(/emailed recently\. You can resend in (9|10) minutes/)).toBeVisible();

  // Age the original email past the cooldown, then resend works and is rate-limited again.
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  const fileId = fileUrl.split("/").pop()!;
  await sql`update outbox set created_at = now() - interval '11 minutes' where file_id = ${fileId}`;
  await sql.end();
  await page.reload();
  await page.getByRole("button", { name: /Resend to/ }).click();
  await expect(page.getByText(/^Resent to Jamie Example\.$/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/^Reminder: /).first()).toBeVisible();
  await page.getByRole("button", { name: /Resend to/ }).click();
  await expect(page.getByText(/emailed recently/)).toBeVisible();
});
