import { expect, test, type Page } from "@playwright/test";
import { sendFile, signupFresh, signViaLink } from "./helpers";

/**
 * Reminders and expiry with mocked time: /api/test/automations runs the same sweep the health
 * ping runs, for one File, at a "now" we choose. Gmail is off in the Docker test run, so every
 * email is captured in the outbox (never sent) and asserted there.
 */
test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image) for uploads");
test.setTimeout(180_000);

const DAY = 86_400_000;
const fileIdOf = (url: string) => url.split("/").pop()!;

async function travel(page: Page, fileId: string, days: number) {
  const res = await page.request.post("/api/test/automations", { data: { fileId, now: new Date(Date.now() + days * DAY).toISOString() } });
  if (res.status() === 404) test.skip(true, "run the Docker image with -e E2E_HOOKS=1");
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { expired: number; reminded: number };
}

const reminderLabels = async (page: Page, fileUrl: string) => {
  await page.goto(fileUrl);
  return (await page.getByTestId("timeline-label").allInnerTexts()).filter((l) => l.startsWith("Reminder sent to"));
};

test("reminders: day 2, day 5, 2 days before expiry; never twice per slot; stop for the client once signed", async ({ page, browser }) => {
  await signupFresh(page, "E2E Remind Co");
  const { fileUrl, clientLink } = await sendFile(page);
  const id = fileIdOf(fileUrl);

  expect(await travel(page, id, 1.9)).toEqual({ expired: 0, reminded: 0 });
  expect((await travel(page, id, 2.1)).reminded).toBe(1);
  expect((await travel(page, id, 2.2)).reminded).toBe(0); // same slot: never twice
  expect((await travel(page, id, 5.1)).reminded).toBe(1);
  expect((await travel(page, id, 27.9)).reminded).toBe(0);
  expect((await travel(page, id, 28.1)).reminded).toBe(1); // final: 2 days before the 30-day expiry
  expect((await travel(page, id, 29.9)).reminded).toBe(0);

  expect(await reminderLabels(page, fileUrl)).toEqual(["Reminder sent to Jamie Example", "Reminder sent to Jamie Example", "Reminder sent to Jamie Example"]);
  await expect(page.getByText(/^Reminder: .*please sign/)).toHaveCount(3); // in the File's emails
  await page.goto("/outbox");
  await expect(page.getByText(/^Reminder · /).first()).toBeVisible();

  // The client signs: no more reminders to them. It's now the firm's turn, so the firm's
  // countersigner gets their own schedule.
  const c = await (await browser.newContext()).newPage();
  await signViaLink(c, clientLink);
  expect((await travel(page, id, 2.1)).reminded).toBe(1);
  const labels = await reminderLabels(page, fileUrl);
  expect(labels.filter((l) => l === "Reminder sent to Jamie Example")).toHaveLength(3);
  expect(labels.filter((l) => l === "Reminder sent to Test Admin")).toHaveLength(1);
});

test("reminders stop when the File is voided, declined or has changes requested", async ({ page, browser }) => {
  await signupFresh(page, "E2E Remind Stop Co");
  const c = await (await browser.newContext()).newPage();
  for (const how of ["void", "decline", "request-changes"] as const) {
    const { fileUrl, clientLink } = await sendFile(page);
    const id = fileIdOf(fileUrl);
    if (how === "void") {
      await page.getByRole("button", { name: "Void this File" }).click();
      await page.getByLabel(/Why are you voiding it/).fill("Testing reminders stop");
      await page.getByRole("button", { name: "Void File" }).click();
      await expect(page.getByTestId("file-status")).toHaveText("Voided");
    } else {
      await c.goto(clientLink);
      const res = await c.request.post(clientLink.replace("/sign/", "/api/sign/") + `/${how}`, { data: { text: "Testing reminders stop" } });
      expect(res.ok(), await res.text()).toBe(true);
    }
    expect(await travel(page, id, 2.1), how).toEqual({ expired: 0, reminded: 0 });
    expect(await travel(page, id, 31), how).toEqual({ expired: 0, reminded: 0 });
    expect(await reminderLabels(page, fileUrl)).toEqual([]);
  }
});

test("expiry: File becomes Expired, link shows the expired page, firm emailed; extend and resend reopens it", async ({ page, browser }) => {
  await signupFresh(page, "E2E Expiry Co");
  const { fileUrl, clientLink } = await sendFile(page);
  const id = fileIdOf(fileUrl);

  expect(await travel(page, id, 30.1)).toEqual({ expired: 1, reminded: 0 });
  expect(await travel(page, id, 30.2)).toEqual({ expired: 0, reminded: 0 }); // only once
  await page.goto(fileUrl);
  await expect(page.getByTestId("file-status")).toHaveText("Expired");
  await expect(page.getByTestId("timeline-label").filter({ hasText: "Signing links expired" })).toHaveCount(1);
  await expect(page.getByText(/^Expired: ".*" for Globex Test Industries Ltd$/)).toBeVisible(); // email to the firm
  await expect(page.getByText(/To Test Admin </)).toBeVisible();

  const c = await (await browser.newContext()).newPage();
  await c.goto(clientLink);
  await expect(c.getByTestId("sign-state-expired")).toContainText("This link has expired");
  await expect(c.getByTestId("sign-state-expired")).toContainText("E2E Expiry Co");

  await page.getByRole("button", { name: "Extend and resend to Jamie Example" }).click();
  await expect(page.getByText(/^Resent to Jamie Example\.$/)).toBeVisible();
  await page.goto(fileUrl);
  await expect(page.getByTestId("file-status")).toHaveText("Waiting for client");
  await expect(page.getByTestId("timeline-label").filter({ hasText: "Links extended and resent by Test Admin" })).toHaveCount(1);
  await c.goto(clientLink);
  await expect(c.getByRole("button", { name: /I agree/ })).toBeVisible();
});
