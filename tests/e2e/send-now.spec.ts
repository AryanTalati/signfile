import { expect, test } from "@playwright/test";
import { signupFresh, signViaLink, uploadAgreement } from "./helpers";

test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image) for uploads");
test.setTimeout(180_000);

const DAY = 86_400_000;

test("'Send immediately' off: saved as a Draft with no links or emails, no reminders; 'Send now' sends it", async ({ page, browser }) => {
  await signupFresh(page, "E2E Draft Co");
  await uploadAgreement(page, "fixtures/agreements/pdf-two-column.pdf");
  await page.getByRole("link", { name: "Create a File with this template" }).click();
  await expect(page.getByTestId("send-now").getByRole("checkbox")).toBeChecked(); // default on
  await page.getByLabel("Client's legal name").fill("Initech Test LLC");
  await page.getByLabel("Name", { exact: true }).fill("Jamie Example");
  await page.getByLabel("Email").fill("jamie@example.com");
  for (const input of await page.locator('input[name^="firm:"]').all()) await input.fill("2026-11-19");
  await page.getByTestId("send-now").getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/files\/[0-9a-f-]{36}\?draft=1/);
  const fileUrl = page.url().replace("?draft=1", "");
  const fileId = fileUrl.split("/").pop()!;

  await expect(page.getByTestId("file-status")).toHaveText("Draft");
  await expect(page.getByTestId("draft")).toContainText("Draft: not sent yet");
  await expect(page.getByTestId("signing-link")).toHaveCount(0);
  await expect(page.getByText("None yet.")).toBeVisible(); // no emails
  await expect(page.getByTestId("recipient-client").getByTestId("recipient-status")).toHaveText("Not sent yet");
  const labels = await page.getByTestId("timeline-label").allInnerTexts();
  expect(labels).toEqual(["File created by Test Admin"]);

  // A draft is never reminded or expired (mocked time, if the hook is on).
  const res = await page.request.post("/api/test/automations", { data: { fileId, now: new Date(Date.now() + 40 * DAY).toISOString() } });
  if (res.status() !== 404) expect(await res.json()).toEqual({ expired: 0, reminded: 0 });

  await page.getByTestId("send-draft").click();
  await page.waitForURL(/\?sent=1/);
  await expect(page.getByTestId("file-status")).toHaveText("Waiting for client");
  await expect(page.getByText(/please sign/).first()).toBeVisible();
  const clientLink = await page.getByTestId("signing-link").first().inputValue();
  expect((await page.getByTestId("timeline-label").allInnerTexts()).some((l) => l.startsWith("Sent to Jamie Example"))).toBe(true);

  await signViaLink(await (await browser.newContext()).newPage(), clientLink);
  await page.goto(fileUrl);
  await expect(page.getByTestId("file-status")).toHaveText("Waiting for countersign");
});
