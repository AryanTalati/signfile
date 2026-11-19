/**
 * Detection eval: runs the real pipeline (prepare -> extract -> detect) on
 * every test agreement and compares against the ground truth in the
 * manifests. Writes fixtures/detection-report.md.
 *
 *   npm run eval:detection     (runs inside the Docker "tools" image, which has LibreOffice + qpdf)
 *
 * Rule-based only: no AI is called.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FieldDef } from "@/lib/fields/types";
import { needsReview } from "@/lib/fields/types";
import { detectFields } from "@/lib/pdf/detect";
import { extractLayout } from "@/lib/pdf/extract";
import { prepareDocument, UploadError } from "@/lib/pdf/prepare";

type PageRef = number | "last";
interface Exp {
  file: string;
  firmName: string;
  outcome: "fields" | "append" | "reject";
  rejectCode?: string;
  blocks?: { role: string; page: PageRef; types: string[] }[];
  signatures?: { role: string; page: PageRef }[];
  initials?: { role: string; pages: number[] }[];
}

const sets = [
  { name: "generated", dir: "fixtures/agreements" },
  { name: "real-world", dir: "fixtures/realworld" },
];

interface Row {
  set: string;
  file: string;
  ok: boolean;
  outcome: string;
  expectedFields: number;
  found: number;
  wrongRole: number;
  missing: string[];
  extra: number;
  flagged: number;
  totalFields: number;
  ms: number;
  fields: FieldDef[];
  warnings: string[];
  notes: string[];
}

async function evalOne(set: string, dir: string, e: Exp): Promise<Row> {
  const t0 = Date.now();
  const base: Row = { set, file: e.file, ok: false, outcome: "", expectedFields: 0, found: 0, wrongRole: 0, missing: [], extra: 0, flagged: 0, totalFields: 0, ms: 0, fields: [], warnings: [], notes: [] };
  let bytes: Buffer;
  try {
    bytes = readFileSync(path.join(dir, e.file));
  } catch {
    return { ...base, outcome: "fixture missing (run npm run gen:agreements)", ms: 0 };
  }
  let prepared;
  try {
    prepared = await prepareDocument(new Uint8Array(bytes));
  } catch (err) {
    const code = err instanceof UploadError ? err.code : "crash";
    const msg = (err as Error).message;
    return { ...base, ok: e.outcome === "reject" && code === e.rejectCode, outcome: `rejected: ${code}`, notes: [msg], ms: Date.now() - t0 };
  }
  if (e.outcome === "reject") return { ...base, outcome: "accepted (expected reject)", ms: Date.now() - t0 };

  const layout = await extractLayout(prepared.pdf);
  const det = detectFields(layout, { firmName: e.firmName });
  const lastPage = layout.length;
  const pg = (p: PageRef) => (p === "last" ? lastPage : p);
  const row: Row = { ...base, outcome: det.outcome, fields: det.fields, warnings: det.warnings, notes: prepared.notes, totalFields: det.fields.length, flagged: det.fields.filter(needsReview).length };

  if (e.outcome === "append") {
    row.ok = det.outcome !== "fields";
    row.extra = det.fields.length;
    row.ms = Date.now() - t0;
    return row;
  }

  const matched = new Set<FieldDef>();
  for (const b of e.blocks ?? (e.signatures ?? []).map((s) => ({ ...s, types: ["signature"] }))) {
    for (const type of b.types) {
      row.expectedFields++;
      const hit = det.fields.find((f) => !matched.has(f) && f.page === pg(b.page) && f.type === type && f.roleKey === b.role);
      if (hit) {
        row.found++;
        matched.add(hit);
        continue;
      }
      const wrong = det.fields.find((f) => !matched.has(f) && f.page === pg(b.page) && f.type === type);
      if (wrong) {
        row.wrongRole++;
        matched.add(wrong);
        row.missing.push(`${b.role} ${type} p${pg(b.page)} (found as ${wrong.roleKey})`);
      } else row.missing.push(`${b.role} ${type} p${pg(b.page)}`);
    }
  }
  for (const ini of e.initials ?? []) {
    for (const p of ini.pages) {
      row.expectedFields++;
      const hit = det.fields.find((f) => !matched.has(f) && f.page === p && f.type === "initials" && f.roleKey === ini.role);
      if (hit) {
        row.found++;
        matched.add(hit);
      } else row.missing.push(`${ini.role} initials p${p}`);
    }
  }
  row.extra = det.fields.filter((f) => !matched.has(f)).length;
  row.ok = row.found === row.expectedFields;
  row.ms = Date.now() - t0;
  return row;
}

async function main() {
  const rows: Row[] = [];
  for (const s of sets) {
    const manifest: Exp[] = JSON.parse(readFileSync(path.join(s.dir, "manifest.json"), "utf8"));
    for (const e of manifest) {
      const r = await evalOne(s.name, s.dir, e);
      rows.push(r);
      const score = r.expectedFields ? `${r.found}/${r.expectedFields}` : "-";
      console.log(
        `${r.ok ? "PASS" : "FAIL"}  ${(s.name + "/" + r.file).padEnd(52)} ${r.outcome.padEnd(14)} expected ${score.padEnd(6)} extra ${String(r.extra).padEnd(3)} flagged ${String(r.flagged).padEnd(3)} ${r.ms} ms`,
      );
      for (const m of r.missing) console.log(`        missing: ${m}`);
    }
  }

  const exp = rows.reduce((n, r) => n + r.expectedFields, 0);
  const found = rows.reduce((n, r) => n + r.found, 0);
  const passed = rows.filter((r) => r.ok).length;
  console.log(`\n${passed}/${rows.length} documents fully correct; ${found}/${exp} expected fields found (${((found / exp) * 100).toFixed(0)}%).`);

  const md: string[] = [
    "# Detection report",
    "",
    "Generated by `npm run eval:detection` (rule-based detection only, no AI). Ground truth: `fixtures/agreements/manifest.json`, `fixtures/realworld/manifest.json`.",
    "",
    `**${passed}/${rows.length} documents fully correct. ${found}/${exp} expected fields found (${((found / exp) * 100).toFixed(0)}%).**`,
    "",
    "| Set | Document | Result | Outcome | Expected found | Wrong party | Extra fields | Flagged for review | Time |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.set} | \`${r.file}\` | ${r.ok ? "PASS" : "**FAIL**"} | ${r.outcome} | ${r.expectedFields ? `${r.found}/${r.expectedFields}` : "-"} | ${r.wrongRole} | ${r.extra} | ${r.flagged} | ${(r.ms / 1000).toFixed(1)} s |`,
    ),
    "",
    "## Details",
  ];
  for (const r of rows) {
    md.push("", `### ${r.set}/${r.file}: ${r.ok ? "PASS" : "FAIL"}`, "");
    if (r.notes.length) md.push(...r.notes.map((n) => `- note: ${n}`));
    if (r.missing.length) md.push(...r.missing.map((m) => `- missing: ${m}`));
    if (r.warnings.length) md.push(...r.warnings.map((w) => `- warning: ${w}`));
    if (r.fields.length) {
      md.push("", "| Page | Party | Type | Label | Confidence | Why |", "|---|---|---|---|---|---|");
      for (const f of r.fields)
        md.push(`| ${f.page} | ${f.roleKey} | ${f.type} | ${f.label} | ${f.confidence.toFixed(2)}${needsReview(f) ? " ⚠" : ""} | ${f.reason ?? f.source} |`);
    }
  }
  writeFileSync("fixtures/detection-report.md", md.join("\n") + "\n");
  console.log("wrote fixtures/detection-report.md");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
