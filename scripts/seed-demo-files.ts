/**
 * Adds two completed, sealed example Files to the public demo company (Astra AI) so the
 * demo login doesn't open on an empty dashboard. Test data only: fictional clients, signers
 * on reserved .example domains (emails are captured in the outbox, never sent), and IPs from
 * the 203.0.113.0/24 documentation range.
 *
 * It drives the real product through a browser (upload -> detect -> send -> client signs ->
 * firm countersigns -> seal), so the sealed PDFs and certificates are produced by the same
 * code as any other File. Run it against the local Docker image with email, AI and MIND off
 * and APP_URL set to the live site, so links in the Files point at the live URL:
 *
 *   docker run -d --rm --env-file .env.local -e APP_URL=https://signfile.onrender.com \
 *     -e GMAIL_CLIENT_ID= -e GMAIL_CLIENT_SECRET= -e GMAIL_REFRESH_TOKEN= -e GMAIL_SENDER= \
 *     -e ANTHROPIC_API_KEY= -e MIND_API_KEY= -p 10000:10000 signfile:dev
 *
 *   npx tsx scripts/seed-demo-files.ts             # print the plan only
 *   npx tsx scripts/seed-demo-files.ts --rehearse  # same flow in a throwaway E2E company
 *   npx tsx scripts/seed-demo-files.ts --confirm   # the demo company
 *
 * Idempotent: a client that already has a File in the account is skipped.
 */
import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";

const BASE = (process.env.SEED_BASE_URL ?? "http://localhost:10000").replace(/\/+$/, "");
const mode = process.argv.includes("--confirm") ? "demo" : process.argv.includes("--rehearse") ? "rehearse" : "plan";

interface Signer { name: string; title: string; email: string; ip: string; timezone: string }
const FIRM: Omit<Signer, "email"> = { name: "Alex Morgan", title: "Managing Director", ip: "203.0.113.10", timezone: "America/Denver" };

const PLAN = [
  {
    fixture: "fixtures/agreements/docx-table-blocks.docx",
    uploadAs: "Client Services Agreement.docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    client: "Globex Test Industries Ltd",
    reference: "AST-2026-031",
    signer: { name: "Morgan Reyes", title: "VP Operations", email: "morgan.reyes@globex-test.example", ip: "203.0.113.24", timezone: "America/Chicago" },
  },
  {
    fixture: "fixtures/agreements/pdf-multipage-initials.pdf",
    uploadAs: "Statement of Work and Services Terms.pdf",
    mime: "application/pdf",
    client: "Vandelay Test Imports",
    reference: "AST-2026-032",
    signer: { name: "Sam Okafor", title: "Head of Procurement", email: "sam.okafor@vandelay-test.example", ip: "203.0.113.57", timezone: "America/New_York" },
  },
];

async function loginDemo(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.getByRole("button", { name: "Log in to the demo" }).click();
  await page.waitForURL("**/dashboard");
}

async function signupThrowaway(page: Page) {
  await page.goto(`${BASE}/signup`);
  await page.getByLabel("Company name").fill(`E2E Demo Rehearsal ${Math.random().toString(36).slice(2, 7)}`);
  await page.getByLabel("Your name").fill(FIRM.name);
  await page.getByLabel("Work email").fill(`rehearse-${Date.now()}@signfile-e2e.example`); // purged like any E2E account
  await page.getByLabel("Password").fill("a-long-enough-password");
  await page.getByRole("button", { name: "Create company" }).click();
  await page.waitForURL("**/dashboard?welcome=1");
}

async function hasFileFor(page: Page, client: string) {
  await page.goto(`${BASE}/dashboard?q=${encodeURIComponent(client)}`);
  await page.getByTestId("files-filter").waitFor();
  return (await page.getByRole("link", { name: client }).count()) > 0;
}

/** Consent, then every field in guided order; typed dialogs get the signer's own details. */
async function sign(browser: Browser, link: string, who: Omit<Signer, "email">, company: string) {
  const ctx = await browser.newContext({ timezoneId: who.timezone, extraHTTPHeaders: { "cf-connecting-ip": who.ip } });
  const page = await ctx.newPage();
  await page.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
  await page.getByRole("button", { name: /I agree/ }).click();
  const finish = page.getByRole("button", { name: "Finish and sign" });
  const progress = page.getByTestId("sign-progress");
  for (let i = 0; i < 30 && !(await finish.isVisible()); i++) {
    const before = await progress.textContent();
    await page.getByRole("button", { name: /^(Start|Next field)$/ }).click();
    const dialog = page.getByRole("dialog");
    // Either a dialog opens, or (an adopted signature reused with one tap) the progress moves on.
    for (let t = 0; t < 100 && !(await dialog.isVisible()) && (await progress.textContent()) === before; t++) await page.waitForTimeout(100);
    if (await dialog.isVisible()) {
      const adopt = dialog.getByRole("button", { name: "Adopt and sign" });
      if (await adopt.isVisible()) await adopt.click();
      else {
        const label = (await dialog.innerText()).toLowerCase();
        const value = /title|position/.test(label) ? who.title : /company|organi[sz]ation/.test(label) ? company : who.name;
        await dialog.getByRole("textbox").fill(value);
        await dialog.getByRole("button", { name: "Save" }).click();
      }
      await dialog.waitFor({ state: "hidden" });
    }
    for (let t = 0; t < 50 && (await progress.textContent()) === before; t++) await page.waitForTimeout(100);
  }
  await finish.click();
  await page.getByTestId("sign-done").waitFor({ timeout: 60_000 });
  await ctx.close();
}

async function main() {
  console.log(`Target: ${mode === "demo" ? "demo company Astra AI" : mode === "rehearse" ? "a new throwaway E2E company" : "(plan only)"} via ${BASE}\n`);
  for (const p of PLAN) console.log(`- ${p.client} (${p.reference}): "${p.uploadAs}" from ${p.fixture}; client signer ${p.signer.name}, ${p.signer.title}, ${p.signer.email}; countersigned by ${FIRM.name}`);
  if (mode === "plan") return console.log("\nNothing written. Use --rehearse or --confirm.");

  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ timezoneId: FIRM.timezone })).newPage();
    if (mode === "demo") await loginDemo(page);
    else await signupThrowaway(page);

    for (const p of PLAN) {
      if (await hasFileFor(page, p.client)) {
        console.log(`skip ${p.client}: already has a File`);
        continue;
      }
      await page.goto(`${BASE}/templates/new`);
      await page.getByTestId("upload-input").setInputFiles({ name: p.uploadAs, mimeType: p.mime, buffer: readFileSync(p.fixture) });
      await page.waitForURL(/\/templates\/[0-9a-f-]{36}/, { timeout: 180_000 });
      await page.getByRole("link", { name: "Create a File with this template" }).click();
      await page.getByLabel("Client's legal name").fill(p.client);
      await page.getByLabel("Name", { exact: true }).fill(p.signer.name);
      await page.getByLabel("Email").fill(p.signer.email);
      await page.getByLabel("Title (optional)").fill(p.signer.title);
      const ref = page.getByLabel(/Reference/);
      if (await ref.count()) await ref.first().fill(p.reference);
      for (const input of await page.locator('input[name^="firm:"]').all()) await input.fill("2026-11-20");
      await page.getByRole("button", { name: "Send for signature" }).click();
      await page.waitForURL(/\/files\/[0-9a-f-]{36}\?sent=1/);
      const fileUrl = page.url().replace("?sent=1", "");
      const clientLink = await page.getByTestId("signing-link").first().inputValue();

      await sign(browser, clientLink, p.signer, p.client);
      await page.goto(fileUrl);
      const firmLink = await page.getByTestId("recipient-firm").getByTestId("signing-link").inputValue();
      await sign(browser, firmLink, FIRM, "Astra AI");

      await page.goto(fileUrl);
      await page.getByTestId("download-signed").waitFor({ timeout: 60_000 });
      const status = await page.getByTestId("file-status").innerText();
      console.log(`done ${p.client}: ${status} -> ${fileUrl.replace(BASE, "")}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
