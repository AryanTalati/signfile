import { expect, test } from "@playwright/test";
import { saveMySignature, setFirmSignsFirst, signupFresh, signViaLink, uploadAgreement } from "./helpers";

test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image) for uploads");
test.setTimeout(240_000);

async function sendFirmFirst(page: import("@playwright/test").Page, expectSignNow: boolean) {
  await uploadAgreement(page, "fixtures/agreements/pdf-two-column.pdf");
  await setFirmSignsFirst(page);
  await page.getByRole("link", { name: "Create a File with this template" }).click();
  await page.getByLabel("Client's legal name").fill("Initech Test Co.");
  await page.getByLabel("Name", { exact: true }).fill("Casey Example");
  await page.getByLabel("Email").fill("casey@example.com");
  await expect(page.getByTestId("sign-now")).toHaveCount(expectSignNow ? 1 : 0);
  await page.getByRole("button", { name: "Send for signature" }).click();
  await page.waitForURL(/\/files\/[0-9a-f-]{36}\?sent=1/);
  return page.url().replace(/\?.*$/, "");
}

test("firm signs when sending: agreement completes the moment the client signs", async ({ page, browser }) => {
  await signupFresh(page, "E2E FirmFirst Co");
  await saveMySignature(page);
  const fileUrl = await sendFirmFirst(page, true);
  await expect(page.getByTestId("file-status")).toHaveText("Waiting for client");
  await expect(page.getByTestId("recipient-firm").getByTestId("recipient-status")).toHaveText("Signed");
  const clientLink = await page.getByTestId("recipient-client").getByTestId("signing-link").inputValue();
  await expect(page.getByText(/please sign/)).toBeVisible(); // client's email in the outbox

  const c = await (await browser.newContext()).newPage();
  await signViaLink(c, clientLink);
  await expect(c.getByTestId("sign-done")).toContainText("Everyone has signed");
  await page.goto(fileUrl);
  await expect(page.getByTestId("file-status")).toHaveText("Signed");
});

test("firm signs when sending, no saved signature: waits for the firm, then goes to the client", async ({ page, browser }) => {
  await signupFresh(page, "E2E FirmFirst Co");
  const fileUrl = await sendFirmFirst(page, false);
  await expect(page.getByTestId("file-status")).toHaveText("Waiting for your firm to sign");
  await expect(page.getByTestId("recipient-client").getByTestId("recipient-status")).toHaveText("Waiting for earlier signer");
  await expect(page.getByText(/Sign to send/)).toBeVisible();

  // The firm signer signs from the File page (normal flow, no saved signature).
  const firmLink = await page.getByTestId("recipient-firm").getByTestId("signing-link").inputValue();
  await signViaLink(page, firmLink);
  await page.goto(fileUrl);
  await expect(page.getByTestId("file-status")).toHaveText("Waiting for client");
  await expect(page.getByText(/please sign/)).toBeVisible();
  const clientLink = await page.getByTestId("recipient-client").getByTestId("signing-link").inputValue();
  const c = await (await browser.newContext()).newPage();
  await signViaLink(c, clientLink);
  await page.goto(fileUrl);
  await expect(page.getByTestId("file-status")).toHaveText("Signed");
});
