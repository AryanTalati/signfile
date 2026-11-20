import { expect, test } from "@playwright/test";
import { expectNoPlaceholdersInDocument, expectOnlyOwnFields, sendFile, signupFresh as signFresh, signViaLink } from "./helpers";

test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image) for uploads");
test.setTimeout(240_000);

test("client signs, firm countersigns, File completes", async ({ page, browser }) => {
  await signFresh(page);
  const { fileUrl, clientLink } = await sendFile(page);

  // The client signs in a separate, logged-out browser.
  const client = await (await browser.newContext()).newPage();
  await signViaLink(client, clientLink);
  await expect(client.getByTestId("sign-done")).toContainText("signs next");

  // Same link again: already signed.
  await client.goto(clientLink);
  await expect(client.getByTestId("sign-state-signed")).toBeVisible();

  // Firm's link is now active on the File page.
  await page.goto(fileUrl);
  await expect(page.getByTestId("file-status")).toHaveText("Waiting for countersign");
  await expect(page.getByTestId("recipient-client").getByTestId("recipient-status")).toHaveText("Signed");
  const firmLink = await page.getByTestId("recipient-firm").getByTestId("signing-link").inputValue();
  await expect(page.getByText(/Countersign: Jamie Example \(Globex Test Industries Ltd\) signed/)).toBeVisible();

  const firm = await (await browser.newContext()).newPage();
  await signViaLink(firm, firmLink);
  await expect(firm.getByTestId("sign-done")).toContainText("Everyone has signed");

  await page.reload();
  await expect(page.getByTestId("file-status")).toHaveText("Signed");
  await client.goto(clientLink);
  await expect(client.getByTestId("sign-state-completed")).toBeVisible();
});

test("draw a signature on the canvas", async ({ page, browser }) => {
  await signFresh(page);
  const { clientLink } = await sendFile(page);
  const c = await (await browser.newContext()).newPage();
  await c.goto(clientLink);
  await c.getByRole("button", { name: /I agree/ }).click();
  await c.getByRole("button", { name: /^(Start|Next field)$/ }).click();
  await c.getByRole("tab", { name: "Draw" }).click();
  const box = (await c.getByTestId("draw-canvas").boundingBox())!;
  await c.mouse.move(box.x + 20, box.y + box.height / 2);
  await c.mouse.down();
  for (let i = 1; i <= 10; i++) await c.mouse.move(box.x + 20 + i * 25, box.y + box.height / 2 + (i % 2 ? -20 : 20));
  await c.mouse.up();
  await c.getByRole("button", { name: "Adopt and sign" }).click();
  // Title is still required (no title was given when sending).
  await c.getByRole("button", { name: "Next field" }).click();
  await c.getByRole("dialog").getByRole("textbox").fill("COO");
  await c.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(c.getByRole("button", { name: "Finish and sign" })).toBeVisible();
  await c.getByRole("button", { name: "Finish and sign" }).click();
  await expect(c.getByTestId("sign-done")).toBeVisible();
});

test("an invalid link is a 404", async ({ page }) => {
  const res = await page.goto("/sign/not-a-real-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  expect(res?.status()).toBe(404);
});

test("client link shows only client fields; submitting another signer's field is rejected", async ({ page, browser }) => {
  await signFresh(page, "Test Consulting Co");
  const { fileUrl, clientLink } = await sendFile(page, "fixtures/agreements/pdf-unknown-parties.pdf", { company: "Sample Partner LLC", name: "Riley Example", email: "riley@example.com" });
  const c = await (await browser.newContext()).newPage();
  await c.goto(clientLink);
  await c.getByRole("button", { name: /I agree/ }).click();
  // Client's block only: signature, name, title, date. The firm's block is not signable here.
  await expect(c.locator('[data-testid="sign-field-signature"]')).toHaveCount(1);
  await expectOnlyOwnFields(c, 4);
  await c.getByRole("button", { name: /^(Start|Next field)$/ }).click();
  await c.getByRole("button", { name: "Adopt and sign" }).click();
  await c.getByRole("button", { name: "Next field" }).click();
  await c.getByRole("dialog").getByRole("textbox").fill("COO");
  await c.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  const res = c.waitForResponse((r) => r.url().includes("/submit"));
  await c.getByRole("button", { name: "Finish and sign" }).click();
  expect((await res).status()).toBe(422);
  await expect(c.getByText("You can only fill in your own fields.")).toBeVisible();
  await page.goto(fileUrl);
  await expect(page.getByTestId("recipient-client").getByTestId("recipient-status")).toHaveText("Opened");
  // Without tampering, the same signer can still sign.
  await c.unroute("**/api/sign/*/submit");
  await c.getByRole("button", { name: "Finish and sign" }).click();
  await expect(c.getByTestId("sign-done")).toBeVisible();
});

test("no placeholder text inside the document; real values appear once signed (both pages, all field types)", async ({ page, browser }) => {
  await signFresh(page, "Example Digital Consulting LLC");
  const { fileUrl, clientLink } = await sendFile(page, "fixtures/agreements/pdf-compact-blocks.pdf", { company: "Northwind Test Traders", name: "Jordan Example", email: "jordan@example.com" });

  // Client, before signing: their date field is empty, no hint text in the document on any page.
  const c = await (await browser.newContext()).newPage();
  await c.goto(clientLink);
  await c.getByRole("button", { name: /I agree/ }).click();
  for (const n of [1, 2, 3]) await c.locator(`[data-page="${n}"]`).scrollIntoViewIfNeeded();
  await expectNoPlaceholdersInDocument(c);
  // Own date-signed field: a greyed, local-format preview of today's date (display only).
  await expect(c.getByTestId("date-preview").first()).toHaveText(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
  await expect(c.locator('[data-testid="sign-field-date_signed"]').first()).toHaveAttribute("title", "Added automatically when you sign");
  await c.close();
  const c2 = await (await browser.newContext()).newPage();
  await signViaLink(c2, clientLink);

  // Firm, before countersigning: client's real values (signature image, name, date) show; firm's own date is empty.
  await page.goto(fileUrl);
  const firmLink = await page.getByTestId("recipient-firm").getByTestId("signing-link").inputValue();
  const f = await (await browser.newContext()).newPage();
  await f.goto(firmLink);
  await f.getByRole("button", { name: /I agree/ }).click();
  for (const n of [1, 2, 3]) await f.locator(`[data-page="${n}"]`).scrollIntoViewIfNeeded();
  await expectNoPlaceholdersInDocument(f);
  const stamped = await f.getByTestId("stamped-value").allInnerTexts();
  expect(stamped.some((t) => /^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(t.trim())), `client's date signed shown: ${JSON.stringify(stamped)}`).toBe(true);
  expect(stamped.some((t) => t.includes("Jordan Example"))).toBe(true);
  await expect(f.getByTestId("stamped-value").locator("img").first()).toBeVisible();
});
