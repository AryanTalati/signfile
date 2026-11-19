import { expect, test } from "@playwright/test";
import { loginAsDemo, signupFresh, uploadAgreement } from "./helpers";

/**
 * Live-site smoke test: short and gentle on the 0.1-CPU free instance.
 * The full suite runs against the local Docker image.
 *   E2E_BASE_URL=https://signfile.onrender.com npx playwright test
 */
test.setTimeout(240_000);

test("demo login loads the dashboard", async ({ page }) => {
  await loginAsDemo(page);
  await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("Astra AI");
});

test("upload PDF + DOCX, edit and save, scanned-PDF fallback", async ({ page }) => {
  await signupFresh(page, "E2E Smoke Co");
  const fields = page.getByTestId("field");
  const saved = () => expect(page.getByTestId("save-state")).toHaveText("All changes saved", { timeout: 20_000 });

  // PDF: fields detected with confidence; retype one and save.
  await uploadAgreement(page, "fixtures/agreements/pdf-two-column.pdf");
  await expect(fields).toHaveCount(8);
  await expect(page.getByTestId("confidence").first()).toBeVisible();
  await page.locator('[data-testid="field"][data-role="client"][data-field-type="title"]').click();
  await page.getByTestId("inspector").getByRole("radio", { name: "Text" }).click();
  await expect(page.locator('[data-testid="field"][data-role="client"][data-field-type="text"]')).toHaveCount(1);
  await saved();
  await page.reload();
  await expect(page.locator('[data-testid="field"][data-role="client"][data-field-type="text"]')).toHaveCount(1);

  // DOCX (real-world, converted by LibreOffice on the server).
  await uploadAgreement(page, "fixtures/realworld/bonterms-cloud-terms-example-cover.docx");
  await expect(fields).toHaveCount(10);
  await expect(page.getByTestId("review-list")).toBeVisible();

  // Scanned PDF: nothing detected, append a signature page.
  await uploadAgreement(page, "fixtures/agreements/pdf-scanned.pdf");
  await expect(page.getByText("We didn't find any signature fields")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Append a signature page" }).click();
  await expect(fields).toHaveCount(8, { timeout: 60_000 });
  await expect(page.getByTestId("ready")).toBeVisible();
});
