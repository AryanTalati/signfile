import { expect, test, type Browser, type Page } from "@playwright/test";
import { uniqueEmail } from "./helpers";

// Needs the Docker image with E2E_HOOKS=1 (the test endpoint that hands back the emailed link).
test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image with E2E_HOOKS=1)");

const OLD = "a-long-enough-password";
const NEW = "a-brand-new-password-2026";
let ipSeq = Math.floor(Math.random() * 200);
/** Each context gets its own documentation-range IP so the per-IP limit is per test. */
const freshContext = (browser: Browser) => browser.newContext({ extraHTTPHeaders: { "cf-connecting-ip": `198.51.100.${(ipSeq++ % 250) + 1}` } });

async function signup(page: Page) {
  const email = uniqueEmail("reset");
  await page.goto("/signup");
  await page.getByLabel("Company name").fill(`E2E Reset Co ${Math.random().toString(36).slice(2, 7)}`);
  await page.getByLabel("Your name").fill("Riley Example");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(OLD);
  await page.getByRole("button", { name: "Create company" }).click();
  await page.waitForURL("**/dashboard?welcome=1");
  return email;
}

async function requestReset(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page.waitForURL("**/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  const done = page.getByTestId("reset-requested");
  await expect(done).toBeVisible();
  return done.innerText();
}

async function linkFor(page: Page, email: string) {
  const res = await page.request.get(`/api/test/password-reset?email=${encodeURIComponent(email)}`);
  expect(res.status(), "a reset link was issued").toBe(200);
  // Links use the app's own base URL; open them against the server under test.
  const url = new URL((await res.json()).link);
  return url.pathname + url.search;
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^Log in$/ }).click();
}

test("valid reset: new password works, old one doesn't, the link works once, other sessions end", async ({ page, browser }) => {
  const email = await signup(page); // `page` stays logged in with the old password

  const anon = await (await freshContext(browser)).newPage();
  await requestReset(anon, email);
  const link = await linkFor(anon, email);
  await anon.goto(link);
  await anon.getByLabel("New password", { exact: true }).fill(NEW);
  await anon.getByLabel("Confirm new password").fill(NEW);
  await anon.getByRole("button", { name: "Save new password" }).click();
  await expect(anon.getByTestId("reset-done")).toBeVisible();

  // The session that was logged in before the reset is signed out.
  await page.goto("/dashboard");
  await page.waitForURL(/\/login/);

  // Login itself is unchanged: same wrong-password message, then the new password works.
  await login(anon, email, OLD);
  await expect(anon.getByText("That email and password don't match.")).toBeVisible();
  await login(anon, email, NEW);
  await anon.waitForURL("**/dashboard");

  // The firm's Outbox keeps a copy of the reset email, but never the link (teammates can see the Outbox).
  await anon.goto("/outbox");
  await anon.getByTestId("outbox-open").filter({ hasText: "Reset your signfile password" }).first().click();
  await anon.waitForURL(/\/outbox\/[0-9a-f-]{36}/);
  await expect(anon.frameLocator('[data-testid="email-body"]').getByText("not stored in the Outbox")).toBeVisible();
  const shown = await anon.content(); // includes the email's HTML (the iframe's srcdoc) and the "Links in this email" list
  expect(shown).not.toContain("token=");
  expect(shown).not.toContain(new URL(link, "http://x").searchParams.get("token")!);

  // Used: the same link again is refused (in a logged-out context).
  const other = await (await freshContext(browser)).newPage();
  await other.goto(link);
  await expect(other.getByTestId("reset-invalid")).toBeVisible();
});

test("an unknown email gets exactly the same response as a known one", async ({ page, browser }) => {
  const email = await signup(page);
  const a = await (await freshContext(browser)).newPage();
  const known = await requestReset(a, email);
  const unknownEmail = uniqueEmail("nobody");
  const unknown = await requestReset(a, unknownEmail);
  expect(unknown).toBe(known);
  // ...and the unknown address really got nothing.
  expect((await a.request.get(`/api/test/password-reset?email=${encodeURIComponent(unknownEmail)}`)).status()).toBe(404);
});

test("expired, superseded, malformed and made-up tokens are rejected", async ({ page, browser }) => {
  const email = await signup(page);
  const a = await (await freshContext(browser)).newPage();

  // Superseded: a newer request cancels the older link.
  await requestReset(a, email);
  const first = await linkFor(a, email);
  await requestReset(a, email);
  const second = await linkFor(a, email);
  expect(second).not.toBe(first);
  await a.goto(first);
  await expect(a.getByTestId("reset-invalid")).toBeVisible();

  // Expired: the newest link, aged past its hour.
  const r = await a.request.post("/api/test/password-reset", { data: { email, expire: true } });
  expect((await r.json()).expired).toBe(1);
  await a.goto(second);
  await expect(a.getByTestId("reset-invalid")).toBeVisible();

  // Malformed and well-formed-but-unknown tokens.
  for (const t of ["not-a-token", "A".repeat(43), ""]) {
    await a.goto(`/reset-password?token=${t}`);
    await expect(a.getByTestId("reset-invalid")).toBeVisible();
  }
  // The old password still works: nothing was reset.
  await login(a, email, OLD);
  await a.waitForURL("**/dashboard");
});

test("reset requests are rate limited per IP with a message that says nothing about the account", async ({ browser }) => {
  const a = await (await freshContext(browser)).newPage();
  for (let i = 0; i < 10; i++) await requestReset(a, uniqueEmail(`flood${i}`));
  await a.goto("/forgot-password");
  await a.getByLabel("Email").fill(uniqueEmail("flood-last"));
  await a.getByRole("button", { name: "Send reset link" }).click();
  await expect(a.getByText("Too many reset requests from this network. Wait an hour and try again.")).toBeVisible();
});
