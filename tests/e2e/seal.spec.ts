import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { extractLayout, type Glyph } from "../../src/lib/pdf/extract";
import { PLACEHOLDER_HINTS, sendFile, signupFresh, signViaLink } from "./helpers";

test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image) for uploads");
test.setTimeout(240_000);

const FIXTURE = "fixtures/agreements/pdf-compact-blocks.pdf";
const isBlankCh = (c: string) => /^[_.…\s]$/.test(c);
const overlap = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

test("sealed PDF: values stamped clear of printed text, certificate, verify", async ({ page, browser }) => {
  await signupFresh(page, "Example Digital Consulting LLC");
  const { fileUrl, clientLink } = await sendFile(page, FIXTURE, { company: "Northwind Test Traders", name: "Jordan Example", email: "jordan@example.com" });
  const client = await (await browser.newContext()).newPage();
  await signViaLink(client, clientLink);
  await page.goto(fileUrl);
  await signViaLink(page, await page.getByTestId("recipient-firm").getByTestId("signing-link").inputValue());
  await expect(page.getByTestId("signer-download")).toBeVisible();

  await page.goto(fileUrl);
  await expect(page.getByTestId("signed-copy")).toContainText("Signed and sealed");
  const res = await page.request.get((await page.getByTestId("download-signed").getAttribute("href"))!);
  expect(res.status()).toBe(200);
  const sealed = new Uint8Array(await res.body());

  const before = await extractLayout(new Uint8Array(readFileSync(FIXTURE)));
  const after = await extractLayout(sealed);
  expect(after.length).toBeGreaterThan(before.length); // certificate appended

  // Every stamped glyph on the agreement pages must sit clear of the original printed text.
  const problems: string[] = [];
  let stampedChars = "";
  for (let i = 0; i < before.length; i++) {
    const ink = before[i].glyphs.filter((g) => !isBlankCh(g.ch));
    const known = (g: Glyph) => before[i].glyphs.some((o) => o.ch === g.ch && Math.abs(o.x - g.x) < 0.6 && Math.abs(o.baseline - g.baseline) < 0.6);
    for (const g of after[i].glyphs.filter((x) => !isBlankCh(x.ch) && !known(x))) {
      stampedChars += g.ch;
      const hit = ink.find((o) => overlap(o.x, o.x2, g.x, g.x2) > 0.5 && overlap(o.y, o.baseline, g.y, g.baseline) > 0.5);
      if (hit) problems.push(`p${i + 1} stamped "${g.ch}" overlaps printed "${hit.ch}"`);
    }
  }
  // Stamped images (signatures, initials) must not cover printed text either.
  for (let i = 0; i < before.length; i++) {
    const ink = before[i].glyphs.filter((g) => !isBlankCh(g.ch));
    const newImages = after[i].images.filter((im) => !before[i].images.some((o) => Math.abs(o.x - im.x) < 1 && Math.abs(o.y - im.y) < 1));
    for (const im of newImages) {
      const hit = ink.find((o) => overlap(o.x, o.x2, im.x, im.x + im.w) > 0.5 && overlap(o.y, o.baseline, im.y, im.y + im.h) > 0.5);
      if (hit) problems.push(`p${i + 1} stamped image overlaps printed "${hit.ch}"`);
    }
  }
  expect(problems.slice(0, 10)).toEqual([]);
  expect(stampedChars).toContain("JordanExample");
  expect(stampedChars).toMatch(/[A-Z][a-z]+\d{1,2},\d{4}/); // a real date was stamped

  // Certificate + no placeholder text anywhere.
  const allText = after.map((p) => p.items.map((t) => t.str).join(" ")).join("\n");
  for (const s of ["Certificate of Completion", "Jordan Example", "jordan@example.com", "SHA-256", "Northwind Test Traders", "Agreed to e-sign", "Event log"]) expect(allText).toContain(s);
  for (const re of PLACEHOLDER_HINTS) expect(allText).not.toMatch(re);

  // /verify: the sealed copy verifies; a one-byte change doesn't.
  await page.goto("/verify");
  await page.getByTestId("verify-input").setInputFiles({ name: "signed.pdf", mimeType: "application/pdf", buffer: Buffer.from(sealed) });
  await expect(page.getByTestId("verify-result")).toHaveText("Verified: this is an unaltered signed copy.");
  await page.getByRole("button", { name: "Check another file" }).click();
  await page.getByTestId("verify-input").setInputFiles({ name: "edited.pdf", mimeType: "application/pdf", buffer: Buffer.concat([Buffer.from(sealed), Buffer.from(" ")]) });
  await expect(page.getByTestId("verify-result")).toContainText("No match");

  // The client can download their copy from their own link.
  const mine = await client.request.get(clientLink.replace("/sign/", "/api/sign/") + "/download");
  expect(mine.status()).toBe(200);
  expect(mine.headers()["content-type"]).toBe("application/pdf");
});
