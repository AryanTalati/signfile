import { devices, expect, test, webkit, type Page, type TestInfo } from "@playwright/test";
import { existsSync } from "node:fs";
import { signupFresh, uploadAgreement } from "./helpers";

test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image) for uploads");
test.setTimeout(180_000);

/**
 * The "Filled by you" date picker fills the field column and has room for its value as it
 * appears in the agreement ("November 20, 2026"); a screenshot is attached for a visual check.
 */
async function expectDateFillFits(page: Page, info: TestInfo, name: string) {
  const input = page.getByTestId("date-fill").first();
  await expect(input).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByText(/^Appears in the agreement as [A-Z][a-z]+ \d{1,2}, \d{4}\.$/).first()).toBeVisible();
  const m = await input.evaluate((el) => {
    const s = getComputedStyle(el);
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    const longest = ctx.measureText("November 20, 2026").width + parseFloat(s.paddingLeft) + parseFloat(s.paddingRight);
    return { width: el.getBoundingClientRect().width, column: el.parentElement!.getBoundingClientRect().width, longest, viewport: window.innerWidth, overflow: document.documentElement.scrollWidth > window.innerWidth };
  });
  await info.attach(`date-fill-${name}.png`, { body: await input.locator("xpath=..").screenshot(), contentType: "image/png" });
  expect(m.width, `${name}: input spans the field column`).toBeGreaterThanOrEqual(m.column - 1);
  expect(m.width, `${name}: room for "November 20, 2026"`).toBeGreaterThanOrEqual(m.longest);
  expect(m.overflow, `${name}: no horizontal page scroll`).toBe(false);
}

test("'Filled by you' date picker is wide enough for the full date (desktop, phone, iPhone Safari)", async ({ page, baseURL }, info) => {
  await signupFresh(page, "E2E Datefill Co");
  await uploadAgreement(page, "fixtures/agreements/pdf-date-blanks.pdf");
  await page.getByRole("link", { name: "Create a File with this template" }).click();
  await page.waitForURL(/\/files\/new/);
  const formUrl = page.url();
  await expectDateFillFits(page, info, info.project.name);

  // Safari's native date control is the one that tends to stay narrow. Same form in WebKit
  // (iPhone), reusing this session (its cookie is Secure, which WebKit won't send over http).
  if (info.project.name !== "desktop" || !existsSync(webkit.executablePath())) return;
  const iphone = { ...devices["iPhone 13"] } as Partial<(typeof devices)["iPhone 13"]>;
  delete iphone.defaultBrowserType; // launched as WebKit below
  const browser = await webkit.launch();
  try {
    const ctx = await browser.newContext({ ...iphone, baseURL });
    await ctx.addCookies((await page.context().cookies()).map((c) => ({ ...c, secure: false })));
    const p = await ctx.newPage();
    await p.goto(formUrl);
    await expectDateFillFits(p, info, "iphone-webkit");
  } finally {
    await browser.close();
  }
});
