import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server as HttpServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { sendFile, signupFresh, signViaLink } from "./helpers";

/**
 * MIND sync against a mocked MIND MCP server in this test process (no real MIND calls). The
 * app (Docker, E2E_HOOKS=1) reaches it via MIND_MCP_URL=http://host.docker.internal:4790/mcp.
 * Desktop Chromium only; serial, since the mock owns one port.
 */
test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image with E2E_HOOKS=1 and MIND_MCP_URL)");
test.skip(({ browserName, isMobile }) => browserName !== "chromium" || !!isMobile, "desktop Chromium only");
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const PORT = 4790;
const KEY = "mind_e2e_test_key_0123456789";
type Call = { auth: string | undefined; name: string; args: Record<string, unknown> };
let calls: Call[] = [];
let failing = false;
let http: HttpServer;

test.beforeAll(async () => {
  http = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      // Stateless MCP: a fresh server per request.
      const server = new Server({ name: "mind-mock", version: "0.0.1" }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "mind_remember", inputSchema: { type: "object" } }] }));
      server.setRequestHandler(CallToolRequestSchema, async (r) => {
        calls.push({ auth: req.headers.authorization, name: r.params.name, args: (r.params.arguments ?? {}) as Record<string, unknown> });
        if (failing) return { isError: true, content: [{ type: "text", text: 'Error: MIND API error 503: {"detail":"unavailable"}' }] };
        return { content: [{ type: "text", text: JSON.stringify({ id: `mock-${calls.length}`, status: "PROCESSING" }) }] };
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
    });
  });
  await new Promise<void>((r) => http.listen(PORT, "0.0.0.0", r));
});
test.afterAll(() => new Promise<void>((r) => http.close(() => r())));
test.beforeEach(() => {
  calls = [];
  failing = false;
});

async function turnOnMind(page: Page) {
  await page.goto("/settings");
  const form = page.getByTestId("mind-form");
  await form.getByLabel("MIND API key").fill(KEY);
  await form.getByTestId("mind-enabled").check();
  await form.getByRole("button", { name: "Save MIND" }).click();
  await expect(form.getByText("Saved")).toBeVisible();
}
async function completeFile(page: Page, browser: import("@playwright/test").Browser) {
  const { fileUrl, clientLink } = await sendFile(page);
  await signViaLink(await (await browser.newContext()).newPage(), clientLink);
  await page.goto(fileUrl);
  await signViaLink(page, await page.getByTestId("recipient-firm").getByTestId("signing-link").inputValue());
  await page.goto(fileUrl);
  await expect(page.getByTestId("file-status")).toHaveText("Signed"); // signing is never held up by MIND
  return fileUrl;
}
const mindRows = (page: Page) => page.getByTestId("delivery-row").filter({ hasText: "MIND" });

test("a completed File is pushed to MIND once: a private document with the agreement facts", async ({ page, browser }) => {
  await signupFresh(page, "E2E Mind Co");
  await turnOnMind(page);
  const fileUrl = await completeFile(page, browser);

  await expect.poll(() => calls.length, { timeout: 30_000 }).toBe(1);
  const c = calls[0];
  expect(c.name).toBe("mind_remember");
  expect(c.auth).toBe(`Bearer ${KEY}`);
  expect(c.args).toMatchObject({ action: "create", type: "document", tags: ["signfile", "agreement"], source: "signfile", title: "Signed: pdf-two-column — Globex Test Industries Ltd" });
  const content = String(c.args.content);
  for (const s of ["Client: Globex Test Industries Ltd", "Agreement: pdf-two-column (version 1)", "Signed by Jamie Example", "Countersigned by Test Admin", `File: ${new URL(fileUrl).origin}`, "/verify"]) expect(content).toContain(s);
  expect(content).not.toContain("@"); // no signer emails

  await page.goto("/settings");
  await expect(mindRows(page).first().getByTestId("delivery-status")).toHaveText("Delivered");
  expect(await page.content()).not.toContain(KEY); // the key is never shown back
});

test("MIND failing: retried 3 times and logged as failed; signing completes normally", async ({ page, browser }) => {
  await signupFresh(page, "E2E Mind Co");
  await turnOnMind(page);
  failing = true;
  await completeFile(page, browser);
  await expect.poll(() => calls.length, { timeout: 30_000 }).toBe(3);
  await page.goto("/settings");
  await expect(mindRows(page).first().getByTestId("delivery-status")).toHaveText(/^Failed after 3 attempts \(MIND: Error: MIND API error 503/);
  await page.waitForTimeout(1_500);
  expect(calls.length).toBe(3); // no 4th attempt on its own
});

test("off by default: with no MIND key, nothing is sent", async ({ page, browser }) => {
  await signupFresh(page, "E2E Mind Co");
  await page.goto("/settings");
  await expect(page.getByTestId("mind-enabled")).not.toBeChecked();
  await completeFile(page, browser);
  await page.waitForTimeout(3_000);
  expect(calls.length).toBe(0);
  await page.goto("/settings");
  await expect(mindRows(page)).toHaveCount(0);
});
