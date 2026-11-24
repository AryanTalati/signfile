import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sendFile, signupFresh, signViaLink } from "./helpers";

/**
 * Outgoing webhook + Slack, against a local receiver in this test process (no real network
 * calls). The app container reaches it via host.docker.internal; needs E2E_HOOKS=1 on the app
 * (allows the local URL and shortens the retry backoff).
 */
test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image with E2E_HOOKS=1)");
test.skip(({ browserName, isMobile }) => browserName !== "chromium" || !!isMobile, "desktop Chromium only");
test.setTimeout(180_000);

type Hit = { path: string; headers: Record<string, string | string[] | undefined>; body: string };
let server: Server;
let hits: Hit[] = [];
let base = "";

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.push({ path: req.url ?? "", headers: req.headers, body });
      res.statusCode = req.url?.startsWith("/fail") ? 500 : 200;
      res.end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "0.0.0.0", r));
  const host = process.env.E2E_RECEIVER_HOST ?? "host.docker.internal";
  base = `http://${host}:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => new Promise<void>((r) => server.close(() => r())));
test.beforeEach(() => {
  hits = [];
});

const SECRET = "e2e-webhook-secret-0123456789";

async function saveWebhook(page: Page, url: string, events: string[] | "all") {
  await page.goto("/settings");
  const form = page.getByTestId("webhook-form");
  await form.getByLabel("Webhook URL").fill(url);
  await form.getByLabel("Signing secret").fill(SECRET);
  for (const box of await form.getByRole("checkbox").all()) {
    const name = (await box.getAttribute("name"))!.replace("event:", "");
    await box.setChecked(events === "all" || events.includes(name));
  }
  await form.getByRole("button", { name: "Save webhook" }).click();
  await expect(form.getByText("Saved")).toBeVisible();
}

const webhookHits = (path: string) => hits.filter((h) => h.path === path).map((h) => ({ ...h, json: JSON.parse(h.body) }));

test("events reach the webhook and Slack: signed bodies, UTC times, signed PDF link on completion", async ({ page, browser }) => {
  await signupFresh(page, "E2E Webhooks Co");
  await saveWebhook(page, `${base}/hook`, "all");
  const slack = page.getByTestId("slack-form");
  await slack.getByLabel("Slack incoming-webhook URL").fill(`${base}/slack`);
  await slack.getByRole("button", { name: "Save Slack" }).click();
  await expect(slack.getByText("Saved")).toBeVisible();

  // Write-only: after a reload the page carries only "saved" and a masked hint, never the URL itself.
  await page.goto("/settings");
  const field = slack.getByLabel("Slack incoming-webhook URL");
  await expect(field).toHaveValue("");
  await expect(field).toHaveAttribute("placeholder", "URL saved. Leave blank to keep it");
  await expect(slack.getByTestId("slack-saved-hint")).toHaveText(`Current: ${new URL(base).host}/…lack`);
  expect(await page.content()).not.toContain(`${base}/slack`);
  // Saving with the field blank keeps the saved URL (the Slack posts below still arrive at /slack).
  await slack.getByRole("button", { name: "Save Slack" }).click();
  await expect(slack.getByText("Saved", { exact: true })).toBeVisible();

  const { fileUrl, clientLink } = await sendFile(page);
  await signViaLink(await (await browser.newContext()).newPage(), clientLink);
  await page.goto(fileUrl);
  await signViaLink(page, await page.getByTestId("recipient-firm").getByTestId("signing-link").inputValue());

  await expect.poll(() => webhookHits("/hook").map((h) => h.json.type).sort(), { timeout: 30_000 }).toEqual(["file.completed", "file.sent", "file.signed", "file.signed", "file.viewed", "file.viewed"]);
  for (const h of webhookHits("/hook")) {
    // The signature header: HMAC-SHA256 of the exact bytes received, with the firm's secret.
    expect(h.headers["x-signfile-signature"]).toBe(`sha256=${createHmac("sha256", SECRET).update(h.body).digest("hex")}`);
    expect(h.headers["x-signfile-event"]).toBe(h.json.type);
    expect(h.json.occurredAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(h.json.file.id).toBe(fileUrl.split("/").pop());
    expect(h.json.file.client).toBe("Globex Test Industries Ltd");
    expect(h.json.signers.map((s: { email: string }) => s.email)).toContain("jamie@example.com");
  }
  const signed = webhookHits("/hook").find((h) => h.json.type === "file.signed" && h.json.signer.email === "jamie@example.com")!;
  expect(signed.json.signer.name).toBe("Jamie Example");
  const done = webhookHits("/hook").find((h) => h.json.type === "file.completed")!;
  expect(done.json.file.status).toBe("completed");
  expect(done.json.file.completedAt).toMatch(/Z$/);
  const pdf = await page.request.get(done.json.signedPdfUrl);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");

  // Slack: default events only (no sent/viewed), one plain-text line each.
  await expect.poll(() => webhookHits("/slack").map((h) => h.json.text).sort(), { timeout: 30_000 }).toEqual([
    "Everyone signed 'pdf-two-column' (Globex Test Industries Ltd). The sealed PDF is ready.",
    "Jamie Example signed 'pdf-two-column' (Globex Test Industries Ltd)",
    "Test Admin signed 'pdf-two-column' (Globex Test Industries Ltd)",
  ]);
  expect(webhookHits("/slack").every((h) => !h.headers["x-signfile-signature"])).toBe(true);

  await page.goto("/settings");
  await expect(page.getByTestId("delivery-row").filter({ hasText: "Delivered" })).toHaveCount(9);
  expect(await page.content()).not.toContain(SECRET); // never shown back
});

test("a failing webhook never blocks signing; it fails after 3 attempts and can be retried", async ({ page, browser }) => {
  await signupFresh(page, "E2E Webhooks Co");
  await saveWebhook(page, `${base}/fail`, ["file.signed"]);
  const { fileUrl, clientLink } = await sendFile(page);

  const client = await (await browser.newContext()).newPage();
  await signViaLink(client, clientLink); // completes normally while the webhook returns 500
  await page.goto(fileUrl);
  await expect(page.getByTestId("file-status")).toHaveText("Waiting for countersign");

  await expect.poll(() => hits.filter((h) => h.path === "/fail").length, { timeout: 30_000 }).toBe(3);
  await page.goto("/settings");
  const row = page.getByTestId("delivery-row").filter({ hasText: "file.signed" });
  await expect(row.getByTestId("delivery-status")).toHaveText("Failed after 3 attempts (HTTP 500)");
  await page.waitForTimeout(1_500); // no 4th attempt on its own
  expect(hits.filter((h) => h.path === "/fail").length).toBe(3);

  await row.getByTestId("delivery-retry").click();
  await expect(row.getByTestId("delivery-status")).toHaveText("Failed after 4 attempts (HTTP 500)");
  expect(hits.filter((h) => h.path === "/fail").length).toBe(4);
});
