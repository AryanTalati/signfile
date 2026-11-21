import assert from "node:assert/strict";
import { test } from "node:test";
import { formatFirmValue, isDateFill } from "../../src/lib/fields/format";
import type { PageLayout, TextItem } from "../../src/lib/pdf/extract";
import { surroundingText } from "../../src/lib/pdf/stamp";

test("formatFirmValue: picked dates read 'November 20, 2026'; other values unchanged", () => {
  assert.equal(formatFirmValue("2026-11-20"), "November 20, 2026");
  assert.equal(formatFirmValue("2026-01-01"), "January 1, 2026"); // no time-zone shift
  assert.equal(formatFirmValue("2026-02-31"), "2026-02-31");
  assert.equal(formatFirmValue("$12,000"), "$12,000");
});

test("isDateFill", () => {
  assert.equal(isDateFill({ key: "date", label: "Filled by you" }), true);
  assert.equal(isDateFill({ key: "effective_date", label: "Effective Date" }), true);
  assert.equal(isDateFill({ key: "fee", label: "Monthly fee" }), false);
  assert.equal(isDateFill({ key: "x", label: "Update frequency" }), false);
});

const item = (str: string, x: number, baseline: number, h: number, family: TextItem["family"]): TextItem => ({ str, x, y: baseline - h, w: str.length * h * 0.5, h, baseline, family });
const page = (items: TextItem[]) => ({ page: 1, width: 612, height: 792, rotation: 0, items, glyphs: [], images: [], hLines: [], vLines: [], boxes: [], widgets: [] }) as PageLayout;

test("surroundingText: the label on the same row wins over text above", () => {
  const p = page([item("Heading", 72, 280, 14, "sans"), item("Effective Date:", 72, 300, 10, "serif")]);
  const ref = surroundingText(p, { x: 150, y: 288, w: 120, h: 14 });
  assert.equal(ref?.str, "Effective Date:");
  assert.equal(ref?.family, "serif");
  assert.equal(ref?.h, 10);
});

test("surroundingText: falls back to the line just above, else null", () => {
  const p = page([item("Name", 72, 270, 9, "mono")]);
  assert.equal(surroundingText(p, { x: 72, y: 285, w: 120, h: 14 })?.str, "Name");
  assert.equal(surroundingText(page([]), { x: 72, y: 285, w: 120, h: 14 }), null);
});
