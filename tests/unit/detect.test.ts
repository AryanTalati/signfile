/**
 * Fast regression test for rule-based detection on the PDF fixtures (no
 * LibreOffice/qpdf needed, so it runs anywhere). The full eval, including
 * DOCX and encrypted inputs, is `npm run eval:detection` (Docker).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { detectFields, inkOverlaps } from "../../src/lib/pdf/detect";
import { extractLayout } from "../../src/lib/pdf/extract";

type PageRef = number | "last";
interface Exp {
  file: string;
  format: string;
  firmName: string;
  outcome: string;
  rejectCode?: string;
  blocks?: { role: string; page: PageRef; types: string[] }[];
  absent?: { role?: string; page: PageRef; types: string[] }[];
  initials?: { role: string; pages: number[] }[];
}

const SKIP = new Set(["pdf-encrypted-password.pdf", "pdf-encrypted-permissions.pdf", "pdf-large.pdf"]); // need qpdf / generated locally
const sets = ["fixtures/agreements", "fixtures/realworld"];

for (const dir of sets) {
  const manifest: Exp[] = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  for (const e of manifest.filter((m) => m.format === "pdf" && !SKIP.has(m.file))) {
    test(`${dir.split("/")[1]}/${e.file}`, async () => {
      const layout = await extractLayout(new Uint8Array(readFileSync(path.join(dir, e.file))));
      const det = detectFields(layout, { firmName: e.firmName });
      if (e.outcome === "append") {
        assert.notEqual(det.outcome, "fields", "should offer 'append a signature page'");
        return;
      }
      const pg = (p: PageRef) => (p === "last" ? layout.length : p);
      const missing: string[] = [];
      const roleOf = (r: string) => (r === "none" ? null : r);
      const used = new Set<object>();
      for (const b of e.blocks ?? [])
        for (const t of b.types) {
          const hit = det.fields.find((f) => !used.has(f) && f.page === pg(b.page) && f.type === t && f.roleKey === roleOf(b.role));
          if (hit) used.add(hit);
          else missing.push(`${b.role} ${t} p${pg(b.page)}`);
        }
      for (const a of e.absent ?? [])
        for (const t of a.types)
          if (det.fields.some((f) => f.page === pg(a.page) && f.type === t && (a.role === undefined || f.roleKey === roleOf(a.role)))) missing.push(`should NOT have ${a.role ?? ""} ${t} p${pg(a.page)}`);
      for (const f of det.fields.filter((x) => x.type === "agreement_date" || (x.type === "firm_fill" && x.source === "rule")))
        assert.ok(f.confidence < 0.7 && f.roleKey === null, `date field ${f.id} should be flagged and have no signer`);
      for (const ini of e.initials ?? [])
        for (const p of ini.pages) if (!det.fields.some((f) => f.page === p && f.type === "initials" && f.roleKey === ini.role)) missing.push(`${ini.role} initials p${p}`);
      assert.deepEqual(missing, [], `missing fields: ${missing.join(", ")}`);
      // Visual regression: no field may overlap printed text (stamped values would sit on it).
      const overlaps = det.fields.map((f) => ({ f, ink: inkOverlaps(layout[f.page - 1], f) })).filter((o) => o.ink.length);
      assert.deepEqual(overlaps.map((o) => `p${o.f.page} ${o.f.roleKey} ${o.f.type} covers "${o.ink.join("").slice(0, 30)}"`), [], "fields overlap printed text");
      for (const f of det.fields) {
        assert.ok(f.x >= 0 && f.y >= 0 && f.x + f.w <= 1.0001 && f.y + f.h <= 1.0001, `field ${f.id} is off the page`);
        assert.ok(f.confidence > 0 && f.confidence <= 1);
      }
    });
  }
}
