import { expect, test, type Page } from "@playwright/test";
import { signupFresh, uploadAgreement } from "./helpers";

// Uploads need LibreOffice + qpdf: run against the Docker image. Desktop Chromium only.
test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image)");
test.skip(({ browserName, isMobile }) => browserName !== "chromium" || !!isMobile, "desktop Chromium only");
test.setTimeout(180_000);

const SAAS = "fixtures/agreements/pdf-saas-table.pdf";
const field = (page: Page, role: string, type: string) => page.locator(`[data-testid="field"][data-role="${role}"][data-field-type="${type}"]`);
const saved = (page: Page) => expect(page.getByTestId("save-state")).toHaveText("All changes saved", { timeout: 15_000 });
/** Every field as "role type x y w h", sorted: positions included, so a reset shows up. */
const snapshot = (page: Page) =>
  page.getByTestId("field").evaluateAll((els) =>
    els.map((e) => `${e.getAttribute("data-role")} ${e.getAttribute("data-field-type")} ${(e as HTMLElement).style.left} ${(e as HTMLElement).style.top} ${(e as HTMLElement).style.width} ${(e as HTMLElement).style.height}`).sort(),
  );

test("switching the firm's signing mode keeps every field, including a manual type change", async ({ page }) => {
  await signupFresh(page, "E2E Editor Co");
  await uploadAgreement(page, SAAS);
  await expect(page.getByTestId("field")).toHaveCount(10);
  // Manual edit: the client's Title becomes a Text field.
  await field(page, "client", "title").click();
  await page.getByTestId("inspector").getByRole("radio", { name: "Text" }).click();
  await expect(field(page, "client", "text")).toHaveCount(1);
  await saved(page);
  const before = await snapshot(page);

  await page.getByRole("radio", { name: /Firm signs when sending/ }).check();
  await saved(page);
  await page.getByRole("radio", { name: /Firm countersigns after the client/ }).check();
  await saved(page);
  expect(await snapshot(page)).toEqual(before);
  await page.reload();
  await expect(page.getByTestId("field")).toHaveCount(10);
  expect(await snapshot(page)).toEqual(before);
});

test("unchecking 'Firm signs too' keeps the firm's fields; re-checking restores them exactly", async ({ page }) => {
  await signupFresh(page, "E2E Editor Co");
  await uploadAgreement(page, SAAS);
  await expect(page.getByTestId("field")).toHaveCount(10);
  // A manual edit on a firm field: its Position becomes Text.
  await field(page, "firm", "title").click();
  await page.getByTestId("inspector").getByRole("radio", { name: "Text" }).click();
  await page.keyboard.press("Escape");
  await saved(page);
  const before = await snapshot(page);

  const firmToggle = page.getByRole("checkbox", { name: "Firm signs too" });
  await firmToggle.uncheck();
  await expect(page.locator('[data-testid="field"][data-role="firm"]')).toHaveCount(0);
  await expect(page.getByTestId("firm-count")).toHaveText("off (5 fields kept)");
  await saved(page);
  await page.reload(); // kept on the server, not just in the page
  await expect(page.getByTestId("field")).toHaveCount(5);
  await expect(page.getByTestId("firm-count")).toHaveText("off (5 fields kept)");

  await firmToggle.check();
  await expect(page.getByTestId("field")).toHaveCount(10);
  expect(await snapshot(page)).toEqual(before);
  await expect(field(page, "firm", "text")).toHaveCount(1); // the manual edit came back too
  await saved(page);
});

test("a hand-added Company field snaps to its blank and takes the signer of its column", async ({ page }) => {
  await signupFresh(page, "E2E Editor Co");
  await uploadAgreement(page, SAAS);
  await expect(page.getByTestId("field")).toHaveCount(10);
  const toolbar = page.getByRole("toolbar", { name: "Add a field" });

  for (const role of ["client", "firm"] as const) {
    // Remember where detection put this column's Company field, then delete it.
    const detected = field(page, role, "company");
    await detected.scrollIntoViewIfNeeded();
    const want = (await detected.boundingBox())!;
    await detected.click();
    await page.keyboard.press("Delete");
    await expect(field(page, role, "company")).toHaveCount(0);

    // Click a little off: right of the blank's start and above its line.
    await toolbar.getByRole("button", { name: "Company" }).click();
    const pg = page.getByTestId("page-2");
    const pb = (await pg.boundingBox())!;
    await pg.click({ position: { x: want.x - pb.x + want.width * 0.6, y: want.y - pb.y - 6 } });
    const added = field(page, role, "company");
    await expect(added).toHaveCount(1);
    await expect
      .poll(async () => {
        const b = (await added.boundingBox())!;
        return [Math.round(b.x - want.x), Math.round(b.x + b.width - (want.x + want.width)), Math.round(b.y + b.height - (want.y + want.height))].every((d) => Math.abs(d) <= 3);
      }, { message: `${role} Company field snapped to the blank` })
      .toBe(true);
    await page.keyboard.press("Escape");
  }
  await saved(page);
});
