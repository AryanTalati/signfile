import { expect, test } from "@playwright/test";
import { sendFile, signupFresh, signViaLink } from "./helpers";

test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image)");
test.skip(({ browserName, isMobile }) => browserName !== "chromium" || !!isMobile, "desktop Chromium only");
test.setTimeout(180_000);

test("Send the signed copy to: the CC gets the signed-copy email with the PDF when the File completes, and no signing link", async ({ page, browser }) => {
  await signupFresh(page, "E2E CC Co");
  const { fileUrl, clientLink } = await sendFile(page, undefined, { company: "Globex Test Industries Ltd", name: "Jamie Example", email: "jamie@example.com", cc: "Legal@Example.com, legal@example.com" });
  await expect(page.getByTestId("cc-emails")).toHaveText("Signed copy also goes to legal@example.com");
  await expect(page.getByTestId("signing-link")).toHaveCount(2); // client + firm only: the CC gets no link

  await signViaLink(await (await browser.newContext()).newPage(), clientLink);
  await page.goto(fileUrl);
  await signViaLink(page, await page.getByTestId("recipient-firm").getByTestId("signing-link").inputValue());
  await page.goto(fileUrl);
  await expect(page.getByTestId("timeline-label").filter({ hasText: "Signed copy sent to legal@example.com" })).toHaveCount(1);

  await page.goto("/outbox");
  const rows = page.getByTestId("outbox-row").filter({ hasText: "legal@example.com" });
  await expect(rows).toHaveCount(1); // one email, nothing before completion
  await expect(rows).toContainText('Signed: "');
  await expect(rows).toContainText("Signed copy (copied)");
  await expect(rows).toContainText("Captured"); // test domain: captured, never sent
  await rows.getByTestId("outbox-open").click();
  const body = page.frameLocator("[data-testid=email-body]");
  await expect(body.getByText("asked us to send you the signed copy: it's attached")).toBeVisible();
  await expect(body.locator("a")).toHaveCount(0); // no signing or download link
});
