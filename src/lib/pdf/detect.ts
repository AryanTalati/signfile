/**
 * Rule-based signature-field detection. No AI, no network: this path must
 * work on its own (AI labeling is a later, optional layer on top).
 *
 * Input: page geometry from extract.ts (displayed coordinates, points).
 * Output: FieldDefs (fractions of the displayed page) with a confidence each;
 * anything below REVIEW_THRESHOLD is flagged in the editor. Pure function.
 *
 * Passes:
 *   1. blanks   - underscore runs, dot leaders, drawn lines (split at table
 *                 cell borders), empty boxes, existing form widgets
 *   2. labels   - attach a label to each blank: text just before it, a row
 *                 label to its left (grid tables), text below or above it
 *   3. anchors  - labels with no blank (e.g. "Signature:" in an empty table
 *                 cell) get a field in the empty space beside them
 *   4. blocks   - keep only fields that belong to a signature block
 *   5. roles    - client vs firm, from the field's own label, "on behalf of"
 *                 lines, the nearest party heading above in the same
 *                 column, the firm's name, or the document's defined terms
 */
import { REVIEW_THRESHOLD, type FieldDef, type FieldType, type RoleDef } from "@/lib/fields/types";
import type { PageLayout, Rect, Seg, TextItem } from "./extract";


export { REVIEW_THRESHOLD };

export interface DetectOptions {
  /** The firm's company name (helps tell firm blocks from client blocks). */
  firmName?: string;
}

export interface DetectResult {
  fields: FieldDef[];
  roles: RoleDef[];
  /** "fields" if anything was found; otherwise why not, so the UI can offer "append a signature page". */
  outcome: "fields" | "no_text" | "no_fields";
  warnings: string[];
  stats: Record<string, number>;
}

export const DEFAULT_ROLES: RoleDef[] = [
  { key: "client", label: "Client", order: 1, kind: "client" },
  { key: "firm", label: "Firm (countersign)", order: 2, kind: "firm" },
];

type Side = "client" | "firm";
type LabelKind = FieldType | "witness" | "heading" | "date" | "name_title";

interface Phrase {
  text: string;
  x: number;
  x2: number;
  y: number; // top
  baseline: number;
  h: number;
  page: number;
  /** char index -> x position, for locating blanks inside the phrase */
  charX: number[];
}

interface Blank {
  page: number;
  x1: number;
  x2: number;
  bottom: number; // y of the line / baseline
  kind: "underscore" | "dots" | "line" | "box" | "anchor" | "widget";
  box?: Rect;
  /** A table cell border: a label below it belongs to the next row, not to this line. */
  cellEdge?: boolean;
  label?: { text: string; how: "prefix" | "left" | "row" | "below" | "above" | "anchor" | "widget" };
  widgetKind?: string;
  widgetName?: string;
}

interface Candidate {
  page: number;
  type: FieldType;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  typeConf: number;
  roleHint?: { side: Side; conf: number; why: string };
  /** Short upper-case heading above the block ("INVESTOR:", "[COMPANY]") when no known party word matched. */
  partyHeading?: { text: string; x: number; y: number };
  blank: Blank;
}

// ---------- label classification ----------

const LABEL_RULES: [RegExp, LabelKind, number][] = [
  [/\bwitness/i, "witness", 0],
  // Section headings, not field labels.
  [/\bsignature (page|block|section)s?\b|^execution( page)?:?$/i, "heading", 0],
  [/\binitials\b|^initial(s| here)?$/i, "initials", 0.95],
  [/\bname\s*(and|&|\/)\s*title\b/i, "name_title", 0.8],
  [/\b(signature|sign here|signed|signatory|e-?signature)\b/i, "signature", 0.95],
  [/^by$/i, "signature", 0.9],
  [/^(director|authori[sz]ed (representative|signer|officer))$/i, "signature", 0.75],
  [/^(print(ed)?\s*name|full\s*name|name|name of signatory|signer'?s? name)$/i, "full_name", 0.9],
  [/^(title|position|designation|its|capacity|job title|role)$/i, "title", 0.85],
  [/^(date|dated|date signed|signed date|signature date|date of signature|signing date)$/i, "date", 0.85],
  [/^(company|company name|organi[sz]ation|entity|business name)$/i, "company", 0.75],
  [/^(notice address|address|email|e-mail|email address)$/i, "text", 0.6],
];

/** Normalizes a label: strips trailing colons/brackets/parentheticals. */
function cleanLabel(s: string) {
  return s
    .replace(/\(.*?\)/g, " ")
    .replace(/[\[\]]/g, " ")
    .replace(/[:*.,\s]+$/g, "")
    .replace(/^[\s:.,-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function classify(raw: string): { kind: LabelKind; conf: number } | null {
  const text = raw.trim();
  if (!text || text.length > 80) return null;
  const c = cleanLabel(text);
  if (!c || c.split(" ").length > 9) return null;
  for (const [re, kind, conf] of LABEL_RULES) {
    // Anchored rules test the cleaned label; unanchored ones search the text.
    if (re.source.startsWith("^") ? re.test(c) : re.test(text)) return { kind, conf: conf + (/:\s*$/.test(text) ? 0.03 : 0) };
  }
  // "Name: ...", "Title - ..." (label followed by a placeholder)
  const head = c.split(/\s+/).slice(0, 3).join(" ");
  if (head !== c) return classify(head);
  return null;
}

const toFieldType = (k: LabelKind): FieldType | null =>
  k === "witness" || k === "heading" ? null : k === "date" ? "date_signed" : k === "name_title" ? "text" : (k as FieldType);

// ---------- party markers ----------

const FIRM_WORDS = ["service provider", "provider", "consultant", "contractor", "developer", "vendor", "supplier", "agency", "licensor", "seller", "firm"];
const CLIENT_WORDS = ["client", "customer", "buyer", "purchaser", "licensee", "subscriber"];
const AMBIGUOUS_CLIENT = ["company"]; // usually the hiring party when the other side is "Consultant"

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[“”"'’.,()[\]:;]/g, " ")
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|plc|gmbh)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

interface PartyMap {
  firmName?: string;
  /** defined term (lowercase) -> side */
  terms: Map<string, Side>;
  /** entity name (normalized) -> side */
  entities: Map<string, Side>;
}

function sideOfWord(word: string, firmName?: string): Side | null {
  const w = norm(word);
  if (firmName && w.includes(norm(firmName))) return "firm";
  if (FIRM_WORDS.some((k) => w === k)) return "firm";
  if (CLIENT_WORDS.some((k) => w === k)) return "client";
  return null;
}

/** Parses defined parties like: Acme Inc. ("Client") / Example LLC (the “Consultant”). */
function buildPartyMap(pages: PageLayout[], firmName?: string): PartyMap {
  const text = pages
    .slice(0, 3)
    .map((p) => p.items.map((i) => i.str).join(" "))
    .join(" ")
    .replace(/\s+/g, " ");
  const terms = new Map<string, Side>();
  const entities = new Map<string, Side>();
  const re = /([A-Z][\w&.'\- ]{1,80}?)(?:,[^()]{0,160}?)?\s*\(\s*(?:the\s+|each\s+a\s+|hereinafter\s+)?["“]([A-Z][A-Za-z ]{1,30})["”]\s*\)/g;
  for (const m of text.matchAll(re)) {
    const term = m[2].trim().toLowerCase();
    let entity = m[1].replace(/^(.*\b(between|and|by)\s+)/i, "").replace(/^\(\d\)\s*/, "").trim();
    entity = entity.split(/\s+/).slice(-6).join(" ");
    let side: Side | null = null;
    if (firmName && norm(entity).includes(norm(firmName))) side = "firm";
    side ??= sideOfWord(term) ?? (AMBIGUOUS_CLIENT.includes(term) ? "client" : null);
    if (!side) continue;
    terms.set(term, side);
    if (norm(entity).length >= 4) entities.set(norm(entity), side);
  }
  // If one side's term was found by the firm's name, the other defined party is the client.
  return { firmName, terms, entities };
}

/** Which party a piece of text (heading, "on behalf of" line, label) refers to. */
function markerSide(text: string, pm: PartyMap): { side: Side; conf: number; why: string } | null {
  if (text.length > 90) return null;
  const n = norm(text);
  if (!n) return null;
  if (pm.firmName && norm(pm.firmName).length >= 3 && n.includes(norm(pm.firmName))) return { side: "firm", conf: 0.95, why: "firm name" };
  for (const w of CLIENT_WORDS) if (new RegExp(`\\b${w}\\b`).test(n)) return { side: "client", conf: 0.9, why: `"${w}"` };
  for (const w of FIRM_WORDS) if (new RegExp(`\\b${w}\\b`).test(n)) return { side: "firm", conf: 0.9, why: `"${w}"` };
  for (const [term, side] of pm.terms) if (new RegExp(`\\b${term}\\b`).test(n)) return { side, conf: 0.85, why: `defined term "${term}"` };
  for (const [ent, side] of pm.entities) if (n.includes(ent)) return { side, conf: 0.85, why: "defined party name" };
  for (const w of AMBIGUOUS_CLIENT) if (new RegExp(`\\b${w}\\b`).test(n) && n.split(" ").length <= 6) return { side: "client", conf: 0.6, why: `"${w}" (ambiguous)` };
  return null;
}

// ---------- phrases ----------

function buildPhrases(page: PageLayout): Phrase[] {
  const rows: TextItem[][] = [];
  for (const it of page.items) {
    const row = rows.find((r) => Math.abs(r[0].baseline - it.baseline) < Math.max(2, it.h * 0.25));
    if (row) row.push(it);
    else rows.push([it]);
  }
  const phrases: Phrase[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let cur: Phrase | null = null;
    for (const it of row) {
      const gap = cur ? it.x - cur.x2 : Infinity;
      if (!cur || gap > Math.max(10, it.h * 1.1)) {
        if (cur) phrases.push(cur);
        cur = { text: "", x: it.x, x2: it.x, y: it.y, baseline: it.baseline, h: it.h, page: page.page, charX: [] };
      }
      if (cur.text && gap > 1.5 && !cur.text.endsWith(" ") && !it.str.startsWith(" ")) {
        cur.text += " ";
        cur.charX.push(cur.x2);
      }
      for (let k = 0; k < it.str.length; k++) cur.charX.push(it.x + (it.w * k) / it.str.length);
      cur.text += it.str;
      cur.x2 = Math.max(cur.x2, it.x + it.w);
      cur.y = Math.min(cur.y, it.y);
      cur.h = Math.max(cur.h, it.h);
    }
    if (cur) phrases.push(cur);
  }
  return phrases.sort((a, b) => a.baseline - b.baseline || a.x - b.x);
}

const xOverlap = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

// ---------- pass 1+2: blanks with labels ----------

const BLANK_RE = /_{3,}|(?:\.[  ]?){8,}|…{3,}/g;

function textBlanks(phrases: Phrase[]): Blank[] {
  const out: Blank[] = [];
  for (const ph of phrases) {
    let prevEnd = 0;
    for (const m of ph.text.matchAll(BLANK_RE)) {
      const start = m.index!;
      const end = start + m[0].length;
      const x1 = ph.charX[start] ?? ph.x;
      const x2 = end < ph.charX.length ? ph.charX[end] : ph.x2;
      const prefix = ph.text.slice(prevEnd, start).trim();
      prevEnd = end;
      if (x2 - x1 < 18) continue;
      out.push({
        page: ph.page,
        x1,
        x2,
        bottom: ph.baseline + 1,
        kind: m[0].includes("_") ? "underscore" : "dots",
        label: prefix ? { text: prefix, how: "prefix" } : undefined,
      });
    }
  }
  return out;
}

/** Splits horizontal lines where vertical lines cross them (table cells). */
function splitAtVerticals(h: Seg[], v: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of h) {
    const cuts = v
      .filter((l) => l.x1 > s.x1 + 2 && l.x1 < s.x2 - 2 && l.y1 <= s.y1 + 2 && l.y2 >= s.y1 - 2)
      .map((l) => l.x1)
      .sort((a, b) => a - b);
    let x = s.x1;
    for (const c of [...cuts, s.x2]) {
      if (c - x > 1) out.push({ x1: x, y1: s.y1, x2: c, y2: s.y1 });
      x = c;
    }
  }
  return out;
}

function lineBlanks(page: PageLayout, phrases: Phrase[]): Blank[] {
  const out: Blank[] = [];
  const touchesV = (x: number, y: number) => page.vLines.some((v) => Math.abs(v.x1 - x) < 2.5 && v.y1 <= y + 2.5 && v.y2 >= y - 2.5);
  for (const s of splitAtVerticals(page.hLines, page.vLines)) {
    const w = s.x2 - s.x1;
    if (w < 36 || w > page.width * 0.7) continue;
    // A table cell edge (vertical borders at both ends): text sitting on it is the cell's content, never a label for it.
    const cellEdge = touchesV(s.x1, s.y1) && touchesV(s.x2, s.y1);
    if (cellEdge) {
      // Text anywhere in the cell above this border (up to the cell's top border) means the cell isn't empty.
      const topBorder = page.hLines
        .filter((h) => h.y1 < s.y1 - 3 && xOverlap(h.x1, h.x2, s.x1, s.x2) > 0.8 * w)
        .reduce((m, h) => Math.max(m, h.y1), -Infinity);
      const cellTop = Number.isFinite(topBorder) ? topBorder : s.y1 - 60;
      if (phrases.some((p) => p.baseline > cellTop + 1 && p.baseline < s.y1 + 1 && xOverlap(p.x, p.x2, s.x1 + 1, s.x2 - 1) > 2)) continue;
    }
    // Text sitting on the line (a table row's content, or an underline of text) means it's not a blank...
    const onTop = phrases.filter((p) => p.baseline <= s.y1 + 1 && p.baseline >= s.y1 - 14 && xOverlap(p.x, p.x2, s.x1, s.x2) > Math.min(20, (p.x2 - p.x) * 0.4));
    // ...unless that text is itself a field label ("Signature" above its line).
    if (onTop.length) {
      if (cellEdge) continue;
      const lab = onTop.find((p) => classify(p.text));
      if (lab && onTop.length === 1) out.push({ page: page.page, x1: s.x1, x2: s.x2, bottom: s.y1, kind: "line", label: { text: lab.text, how: "above" } });
      continue;
    }
    out.push({ page: page.page, x1: s.x1, x2: s.x2, bottom: s.y1, kind: "line", cellEdge });
  }
  // Text-underscore blanks and drawn lines often coincide (Word renders both); drop lines under an underscore run.
  return out;
}

function boxBlanks(page: PageLayout, phrases: Phrase[]): Blank[] {
  const out: Blank[] = [];
  for (const b of page.boxes) {
    if (b.w < 20 || b.w > 320 || b.h < 12 || b.h > 90) continue;
    const inside = phrases.some((p) => p.x < b.x + b.w - 2 && p.x2 > b.x + 2 && p.baseline > b.y + 2 && p.y < b.y + b.h - 2);
    if (inside) continue;
    out.push({ page: page.page, x1: b.x, x2: b.x + b.w, bottom: b.y + b.h, kind: "box", box: b });
  }
  return out;
}

/** Attaches a label to blanks that don't have one from their own phrase. */
function attachLabels(blanks: Blank[], phrases: Phrase[]) {
  // "Email: ____": a label with its own blank right after it on the same row labels only that blank.
  const ownsRowBlank = (p: Phrase) => blanks.some((o) => o.x1 >= p.x2 - 2 && o.x1 - p.x2 < 40 && Math.abs(o.bottom - p.baseline) < 8);
  for (const b of blanks) {
    if (b.label && classify(b.label.text)) continue;
    const prefix = b.label;
    b.label = undefined;
    const top = b.box ? b.box.y : b.bottom - 14;

    // Same row, immediately left (within 60pt): "Name:   ______"
    const left = phrases
      .filter((p) => p.x2 <= b.x1 + 2 && b.x1 - p.x2 < 60 && p.baseline >= top - 4 && p.baseline <= b.bottom + 8)
      .sort((a, z) => z.x2 - a.x2)[0];
    if (left && classify(left.text)) {
      b.label = { text: left.text, how: "left" };
      continue;
    }
    // Below the line, overlapping: drawn line with "Signature" printed underneath.
    const below = phrases
      .filter((p) => p.y >= b.bottom - 1 && p.y <= b.bottom + 16 && xOverlap(p.x, p.x2, b.x1, b.x2) > 0 && p.x >= b.x1 - 10)
      .sort((a, z) => a.y - z.y)[0];
    if (below && !b.cellEdge && !ownsRowBlank(below) && classify(below.text)) {
      b.label = { text: below.text, how: "below" };
      continue;
    }
    // Row label in a grid: label at the left of the row, line is the row's bottom border.
    const row = phrases
      .filter((p) => p.x2 < b.x1 && p.baseline >= b.bottom - 26 && p.baseline <= b.bottom + 4 && classify(p.text))
      .sort((a, z) => Math.abs(b.bottom - 12 - a.baseline) - Math.abs(b.bottom - 12 - z.baseline) || z.x2 - a.x2)[0];
    if (row && !phrases.some((p) => p !== row && p.x > row.x2 && p.x2 < b.x1 && Math.abs(p.baseline - row.baseline) < 4)) {
      b.label = { text: row.text, how: "row" };
      continue;
    }
    if (prefix) b.label = prefix; // unclassified prefix; kept for role hints
  }
}

/** Labels with no blank next to them get a field in the empty space to their right. */
function anchorBlanks(page: PageLayout, phrases: Phrase[], used: Set<Phrase>): Blank[] {
  const out: Blank[] = [];
  for (const p of phrases) {
    if (used.has(p)) continue;
    const c = classify(p.text);
    if (!c || c.kind === "witness" || c.kind === "heading") continue;
    // Must look like a label, not prose: short, and either ends with ":" or is a known exact label.
    if (!/:\s*$/.test(p.text) && cleanLabel(p.text).split(" ").length > 3) continue;
    const sameRow = phrases.filter((q) => q !== p && Math.abs(q.baseline - p.baseline) < 6 && q.x > p.x2);
    const nextText = Math.min(...sameRow.map((q) => q.x), page.width - 30);
    const vls = page.vLines.filter((v) => v.x1 > p.x2 && v.y1 <= p.baseline && v.y2 >= p.y).map((v) => v.x1).sort((a, b) => a - b);
    let x1 = p.x2 + 6;
    let x2 = Math.min(nextText - 6, vls[0] !== undefined ? vls[0] - 4 : Infinity);
    // Label in its own narrow cell: the field goes in the next cell.
    if (vls[0] !== undefined && vls[0] - p.x2 < 40 && vls[0] < nextText) {
      x1 = vls[0] + 4;
      x2 = Math.min(nextText - 6, vls[1] !== undefined ? vls[1] - 4 : page.width - 36);
    }
    if (x2 - x1 < 60) continue;
    out.push({ page: page.page, x1, x2: Math.min(x2, x1 + 260), bottom: p.baseline + 3, kind: "anchor", label: { text: p.text, how: "anchor" } });
  }
  return out;
}

/** True if phrase p is (geometrically) the label of field c: just above it, just left of it, or just below a line. */
function labelOwns(p: Phrase, c: Candidate): boolean {
  const above = p.baseline <= c.y + 6 && c.y - p.baseline < 30 && xOverlap(p.x, p.x2, c.x - 10, c.x + c.w) > 0;
  const left = p.baseline - (c.y + c.h) < 14 && c.y + c.h - p.baseline < 26 && p.x2 <= c.x + 4 && c.x - p.x2 < 90;
  const below = p.y >= c.y + c.h - 4 && p.y - (c.y + c.h) < 18 && xOverlap(p.x, p.x2, c.x, c.x + c.w) > 0;
  return above || left || below;
}

// ---------- pass 4+5: candidates, blocks, roles ----------

function toCandidate(b: Blank, pageW: number): Candidate | null {
  if (!b.label) return null;
  const c = classify(b.label.text);
  if (!c) return null;
  const type = toFieldType(c.kind);
  if (!type) return null;
  const penalty = { prefix: 0, left: 0, widget: 0, below: 0.05, row: 0.08, above: 0.1, anchor: 0.15 }[b.label.how];
  const typeConf = Math.min(1, c.conf - penalty);
  const width = b.x2 - b.x1;
  let w: number, h: number;
  if (b.box) {
    return { page: b.page, type, label: labelFor(type, b.label.text), x: b.box.x + 2, y: b.box.y + 2, w: b.box.w - 4, h: b.box.h - 4, typeConf, blank: b };
  }
  if (type === "signature") {
    w = Math.min(Math.max(width, 120), 240);
    h = 26;
  } else if (type === "initials") {
    w = Math.min(Math.max(width, 40), 70);
    h = 20;
  } else {
    w = Math.min(Math.max(width, 60), 220);
    h = 15;
  }
  const x = Math.min(b.x1, pageW - w - 4);
  return { page: b.page, type, label: labelFor(type, b.label.text), x, y: b.bottom - h - 1, w, h, typeConf, blank: b };
}

function labelFor(type: FieldType, raw: string) {
  const defaults: Partial<Record<FieldType, string>> = {
    signature: "Signature",
    initials: "Initials",
    date_signed: "Date signed",
    full_name: "Full name",
    title: "Title",
    company: "Company",
  };
  return defaults[type] ?? (cleanLabel(raw).slice(0, 40) || "Text");
}

function assignRoles(cands: Candidate[], phrasesByPage: Map<number, Phrase[]>, pm: PartyMap) {
  for (const c of cands) {
    // r0: the field's own label names the party ("Client initials", "Signed for Astra AI").
    const own = c.blank.label && markerSide(c.blank.label.text, pm);
    if (own && own.conf >= 0.85) {
      c.roleHint = own;
      continue;
    }
    const phrases = phrasesByPage.get(c.page) ?? [];
    // r1: "for and on behalf of X" just below the line (UK style).
    const behalf = phrases.find(
      (p) => /on behalf of/i.test(p.text) && p.y >= c.y + c.h - 2 && p.y <= c.y + c.h + 30 && p.x <= c.x + c.w && p.x2 >= c.x - 20,
    );
    const bs = behalf && markerSide(behalf.text, pm);
    if (bs) {
      c.roleHint = { ...bs, why: `below: ${bs.why}` };
      continue;
    }
    // r2: nearest party heading above, preferring the same column.
    let best: { score: number; hint: NonNullable<Candidate["roleHint"]> } | null = null;
    for (const p of phrases) {
      if (p.baseline > c.y + c.h + 2 || c.y - p.baseline > 360) continue;
      if (p.x > c.x + c.w) continue; // headings to the right belong to another column
      const ms = markerSide(p.text, pm);
      if (!ms) continue;
      if (ms.conf < 0.85 && /:\s*$/.test(p.text) && classify(p.text)) continue; // "Company:" is a field label; "[COMPANY]" is a heading
      const overlap = xOverlap(p.x, p.x2, c.x - 10, c.x + c.w);
      const hPenalty = overlap > 0 ? 0 : Math.max(0, c.x - p.x2) * 0.3;
      const score = Math.max(0, c.y - p.baseline) + hPenalty;
      if (!best || score < best.score) best = { score, hint: { ...ms, conf: ms.conf - (overlap > 0 ? 0 : 0.05), why: `heading: ${ms.why}` } };
    }
    // r3: an unnamed party heading ("INVESTOR:") directly above the block in the same column.
    // A closer unnamed heading ends the previous party's block, so it beats a known party word further up.
    const head = phrases
      .filter((p) => p.baseline <= c.y + 2 && c.y - p.baseline < 160 && p.x <= c.x + c.w && xOverlap(p.x, p.x2 + 200, c.x - 10, c.x + c.w) > 0 && isPartyHeading(p.text))
      .sort((a, b) => b.baseline - a.baseline)[0];
    const headIsCloser = head && !markerSide(head.text, pm) && (!best || c.y - head.baseline < best.score);
    if (best && !headIsCloser) {
      c.roleHint = best.hint;
      continue;
    }
    if (head) c.partyHeading = { text: head.text, x: head.x, y: head.baseline };
  }
}

/** "INVESTOR:", "[COMPANY]", "THE PURCHASER" - short and upper-case, not a field label with a colon. */
function isPartyHeading(text: string) {
  const t = text.replace(/[\[\]():]/g, "").trim();
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3 || t.split(/\s+/).length > 5) return false;
  if ((letters.match(/[A-Z]/g)?.length ?? 0) / letters.length < 0.8) return false;
  const c = classify(text);
  return !c || (c.kind === "company" && !/:\s*$/.test(text));
}

function dedupe(cands: Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  for (const c of [...cands].sort((a, b) => b.typeConf - a.typeConf)) {
    const clash = out.find(
      (o) => o.page === c.page && xOverlap(o.x, o.x + o.w, c.x, c.x + c.w) > 0.5 * Math.min(o.w, c.w) && xOverlap(o.y, o.y + o.h, c.y, c.y + c.h) > 0.5 * Math.min(o.h, c.h),
    );
    if (!clash) out.push(c);
  }
  return out;
}

// ---------- main ----------

export function detectFields(pages: PageLayout[], opts: DetectOptions = {}): DetectResult {
  const warnings: string[] = [];
  const stats: Record<string, number> = { pages: pages.length, textChars: 0, blanks: 0, labelled: 0, anchors: 0, widgets: 0 };
  for (const p of pages) stats.textChars += p.items.reduce((n, i) => n + i.str.trim().length, 0);
  const widgetCount = pages.reduce((n, p) => n + p.widgets.length, 0);
  if (stats.textChars === 0 && widgetCount === 0) {
    return { fields: [], roles: DEFAULT_ROLES, outcome: "no_text", warnings: ["No text layer (scanned or image-only document)."], stats };
  }

  const pm = buildPartyMap(pages, opts.firmName);
  const phrasesByPage = new Map<number, Phrase[]>();
  let cands: Candidate[] = [];
  let witness = 0;

  for (const page of pages) {
    const phrases = buildPhrases(page);
    phrasesByPage.set(page.page, phrases);

    // Existing form widgets are the strongest signal.
    for (const w of page.widgets) {
      stats.widgets++;
      const name = w.name.toLowerCase();
      const side = /customer|client|buyer|licensee/.test(name) ? "client" : /provider|developer|vendor|consultant|contractor|firm|seller|licensor/.test(name) ? "firm" : null;
      let type: FieldType | null = widgetType(w.kind, name);
      // A widget named just for a party ("PROVIDER", "Customer") holds that party's company name.
      if (!type && side && name.replace(/[^a-z]/g, "").length <= 12) type = "company";
      // Otherwise use the printed label next to it; unlabeled deal-term fill-ins are not signer fields.
      if (!type) {
        const probe: Blank = { page: page.page, x1: w.x, x2: w.x + w.w, bottom: w.y + w.h, kind: "widget" };
        attachLabels([probe], phrases);
        const k = probe.label && classify(probe.label.text);
        type = k ? toFieldType(k.kind) : null;
      }
      if (!type) continue;
      cands.push({
        page: page.page,
        type,
        label: type === "text" || type === "checkbox" ? w.name.replace(/[_-]+/g, " ").slice(0, 40) || "Field" : labelFor(type, ""),
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        typeConf: 0.9,
        roleHint: side ? { side, conf: 0.9, why: "form field name" } : undefined,
        blank: { page: page.page, x1: w.x, x2: w.x + w.w, bottom: w.y + w.h, kind: "widget", label: { text: w.name, how: "widget" } },
      });
    }

    const text = textBlanks(phrases);
    // Drop drawn lines that sit under an underscore run (Word draws both).
    const lines = lineBlanks(page, phrases).filter((l) => !text.some((t) => Math.abs(t.bottom - l.bottom) < 6 && xOverlap(t.x1, t.x2, l.x1, l.x2) > 0.5 * (l.x2 - l.x1)));
    const boxes = boxBlanks(page, phrases).filter((b) => !page.widgets.some((w) => xOverlap(w.x, w.x + w.w, b.x1, b.x2) > 0 && Math.abs(w.y + w.h - b.bottom) < 6));
    const blanks = [...text, ...lines, ...boxes];
    stats.blanks += blanks.length;
    attachLabels(blanks, phrases);

    const used = new Set<Phrase>();
    for (const b of blanks) {
      if (!b.label) continue;
      if (classify(b.label.text)?.kind === "witness") {
        witness++;
        continue;
      }
      const cand = toCandidate(b, page.width);
      if (!cand) continue;
      stats.labelled++;
      cands.push(cand);
    }
    // A label that already belongs to a field (or contains its own blank) doesn't also get an anchor field.
    const pageCands = cands.filter((c) => c.page === page.page);
    for (const p of phrases) {
      if (new RegExp(BLANK_RE.source).test(p.text)) used.add(p);
      else if (pageCands.some((c) => labelOwns(p, c))) used.add(p);
    }
    const anchors = anchorBlanks(page, phrases, used);
    for (const a of anchors) {
      const cand = toCandidate(a, page.width);
      if (cand && !cands.some((c) => c.page === cand.page && xOverlap(c.x, c.x + c.w, cand.x, cand.x + cand.w) > 0 && Math.abs(c.y - cand.y) < 12)) {
        stats.anchors++;
        cands.push(cand);
      }
    }
  }
  if (witness) warnings.push(`Skipped ${witness} witness line${witness > 1 ? "s" : ""} (witnesses aren't signers here).`);

  cands = dedupe(cands);

  // Pass 4: keep only fields in a signature block (near a signature on the same page).
  const sigs = cands.filter((c) => c.type === "signature");
  cands = cands.filter((c) => {
    if (c.type === "signature" || c.type === "initials") return true;
    // Checkboxes: only an acknowledgement, or one right next to a signature.
    if (c.type === "checkbox")
      return /agree|ack|accept|consent|confirm/i.test(c.label + " " + (c.blank.label?.text ?? "")) || sigs.some((s) => s.page === c.page && Math.abs(s.y - c.y) < 100);
    return sigs.some((s) => s.page === c.page && Math.abs(s.y - c.y) < 200 && (xOverlap(s.x - 40, s.x + s.w + 260, c.x, c.x + c.w) > 0 || Math.abs(s.x - c.x) < 300));
  });

  // Pass 5: roles.
  assignRoles(cands, phrasesByPage, pm);
  // Unnamed party headings: each distinct heading is one party. If one side is already known,
  // they're the other side; if none is, first block = client, second = firm (flagged for review).
  const sidesSeen = new Set(cands.filter((c) => c.roleHint).map((c) => c.roleHint!.side));
  const headings = [...new Map(cands.filter((c) => !c.roleHint && c.partyHeading).map((c) => [`${c.page}:${c.partyHeading!.text}`, c.partyHeading!])).entries()].sort(
    (a, b) => a[1].y - b[1].y || a[1].x - b[1].x,
  );
  const headingSide = new Map<string, { side: Side; conf: number; why: string }>();
  headings.forEach(([key, h], i) => {
    if (sidesSeen.size === 1) headingSide.set(key, { side: sidesSeen.has("firm") ? "client" : "firm", conf: 0.65, why: `heading "${h.text}" (the other party)` });
    else if (sidesSeen.size === 0 && headings.length >= 2) headingSide.set(key, { side: i === 0 ? "client" : "firm", conf: 0.5, why: `heading "${h.text}" (${i === 0 ? "first" : "second"} party; check)` });
    else headingSide.set(key, { side: "client", conf: 0.45, why: `heading "${h.text}"` });
  });
  for (const c of cands.filter((x) => !x.roleHint && x.partyHeading)) c.roleHint = headingSide.get(`${c.page}:${c.partyHeading!.text}`);
  // Fields without a hint inherit from the nearest field with direct evidence in the same block (no chaining).
  const evidenced = cands.filter((x) => x.roleHint);
  for (const c of cands.filter((x) => !x.roleHint && !x.partyHeading)) {
    const near = evidenced
      .filter((o) => o.page === c.page && xOverlap(o.x - 30, o.x + o.w + 30, c.x, c.x + c.w) > 0 && Math.abs(o.y - c.y) < 160)
      .sort((a, b) => Math.abs(a.y - c.y) - Math.abs(b.y - c.y))[0];
    if (near?.roleHint) c.roleHint = { ...near.roleHint, conf: near.roleHint.conf - 0.1, why: `same block as a ${near.type}` };
  }
  // Complement: if only one side was ever identified, remaining unknown fields are the other side.
  for (const c of cands.filter((x) => !x.roleHint)) {
    if (sidesSeen.size === 1) {
      const other: Side = sidesSeen.has("firm") ? "client" : "firm";
      c.roleHint = { side: other, conf: 0.65, why: "the other party" };
    } else c.roleHint = { side: "client", conf: 0.4, why: "no party heading found" };
  }

  // Keep date/name/title only if their block has a signature for the same party (or it's a form widget).
  const sigSides = new Set(cands.filter((c) => c.type === "signature").map((c) => `${c.page}:${c.roleHint!.side}`));
  cands = cands.filter((c) => ["signature", "initials", "checkbox"].includes(c.type) || sigSides.has(`${c.page}:${c.roleHint!.side}`));

  cands.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);

  // Two signatures for the same party in one block is unusual (UK "SIGNED by ... / Director ..."): keep both, flag the weaker.
  const reviewNote = new Map<Candidate, string>();
  for (const c of cands.filter((x) => x.type === "signature")) {
    const rivals = cands.filter((o) => o !== c && o.type === "signature" && o.page === c.page && o.roleHint!.side === c.roleHint!.side && Math.abs(o.y - c.y) < 150);
    if (rivals.some((o) => o.typeConf > c.typeConf || (o.typeConf === c.typeConf && o.y < c.y))) {
      c.typeConf = Math.min(c.typeConf, 0.6);
      reviewNote.set(c, "second signature line for this party in the same block; it may be the printed name");
    }
  }
  const byPage = new Map(pages.map((p) => [p.page, p]));
  const fields: FieldDef[] = cands.map((c, i) => {
    const pg = byPage.get(c.page)!;
    const conf = Math.round(Math.min(c.typeConf, c.roleHint!.conf) * 100) / 100;
    return {
      id: `f${i + 1}`,
      page: c.page,
      x: clamp01(c.x / pg.width),
      y: clamp01(c.y / pg.height),
      w: clamp01(c.w / pg.width),
      h: clamp01(c.h / pg.height),
      type: c.type,
      roleKey: c.roleHint!.side,
      label: c.label,
      required: c.type !== "checkbox" && c.type !== "text",
      confidence: conf,
      source: c.blank.kind === "widget" ? "acroform" : "rule",
      reason: `${c.blank.kind}${c.blank.label ? ` + ${c.blank.label.how} label` : ""}; ${c.roleHint!.why}${reviewNote.has(c) ? `; ${reviewNote.get(c)}` : ""}`,
    } satisfies FieldDef;
  });

  for (const side of ["client", "firm"] as Side[]) {
    if (fields.some((f) => f.roleKey === side) && !fields.some((f) => f.roleKey === side && f.type === "signature"))
      warnings.push(`No signature field found for the ${side}. Add one before sending.`);
  }
  const low = fields.filter((f) => f.confidence < REVIEW_THRESHOLD).length;
  if (low) warnings.push(`${low} field${low > 1 ? "s" : ""} need${low > 1 ? "" : "s"} review (low confidence).`);
  stats.fields = fields.length;

  return { fields, roles: DEFAULT_ROLES, outcome: fields.length ? "fields" : "no_fields", warnings, stats };
}

/** Field type from a form widget's name. Order matters: "Signer Name" is a name, "Sign Date" a date. */
function widgetType(kind: string, name: string): FieldType | null {
  if (kind === "checkbox") return "checkbox";
  if (/initial/.test(name)) return "initials";
  if (/date/.test(name)) return "date_signed";
  if (/title|position/.test(name)) return "title";
  if (/name/.test(name)) return "full_name";
  if (/company|organi[sz]ation/.test(name)) return "company";
  if (/address|e-?mail/.test(name)) return "text";
  if (kind === "signature" || /sign/.test(name)) return "signature";
  return null;
}

const clamp01 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;
