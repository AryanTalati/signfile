import { expect, test } from "@playwright/test";
import { signupFresh, uploadAgreement } from "./helpers";

test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image) for uploads");
test.setTimeout(180_000);

test("create and send a File: link shown immediately, signers and outbox recorded", async ({ page }) => {
  await signupFresh(page, "E2E Files Co");
  await uploadAgreement(page, "fixtures/agreements/pdf-two-column.pdf");
  await page.getByRole("link", { name: "Create a File with this template" }).click();
  await page.waitForURL(/\/files\/new\?template=/);

  // Validation: nothing filled.
  await page.getByRole("button", { name: "Send for signature" }).click();
  await expect(page.getByText("Enter the client's legal name.")).toBeVisible();

  await page.getByLabel("Client's legal name").fill("Globex Test Industries Ltd");
  await page.getByLabel("Reference (optional)").fill("JOB-1001");
  await page.getByLabel("Name", { exact: true }).fill("Jamie Example");
  await page.getByLabel("Title (optional)").fill("COO");
  await page.getByLabel("Email").fill("jamie@example.com");
  await page.getByRole("button", { name: "Send for signature" }).click();
  await page.waitForURL(/\/files\/[0-9a-f-]{36}\?sent=1/);

  await expect(page.getByTestId("file-status")).toHaveText("Waiting for client");
  await expect(page.getByTestId("signing-link").first()).toHaveValue(/\/sign\/[A-Za-z0-9_-]{40,}$/);
  await expect(page.getByTestId("recipient-client").getByTestId("recipient-status")).toHaveText("Link sent, not opened");
  await expect(page.getByTestId("recipient-firm").getByTestId("recipient-status")).toHaveText("Waiting for earlier signer");
  await expect(page.getByText("Not sent (outbox only)")).toBeVisible();
  await expect(page.getByText("Sent for signature")).toBeVisible();

  // It's on the Files list.
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: /Globex Test Industries Ltd/ })).toBeVisible();
});

test("'Filled by you' values are required before sending", async ({ page }) => {
  await signupFresh(page);
  await uploadAgreement(page, "fixtures/agreements/pdf-date-blanks.pdf");
  await page.getByRole("link", { name: "Create a File with this template" }).click();
  await page.getByLabel("Client's legal name").fill("Initech Test Co.");
  await page.getByLabel("Name", { exact: true }).fill("Sam Example");
  await page.getByLabel("Email").fill("sam@example.com");
  await page.getByRole("button", { name: "Send for signature" }).click();
  await expect(page.getByText('Fill in "Date".')).toBeVisible();
  await page.getByLabel("Date", { exact: true }).fill("November 20, 2026");
  await page.getByRole("button", { name: "Send for signature" }).click();
  await page.waitForURL(/\/files\/[0-9a-f-]{36}\?sent=1/);
  await expect(page.getByTestId("file-status")).toHaveText("Waiting for client");
});
