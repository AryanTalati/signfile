import { expect, test, type Page } from "@playwright/test";
import { signupFresh, uploadAgreement } from "./helpers";

// Uploads need LibreOffice + qpdf: run against the Docker image or a deployed URL.
test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image or live) for LibreOffice/qpdf");
test.setTimeout(180_000);

const fields = (page: Page) => page.getByTestId("field");
const saved = (page: Page) => expect(page.getByTestId("save-state")).toHaveText("All changes saved", { timeout: 15_000 });

test("PDF upload: fields detected with confidence; edit, retype, reassign, add, delete; changes persist", async ({ page, isMobile }) => {
  await signupFresh(page, "E2E Templates Co");
  await uploadAgreement(page, "fixtures/agreements/pdf-two-column.pdf");

  await expect(fields(page)).toHaveCount(8);
  await expect(page.getByTestId("field").first()).toBeVisible();
  expect(await page.locator("main").innerText()).not.toMatch(/\d+%/); // confidence is internal, never shown
  await expect(page.getByTestId("ready")).toBeVisible();
  await saved(page);

  // Select a client field, retype it and reassign it (one click each once selected).
  const client = page.locator('[data-testid="field"][data-role="client"][data-field-type="title"]');
  await client.click();
  const inspector = page.getByTestId("inspector");
  await inspector.getByRole("radio", { name: "Text" }).click();
  await inspector.getByRole("radio", { name: "E2E Templates Co" }).click();
  await expect(page.locator('[data-testid="field"][data-role="firm"][data-field-type="text"]')).toHaveCount(1);

  // Move it with a drag (desktop) and check it moved.
  const moved = page.locator('[data-testid="field"][data-field-type="text"]');
  if (!isMobile) {
    const box = (await moved.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 6 });
    await page.mouse.up();
    const after = (await moved.boundingBox())!;
    expect(after.x).toBeGreaterThan(box.x + 40);
    // Resize from the corner handle.
    const handle = moved.getByTestId("resize-handle");
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 50, hb.y + 20, { steps: 5 });
    await page.mouse.up();
    expect((await moved.boundingBox())!.width).toBeGreaterThan(after.width + 30);
  }

  // Add an initials field: pick the type, click the page.
  await page.getByRole("toolbar", { name: "Add a field" }).getByRole("button", { name: "Initials" }).click();
  const p1 = page.getByTestId("page-1");
  const pb = (await p1.boundingBox())!;
  await p1.click({ position: { x: pb.width * 0.8, y: pb.height * 0.3 } });
  await expect(fields(page)).toHaveCount(9);
  await expect(page.locator('[data-testid="field"][data-field-type="initials"]')).toHaveCount(1);

  // Delete it with the keyboard (desktop) or the inspector button.
  if (isMobile) await page.getByTestId("inspector").getByRole("button", { name: "Delete" }).click();
  else await page.keyboard.press("Delete");
  await expect(fields(page)).toHaveCount(8);
  await saved(page);

  // Reload: edits persisted.
  await page.reload();
  await expect(fields(page)).toHaveCount(8);
  await expect(page.locator('[data-testid="field"][data-role="firm"][data-field-type="text"]')).toHaveCount(1);
});

test("DOCX upload (real-world, no blank lines): fields found, uncertain ones flagged for review", async ({ page }) => {
  await signupFresh(page);
  await uploadAgreement(page, "fixtures/realworld/bonterms-cloud-terms-example-cover.docx");
  await expect(fields(page)).toHaveCount(10);
  await expect(page.locator('[data-testid="field"][data-flagged="true"]').first()).toBeVisible();
  const review = page.getByTestId("review-list");
  await expect(review).toBeVisible();
  const before = await page.locator('[data-testid="field"][data-flagged="true"]').count();
  await review.getByRole("button", { name: "Looks right" }).first().click();
  await expect(page.locator('[data-testid="field"][data-flagged="true"]')).toHaveCount(before - 1);
  await saved(page);
});

test("Scanned PDF: no fields found, append a signature page, ready to send", async ({ page }) => {
  await signupFresh(page);
  await uploadAgreement(page, "fixtures/agreements/pdf-scanned.pdf");
  await expect(page.getByText("We didn't find any signature fields")).toBeVisible();
  await expect(page.getByText("It looks scanned")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Append a signature page" }).click();
  await expect(fields(page)).toHaveCount(8, { timeout: 90_000 });
  await expect(page.getByTestId("page-3")).toBeVisible();
  await expect(page.getByTestId("ready")).toBeVisible();

  // Undo: remove the added page; a field placed elsewhere survives.
  await page.getByRole("toolbar", { name: "Add a field" }).getByRole("button", { name: "Initials" }).click();
  const p1 = page.getByTestId("page-1");
  const b = (await p1.boundingBox())!;
  await p1.click({ position: { x: b.width * 0.5, y: b.height * 0.3 } });
  await expect(fields(page)).toHaveCount(9);
  await expect(page.getByTestId("save-state")).toHaveText("All changes saved", { timeout: 15_000 });
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Remove the added signature page" }).click();
  await expect(page.getByTestId("page-3")).toHaveCount(0, { timeout: 90_000 });
  await expect(fields(page)).toHaveCount(1);
  await expect(page.locator('[data-testid="field"][data-field-type="initials"]')).toHaveCount(1);
});

test("Cancelling the append confirmation changes nothing", async ({ page }) => {
  await signupFresh(page);
  await uploadAgreement(page, "fixtures/agreements/pdf-scanned.pdf");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Append a signature page" }).click();
  await expect(page.getByText("We didn't find any signature fields")).toBeVisible();
  await expect(page.getByTestId("page-3")).toHaveCount(0);
  await expect(fields(page)).toHaveCount(0);
});

test("Scanned PDF: place fields by hand", async ({ page }) => {
  await signupFresh(page);
  await uploadAgreement(page, "fixtures/agreements/pdf-scanned.pdf");
  await page.getByRole("button", { name: "Place fields myself" }).click();
  const p2 = page.getByTestId("page-2");
  const b = (await p2.boundingBox())!;
  await p2.click({ position: { x: b.width * 0.4, y: b.height * 0.3 } });
  await expect(page.locator('[data-testid="field"][data-field-type="signature"][data-role="client"]')).toHaveCount(1);
  await expect(page.getByTestId("problems")).toContainText("signature field for the firm");
  // Firm doesn't need to countersign: turn it off and it's ready.
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("Firm signs too").uncheck();
  await expect(page.getByTestId("ready")).toBeVisible({ timeout: 15_000 });
});

test("Password-protected PDF is rejected with a clear message", async ({ page }) => {
  await signupFresh(page);
  await page.goto("/templates/new");
  await page.getByTestId("upload-input").setInputFiles("fixtures/agreements/pdf-encrypted-password.pdf");
  await expect(page.getByText("This PDF is password-protected")).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/templates\/new/);
});
