import { expect, test } from "@playwright/test";
import { sendFile, signupFresh, signViaLink } from "./helpers";

test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image) for uploads");
test.setTimeout(240_000);

test("saved signature: one-click countersign from the dashboard; logged-out link has no shortcut", async ({ page, browser }) => {
  await signupFresh(page, "E2E Countersign Co");
  await page.goto("/settings");
  await page.getByLabel("Your title").fill("Managing Partner");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Set up my signature" }).click();
  await page.getByRole("button", { name: "Adopt and sign" }).click(); // signature (typed)
  await page.getByRole("button", { name: "Adopt and sign" }).click(); // initials (typed)
  await page.getByTestId("signature-settings").getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save my signature" }).click();
  await expect(page.getByAltText("Your saved signature")).toBeVisible();

  const { fileUrl, clientLink } = await sendFile(page);
  await signViaLink(await (await browser.newContext()).newPage(), clientLink);

  // The firm's link, opened by someone not logged in: normal flow only.
  await page.goto(fileUrl);
  const firmLink = await page.getByTestId("recipient-firm").getByTestId("signing-link").inputValue();
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(firmLink);
  await expect(anon.getByRole("button", { name: /I agree, review the agreement/ })).toBeVisible();
  await expect(anon.getByTestId("quick-sign")).toHaveCount(0);

  // The countersigner, logged in: dashboard -> Countersign now -> one click.
  await page.goto("/dashboard");
  await expect(page.getByTestId("awaiting-me")).toContainText("Globex Test Industries Ltd has signed");
  await page.getByTestId("awaiting-me").getByRole("link", { name: "Countersign now" }).click();
  await page.getByRole("button", { name: "I agree, sign with my saved signature" }).click();
  await expect(page.getByTestId("sign-done")).toContainText("Everyone has signed");

  await page.goto(fileUrl);
  await expect(page.getByTestId("file-status")).toHaveText("Signed");
  await expect(page.getByTestId("recipient-firm").getByTestId("recipient-status")).toHaveText("Signed");
});
