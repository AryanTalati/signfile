import { expect, test } from "@playwright/test";
import { signupFresh, uploadAgreement } from "./helpers";

/**
 * AI review with a mocked model (the Docker image runs with LLM_MOCK=1: only "E2E AI" companies
 * get the mock, never a real model). Desktop Chromium only.
 */
test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image with LLM_MOCK=1)");
test.skip(({ browserName, isMobile }) => browserName !== "chromium" || !!isMobile, "desktop Chromium only");
test.setTimeout(180_000);

test("AI review: a disputed field is flagged 'AI-suggested' until a person confirms it; key terms show 'not found', never a guess", async ({ page }) => {
  await signupFresh(page, "E2E AI Review Co");
  await uploadAgreement(page, "fixtures/agreements/pdf-saas-table.pdf");
  await expect(page.getByTestId("field")).toHaveCount(10);

  // The mock disputes one field (the client's Position); the other nine agree and are accepted.
  const review = page.getByTestId("review-list");
  await expect(review.getByTestId("flagged-item")).toHaveCount(1);
  const item = review.getByTestId("flagged-item").first();
  await expect(item.getByTestId("ai-suggested")).toHaveText("AI-suggested");
  await expect(item).toContainText("AI suggests: Full name for the client");
  await item.getByRole("button", { name: "Looks right" }).click();
  await expect(page.getByTestId("review-list")).toHaveCount(0);
  await expect(page.getByTestId("save-state")).toHaveText("All changes saved", { timeout: 15_000 });

  await page.getByRole("link", { name: "Create a File with this template" }).click();
  await page.getByLabel("Client's legal name").fill("Northwind Analytics LLC");
  await page.getByLabel("Name", { exact: true }).fill("Jordan Example");
  await page.getByLabel("Email").fill("jordan@example.com");
  await page.getByRole("button", { name: "Send for signature" }).click();
  await page.waitForURL(/\/files\/[0-9a-f-]{36}\?sent=1/);

  const terms = page.getByTestId("key-terms");
  await expect(terms.getByTestId("term-parties")).toContainText("entered into by"); // with its source quote
  await expect(terms.getByTestId("term-fee")).toContainText("not found"); // the mock's made-up fee was rejected
  for (const k of ["term", "effective_date", "renewal", "governing_law"]) await expect(terms.getByTestId(`term-${k}`)).toContainText("not found");
  await expect(page.getByTestId("timeline-label").filter({ hasText: "1 AI-suggested field, each confirmed by a person" })).toHaveCount(1);
});

test("AI off for everyone else: rules only, no AI marks, no key terms", async ({ page }) => {
  await signupFresh(page, "E2E Rules Only Co");
  await uploadAgreement(page, "fixtures/agreements/pdf-saas-table.pdf");
  await expect(page.getByTestId("field")).toHaveCount(10);
  await expect(page.getByTestId("ai-suggested")).toHaveCount(0);
});
