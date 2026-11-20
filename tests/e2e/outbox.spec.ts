import { expect, test } from "@playwright/test";
import { sendFile, signupFresh } from "./helpers";

test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image) for uploads");
test.setTimeout(180_000);

test("outbox lists generated emails; an email opens with its body and signing link", async ({ page }) => {
  await signupFresh(page, "E2E Outbox Co");
  const { clientLink } = await sendFile(page);
  await page.getByRole("banner").getByRole("link", { name: "Outbox", exact: true }).click();
  await expect(page).toHaveURL(/\/outbox$/);
  const row = page.getByTestId("outbox-row").first();
  await expect(row).toContainText("please sign");
  await expect(row).toContainText("jamie@example.com");
  await expect(row).toContainText("Globex Test Industries Ltd");
  await expect(row.getByTestId("email-status")).toHaveAttribute("data-status", "captured");
  await expect(page.getByTestId("email-retry")).toHaveCount(0);
  await row.getByTestId("outbox-open").click();
  await expect(page.getByTestId("email-subject")).toContainText("please sign");
  await expect(page.getByTestId("email-links").getByTestId("signing-link").first()).toHaveValue(clientLink);
  await expect(page.frameLocator('[data-testid="email-body"]').getByText("Review and sign")).toBeVisible();
  await expect(page.frameLocator('[data-testid="email-body"]').getByText(/\(UTC\)/)).toBeVisible();
});
