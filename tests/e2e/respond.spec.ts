import { expect, test } from "@playwright/test";
import { sendFile, signupFresh, signViaLink } from "./helpers";

test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image) for uploads");
test.setTimeout(240_000);

test("decline: reason + confirm, File declined, every party emailed, all links stop", async ({ page, browser }) => {
  await signupFresh(page, "E2E Decline Co");
  const { fileUrl, clientLink } = await sendFile(page);

  const c = await (await browser.newContext()).newPage();
  await c.goto(clientLink);
  await c.getByRole("button", { name: "Decline to sign" }).click();
  const dialog = c.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Decline" })).toBeDisabled(); // reason required
  await dialog.getByRole("textbox").fill("Scope doesn't match what we discussed");
  await dialog.getByRole("button", { name: "Decline" }).click();
  await expect(c.getByTestId("decline-confirm")).toBeVisible(); // confirm step
  await dialog.getByRole("button", { name: "Yes, decline" }).click();
  await expect(c.getByTestId("sign-responded-declined")).toBeVisible();

  // Links stop working for the decliner (and the firm signer below).
  await c.goto(clientLink);
  await expect(c.getByTestId("sign-state-declined")).toContainText("This agreement was declined");
  expect((await c.request.post(clientLink.replace("/sign/", "/api/sign/") + "/consent")).status()).toBe(409);

  await page.goto(fileUrl);
  await expect(page.getByTestId("file-status")).toHaveText("Declined");
  await expect(page.getByTestId("file-response")).toContainText("Scope doesn't match what we discussed");
  await expect(page.getByTestId("timeline-label").filter({ hasText: "Declined by Jamie Example: Scope doesn't match" })).toHaveCount(1);
  // Every party emailed: the client signer and the firm (owner + countersigner, deduped).
  const declined = page.locator("li", { hasText: 'Declined: "' });
  await expect(declined.filter({ hasText: "jamie@example.com" })).toHaveCount(1);
  await expect(declined).toHaveCount(2);
  const firmSigning = page.getByTestId("recipient-firm");
  await expect(firmSigning.getByTestId("signing-link")).toHaveCount(0); // firm's link isn't live

  // A signer who already signed can't decline: their link shows the signed/closed state, no actions.
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: /Globex Test Industries Ltd/ })).toContainText("Declined");
});

test("request changes: signing paused for everyone, firm notified with the message", async ({ page, browser }) => {
  await signupFresh(page, "E2E Changes Co");
  const { fileUrl, clientLink } = await sendFile(page);
  const c = await (await browser.newContext()).newPage();
  await c.goto(clientLink);
  await c.getByRole("button", { name: /I agree/ }).click();
  await c.getByRole("button", { name: "Request changes" }).click();
  await c.getByRole("dialog").getByRole("textbox").fill("Please change the payment terms to net 45.");
  await c.getByRole("dialog").getByRole("button", { name: "Send request" }).click();
  await expect(c.getByTestId("sign-responded-changes_requested")).toBeVisible();

  await c.goto(clientLink);
  await expect(c.getByTestId("sign-state-changes_requested")).toContainText("Waiting for the sender to respond");
  expect((await c.request.post(clientLink.replace("/sign/", "/api/sign/") + "/submit", { data: { values: {} } })).status()).toBe(409);

  await page.goto(fileUrl);
  await expect(page.getByTestId("file-status")).toHaveText("Changes requested");
  await expect(page.getByTestId("file-response")).toContainText("Please change the payment terms to net 45.");
  await expect(page.getByTestId("timeline-label").filter({ hasText: "Jamie Example requested changes" })).toHaveCount(1);
  // Firm notified (not the client).
  const notice = page.locator("li", { hasText: 'Changes requested: "' });
  await expect(notice).toHaveCount(1);
  await expect(notice).not.toContainText("jamie@example.com");
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: /Globex Test Industries Ltd/ })).toContainText("Changes requested");
});

test("a signer who already signed can't decline", async ({ page, browser }) => {
  await signupFresh(page, "E2E Signed Co");
  const { clientLink } = await sendFile(page);
  await signViaLink(await (await browser.newContext()).newPage(), clientLink);
  const c = await (await browser.newContext()).newPage();
  await c.goto(clientLink);
  await expect(c.getByTestId("sign-state-signed")).toBeVisible();
  await expect(c.getByRole("button", { name: "Decline to sign" })).toHaveCount(0);
  expect((await c.request.post(clientLink.replace("/sign/", "/api/sign/") + "/decline", { data: { text: "changed my mind" } })).status()).toBe(409);
});
