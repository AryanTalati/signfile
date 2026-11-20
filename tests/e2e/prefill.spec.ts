import { expect, test } from "@playwright/test";
import { sendFile, signupFresh, signViaLink } from "./helpers";

test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL (Docker image) for uploads");
test.setTimeout(180_000);

const client = { company: "Globex Test Industries Ltd", name: "Jamie Example", email: "jamie@example.com" };

test("name and title prefilled from the File; an edit is logged in the audit trail", async ({ page, browser }) => {
  await signupFresh(page, "E2E Prefill Co");
  const { fileUrl, clientLink } = await sendFile(page, undefined, { ...client, title: "VP Operations" });
  const c = await (await browser.newContext()).newPage();
  await c.goto(clientLink);
  await c.getByRole("button", { name: /I agree/ }).click();
  await expect(c.getByTestId("sign-field-full_name").first()).toHaveText("Jamie Example");
  await expect(c.getByTestId("sign-field-title").first()).toHaveText("VP Operations");

  // Still editable: change the name.
  await c.getByTestId("sign-field-full_name").first().click();
  await expect(c.getByRole("dialog").getByRole("textbox")).toHaveValue("Jamie Example");
  await c.getByRole("dialog").getByRole("textbox").fill("Jamie Q. Example");
  await c.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(c.getByTestId("sign-field-full_name").first()).toHaveText("Jamie Q. Example");
  await signViaLink(c, clientLink, { navigate: false });

  await page.goto(fileUrl);
  await expect(page.getByTestId("timeline-label").filter({ hasText: "Name changed from Jamie Example to Jamie Q. Example by Jamie Example" })).toHaveCount(1);
  await expect(page.getByTestId("timeline-label").filter({ hasText: "Title changed" })).toHaveCount(0);
});

test("title left blank on the File: the Title field starts empty", async ({ page, browser }) => {
  await signupFresh(page, "E2E Prefill Co");
  const { clientLink } = await sendFile(page, undefined, client);
  const c = await (await browser.newContext()).newPage();
  await c.goto(clientLink);
  await c.getByRole("button", { name: /I agree/ }).click();
  await expect(c.getByTestId("sign-field-full_name").first()).toHaveText("Jamie Example");
  await c.getByTestId("sign-field-title").first().click();
  await expect(c.getByRole("dialog").getByRole("textbox")).toHaveValue("");
});
