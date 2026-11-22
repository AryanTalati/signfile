import { expect, test } from "@playwright/test";
import { sendFile, signupFresh, signViaLink } from "./helpers";

test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image)");
test.skip(({ browserName, isMobile }) => browserName !== "chromium" || !!isMobile, "desktop Chromium only");
test.setTimeout(180_000);

test("/verify?file=<id> shows the same result as uploading that File's sealed PDF; unknown ids reveal nothing", async ({ page, browser }) => {
  await signupFresh(page, "E2E Verify Co");
  const { fileUrl, clientLink } = await sendFile(page);
  await signViaLink(await (await browser.newContext()).newPage(), clientLink);
  await page.goto(fileUrl);
  await signViaLink(page, await page.getByTestId("recipient-firm").getByTestId("signing-link").inputValue());
  await page.goto(fileUrl);
  const pdf = await (await page.request.get((await page.getByTestId("download-signed").getAttribute("href"))!)).body();

  // Upload the sealed PDF (the existing way)...
  const viewer = await (await browser.newContext()).newPage(); // public page, no login
  await viewer.goto("/verify");
  await viewer.getByTestId("verify-input").setInputFiles({ name: "signed.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(viewer.getByTestId("verify-result")).toHaveText("Verified: this is an unaltered signed copy.");
  const uploaded = await viewer.getByRole("alert").first().innerText();

  // ...and the link: identical result, without uploading anything.
  await viewer.goto(`/verify?file=${fileUrl.split("/").pop()}`);
  await expect(viewer.getByTestId("verify-result")).toHaveText("Verified: this is an unaltered signed copy.");
  expect(await viewer.getByRole("alert").first().innerText()).toBe(uploaded);

  await viewer.goto("/verify?file=00000000-0000-4000-8000-000000000000");
  await expect(viewer.getByTestId("verify-result")).toHaveText("No sealed document matches this link. Upload the signed PDF to check it.");
});
