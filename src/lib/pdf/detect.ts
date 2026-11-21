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
import { DEFAULT_ROLES } from "@/lib/fields/validate";
import type { Glyph, PageLayout, Rect, Seg, TextItem } from "./extract";


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

export { DEFAULT_ROLES };

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
  /** Text right before/after a blank inside its phrase (for body-text date blanks). */
  before?: string;
  after?: string;
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
  /** A defined party (preamble order) this field belongs to, when its role isn't known yet. */
  party?: number;
  /** Identifies the signature block (the party or heading text it was matched to). */
  blockKey?: string;
  blank: Blank;
}

// ---------- label classification ----------

const LABEL_RULES: [RegExp, LabelKind, number][] = [
  [/\bwitness/i, "witness", 0],
  // Section headings, not field labels.
  [/\bsignature (page|block|section)s?\b|^execution( page)?:?$/i, "heading", 0],
  [/\binitials\b|^initial(s| here)?$/i, "initials", 0.95],
  [/\bname\s*(and|&|\/)\s*title\b/i, "name_title", 0.8],
  // Dates before signatures: "Date signed", "Signed on", "Date of signature" are dates, never signatures.
  [/^(date|dated|date signed|signed date|signature date|date of signature|date of execution|signing date|signed on|date signed on|executed on)$/i, "date", 0.85],
  // Word boundaries. "signed" alone never makes a signature ("Date signed" is a date); the one
  // exception is a label that starts "Signed for …" / "Signed by …" ("Signed for the Client: ____").
  [/\b(signature|sign here|signatory|e-?signature)\b/i, "signature", 0.95],
  [/^signed\s+(for|by)\b/i, "signature", 0.9],
  [/^by$/i, "signature", 0.9],
  [/^(director|authori[sz]ed (representative|signer|officer))$/i, "signature", 0.75],
  [/^(print(ed)?\s*name|full\s*name|name|name of signatory|signer'?s? name)$/i, "full_name", 0.9],
  [/^(title|position|designation|its|capacity|job title|role)$/i, "title", 0.85],
  [/^(company|company name|organi[sz]ation|organi[sz]ation name|entity|entity name|business name|legal name|legal entity name|(client|customer|company|vendor|provider|supplier)'?s? (legal name|company|company name|legal entity))$/i, "company", 0.75],
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

/** Exported for tests: what a printed label means ("Date signed:" -> date). */
export function classifyLabel(raw: string) {
  return classify(raw);
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

interface Party {
  /** Order of definition in the preamble (0 = first). */
  order: number;
  term: string;
  entity: string;
  /** null when the term isn't a known party word ("Counterparty", "Investor"). */
  side: Side | null;
  conf: number;
}

interface PartyMap {
  firmName?: string;
  parties: Party[];
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
  const parties: Party[] = [];
  const re = /([A-Z][\w&.'\- ]{1,80}?)(?:,[^()]{0,160}?)?\s*\(\s*(?:the\s+|each\s+a\s+|hereinafter\s+)?["“]([A-Z][A-Za-z ]{1,30})["”]\s*\)/g;
  for (const m of text.matchAll(re)) {
    const term = m[2].trim().toLowerCase();
    let entity = m[1].replace(/^(.*\b(between|and|by)\s+)/i, "").replace(/^\(\d\)\s*/, "").trim();
    entity = entity.split(/\s+/).slice(-6).join(" ");
    if (parties.some((x) => x.term === term)) continue;
    let side: Side | null = null;
    let conf = 0;
    if (firmName && norm(entity).includes(norm(firmName))) [side, conf] = ["firm", 0.95];
    else if (sideOfWord(term)) [side, conf] = [sideOfWord(term)!, 0.85];
    // "the Company" is ambiguous: it's the client when the other party is clearly the firm
    // ("Consultant ... the Company"), handled by the complement rule below; otherwise unknown.
    parties.push({ order: parties.length, term, entity: norm(entity), side, conf });
  }
  // A two-party agreement has one firm and one client: if one party is clearly one side,
  // every other defined party is the other side (fairly confident, not certain).
  const strong = parties.filter((x) => x.side && x.conf >= 0.85);
  const strongSides = new Set(strong.map((x) => x.side));
  if (strongSides.size === 1) {
    const other: Side = strongSides.has("firm") ? "client" : "firm";
    for (const x of parties) if (!strong.includes(x)) [x.side, x.conf] = [other, 0.8];
  }
  return { firmName, parties };
}

type Marker = { side: Side | null; conf: number; why: string; party?: number };

/** Which party a piece of text (heading, "on behalf of" line, label) refers to. side=null: a defined party whose role is unknown. */
function markerSide(text: string, pm: PartyMap): Marker | null {
  if (text.length > 90) return null;
  const n = norm(text);
  if (!n) return null;
  if (pm.firmName && norm(pm.firmName).length >= 3 && n.includes(norm(pm.firmName))) return { side: "firm", conf: 0.95, why: "firm name" };
  for (const w of CLIENT_WORDS) if (new RegExp(`\\b${w}\\b`).test(n)) return { side: "client", conf: 0.9, why: `"${w}"` };
  for (const w of FIRM_WORDS) if (new RegExp(`\\b${w}\\b`).test(n)) return { side: "firm", conf: 0.9, why: `"${w}"` };
  for (const p of pm.parties) if (new RegExp(`\\b${p.term}\\b`).test(n)) return { side: p.side, conf: p.conf, why: `defined term "${p.term}"`, party: p.order };
  for (const p of pm.parties) if (p.entity.length >= 4 && n.includes(p.entity)) return { side: p.side, conf: p.conf, why: `defined party "${p.entity}"`, party: p.order };
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

function textBlanks(phrases: Phrase[], items: TextItem[]): Blank[] {
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
      const b: Blank = {
        page: ph.page,
        x1,
        x2,
        bottom: ph.baseline + 1,
        kind: m[0].includes("_") ? "underscore" : "dots",
        label: prefix ? { text: prefix, how: "prefix" } : undefined,
        before: ph.text.slice(Math.max(0, start - 60), start),
        after: ph.text.slice(end, end + 60),
      };
      if (isFilled(b, items)) continue;
      out.push(b);
    }
  }
  return out;
}

/**
 * A blank with text already printed over it (a DocuSign- or Word-filled value
 * typed on the line) is filled: it must not become a field. "Over" = a separate
 * text item, not itself blank characters, covering a meaningful part of the
 * blank at about the same baseline.
 */
function isFilled(b: Blank, items: TextItem[]): boolean {
  return items.some((it) => {
    const t = it.str.trim();
    if (!t || new RegExp(BLANK_RE.source).test(it.str) || /^[_.\s…]+$/.test(t)) return false;
    // Filled-in values sit on the line (within a few points); the previous line of text is ~12+ pt above.
    if (it.baseline < b.bottom - 7 || it.baseline > b.bottom + 4) return false;
    const ov = xOverlap(it.x, it.x + it.w, b.x1, b.x2);
    return ov > Math.min(15, 0.3 * (b.x2 - b.x1));
  });
}

function nearSignatureLabel(b: Blank, phrases: Phrase[]) {
  return phrases.some((p) => p.page === b.page && Math.abs(p.baseline - b.bottom) < 200 && /\b(signature|signed|sign here|signatory)\b|^by\s*:/i.test(p.text));
}

// Body-text date blanks: 'made as of ____ (the "Effective Date")', 'Dated: ____', 'this __ day of ____'.
const DATE_BEFORE = /\b(as of|dated|date of|effective date|effective as of|entered into on|made on|executed on|signed on|this)\s*[:,]?\s*(the\s*)?$/i;
const DATE_AFTER = /^\s*,?\s*(\(\s*(the|hereinafter)?\s*["“]?effective date|day of\b)/i;

function dateBlankType(b: Blank): FieldType | null {
  if (b.kind !== "underscore" && b.kind !== "dots") return null;
  const before = (b.before ?? "").replace(/_{2,}|(?:\.[ \u00a0]?){8,}/g, " ");
  const after = b.after ?? "";
  const thisDayOf = /\bthis\s*$/i.test(before) && /^\s*day of\b/i.test(after);
  if (/^\s*(dated?|date)\s*:?\s*$/i.test(before.trim().split(/[.;]/).pop() ?? "")) return /effective date/i.test(before + " " + after) ? "agreement_date" : "firm_fill";
  if (!DATE_AFTER.test(after) && !(DATE_BEFORE.test(before) && !/\bthis\s*$/i.test(before)) && !thisDayOf) return null;
  return /effective date/i.test(before + " " + after) ? "agreement_date" : "firm_fill";
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

// ---------- exact geometry ----------

interface PageGeo {
  width: number;
  /** Printed characters that are not part of a blank (underscores / dot leaders). */
  ink: Glyph[];
  /** Exact runs of blank characters (underscores, dot leaders, ellipses). */
  runs: { x1: number; x2: number; baseline: number }[];
  hLines: Seg[];
}

const BLANK_CH = /^[_.…]$/;

function pageGeo(page: PageLayout): PageGeo {
  const gs = [...page.glyphs].sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const inRun = new Set<Glyph>();
  const runs: PageGeo["runs"] = [];
  for (let i = 0; i < gs.length; ) {
    if (!BLANK_CH.test(gs[i].ch)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < gs.length && BLANK_CH.test(gs[j + 1].ch) && Math.abs(gs[j + 1].baseline - gs[i].baseline) < 1 && gs[j + 1].x - gs[j].x2 < 2) j++;
    const run = gs.slice(i, j + 1);
    // A blank is 3+ underscores or 6+ dots; shorter runs are punctuation ("e.g.", "...").
    const n = run.length;
    if ((run[0].ch === "_" && n >= 3) || n >= 6) {
      run.forEach((g) => inRun.add(g));
      runs.push({ x1: run[0].x, x2: run[n - 1].x2, baseline: run[0].baseline });
    }
    i = j + 1;
  }
  return { width: page.width, ink: gs.filter((g) => !inRun.has(g) && g.ch.trim() !== ""), runs, hLines: page.hLines };
}

/** Replaces estimated blank edges with the exact glyph run (proportional estimates drift into nearby words). */
function snapToRuns(blanks: Blank[], geo: PageGeo) {
  for (const b of blanks) {
    if (b.kind !== "underscore" && b.kind !== "dots") continue;
    let best: PageGeo["runs"][number] | null = null;
    let bestOv = 0;
    for (const r of geo.runs) {
      if (Math.abs(r.baseline + 1 - b.bottom) > 3) continue;
      const ov = xOverlap(r.x1, r.x2, b.x1 - 25, b.x2 + 25);
      if (ov > bestOv) [best, bestOv] = [r, ov];
    }
    if (best) {
      b.x1 = best.x1;
      b.x2 = best.x2;
      b.bottom = best.baseline + 1;
    }
  }
}

/**
 * Shrinks a field box so it never covers printed text or a line: it rests on its own
 * line (bottom) and stops below the text/line above, before text to the right, and after
 * text to the left. Every stamped value is drawn inside this box.
 */
function fitBox(geo: PageGeo, x: number, w: number, h: number, bottom: number) {
  let top = bottom - h;
  for (const g of geo.ink) {
    // Text on the line above anywhere in this row (incl. a heading to the left, like "CLIENT") caps the
    // box, so a value never rises beside the previous line.
    if (g.baseline >= bottom - 2 || xOverlap(g.x, g.x2, x - 200, x + w) <= 0.5) continue;
    const descent = (g.baseline - g.y) * 0.25;
    top = Math.max(top, g.baseline + descent + 1);
  }
  for (const l of geo.hLines) if (l.y1 < bottom - 3 && xOverlap(l.x1, l.x2, x, x + w) > 1) top = Math.max(top, l.y1 + 1.5);
  // Text on the same rows: start after text on the left, stop before text on the right.
  const rowInk = geo.ink.filter((g) => g.y < bottom - 0.5 && g.baseline > top + 0.5);
  for (const g of rowInk) if (g.x < x + 2 && g.x2 > x) x = g.x2 + 1;
  for (const g of rowInk) if (g.x >= x && g.x < x + w) w = g.x - 1.5 - x;
  h = Math.max(bottom - 1 - top, 8);
  return { x, y: bottom - 1 - h, w: Math.max(w, 16), h };
}

/**
 * Regression check (tests + eval): printed characters a field's box overlaps. A field must
 * never cover printed text, or stamped values would sit on top of it.
 */
/**
 * Fits a field to the clear space on its page, whatever its origin (an older detection
 * frozen into a File's snapshot, a hand-placed field, or detection itself): it rests on its
 * line and never covers printed text. Used by sealing and the signing preview, so both
 * always stamp into the same, safe boxes.
 */
const geoCache = new WeakMap<PageLayout, PageGeo>();
export function fitToPage(page: PageLayout | undefined, f: FieldDef): FieldDef {
  if (!page || f.source === "acroform" || f.type === "checkbox") return f;
  let geo = geoCache.get(page);
  if (!geo) geoCache.set(page, (geo = pageGeo(page)));
  const W = page.width, H = page.height;
  const fit = fitBox(geo, f.x * W, f.w * W, f.h * H, (f.y + f.h) * H + 1);
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return { ...f, x: r(fit.x / W), y: r(Math.max(0, fit.y) / H), w: r(Math.min(fit.w, W - fit.x) / W), h: r(fit.h / H) };
}

export function inkOverlaps(page: PageLayout, f: FieldDef): string[] {
  if (f.source === "acroform") return []; // the document's own form defines that box
  const geo = pageGeo(page);
  const x1 = f.x * page.width, x2 = (f.x + f.w) * page.width, y1 = f.y * page.height, y2 = (f.y + f.h) * page.height;
  return geo.ink.filter((g) => xOverlap(g.x, g.x2, x1, x2) > 0.5 && xOverlap(g.y, g.baseline, y1, y2) > 0.5).map((g) => g.ch);
}

function toCandidate(b: Blank, geo: PageGeo): Candidate | null {
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
  const x0 = Math.min(b.x1, geo.width - w - 4);
  const fit = fitBox(geo, x0, w, h, b.bottom);
  return { page: b.page, type, label: labelFor(type, b.label.text), ...fit, typeConf, blank: b };
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
    if (own && own.side && own.conf >= 0.85) {
      c.roleHint = { side: own.side, conf: own.conf, why: own.why };
      c.blockKey = own.party !== undefined ? `party:${own.party}` : `label:${c.blank.label!.text}`;
      continue;
    }
    const phrases = phrasesByPage.get(c.page) ?? [];
    // r1: "for and on behalf of X" just below the line (UK style).
    const behalf = phrases.find(
      (p) => /on behalf of/i.test(p.text) && p.y >= c.y + c.h - 2 && p.y <= c.y + c.h + 30 && p.x <= c.x + c.w && p.x2 >= c.x - 20,
    );
    const bs = behalf && markerSide(behalf.text, pm);
    if (bs) {
      c.blockKey = bs.party !== undefined ? `party:${bs.party}` : `text:${behalf!.text}`;
      if (bs.side) c.roleHint = { side: bs.side, conf: bs.conf, why: `below: ${bs.why}` };
      else c.party = bs.party;
      continue;
    }
    // r2: nearest party heading above, preferring the same column.
    let best: { score: number; hint: Marker; text: string } | null = null;
    for (const p of phrases) {
      if (p.baseline > c.y + c.h + 2 || c.y - p.baseline > 360) continue;
      if (p.x > c.x + c.w) continue; // headings to the right belong to another column
      const ms = markerSide(p.text, pm);
      if (!ms) continue;
      if (ms.conf < 0.85 && /:\s*$/.test(p.text) && classify(p.text)) continue; // "Company:" is a field label; "[COMPANY]" is a heading
      const overlap = xOverlap(p.x, p.x2, c.x - 10, c.x + c.w);
      const hPenalty = overlap > 0 ? 0 : Math.max(0, c.x - p.x2) * 0.3;
      const score = Math.max(0, c.y - p.baseline) + hPenalty;
      if (!best || score < best.score) best = { score, text: p.text, hint: { ...ms, conf: ms.conf - (overlap > 0 ? 0 : 0.05), why: `heading: ${ms.why}` } };
    }
    // r3: an unnamed party heading ("INVESTOR:") directly above the block in the same column.
    // A closer unnamed heading ends the previous party's block, so it beats a known party word further up.
    const head = phrases
      .filter((p) => p.baseline <= c.y + 2 && c.y - p.baseline < 160 && p.x <= c.x + c.w && xOverlap(p.x, p.x2 + 200, c.x - 10, c.x + c.w) > 0 && isPartyHeading(p.text))
      .sort((a, b) => b.baseline - a.baseline)[0];
    const headIsCloser = head && !markerSide(head.text, pm) && (!best || c.y - head.baseline < best.score);
    if (best && !headIsCloser) {
      c.blockKey = best.hint.party !== undefined ? `party:${best.hint.party}` : `text:${best.text}`;
      if (best.hint.side) c.roleHint = { side: best.hint.side, conf: best.hint.conf, why: best.hint.why };
      else c.party = best.hint.party;
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
  const systemFields: Candidate[] = [];
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

    const geo = pageGeo(page);
    const text = textBlanks(phrases, page.items);
    snapToRuns(text, geo);
    // Drop drawn lines that sit under an underscore run (Word draws both).
    const lines = lineBlanks(page, phrases).filter((l) => !text.some((t) => Math.abs(t.bottom - l.bottom) < 6 && xOverlap(t.x1, t.x2, l.x1, l.x2) > 0.5 * (l.x2 - l.x1)));
    const boxes = boxBlanks(page, phrases).filter((b) => !page.widgets.some((w) => xOverlap(w.x, w.x + w.w, b.x1, b.x2) > 0 && Math.abs(w.y + w.h - b.bottom) < 6));
    const blanks = [...text, ...lines, ...boxes];
    stats.blanks += blanks.length;
    // Body-text date blanks (no signer): handled separately from signature blocks.
    const dateBlanks = new Set<Blank>();
    for (let k = 0; k < text.length; k++) {
      const b = text[k];
      const type = dateBlankType(b);
      if (!type) continue;
      const lab = b.label && classify(b.label.text);
      // Strong date wording ("this ___ day of", "___ (the "Effective Date")") wins over a label
      // ("Signed this ___ day of"). Otherwise a real field label wins ("Name: ___"), and
      // "Date: ___" only counts as the agreement's date outside a signature block.
      const strong = DATE_AFTER.test(b.after ?? "");
      if (!strong && lab && (lab.kind !== "date" || nearSignatureLabel(b, phrases))) continue;
      dateBlanks.add(b);
      let x2 = b.x2;
      // "this ___ day of ______, 2026": one field spanning both blanks.
      const next = text[k + 1];
      if (next && /^\s*day of\b/i.test(b.after ?? "") && next.page === b.page && Math.abs(next.bottom - b.bottom) < 3) {
        dateBlanks.add(next);
        x2 = next.x2;
        k++;
      }
      const fit = fitBox(geo, b.x1, Math.min(x2 - b.x1, 220), 15, b.bottom);
      systemFields.push({
        page: page.page,
        ...fit,
        type,
        label: type === "agreement_date" ? "Agreement date" : "Date",
        typeConf: 0.6,
        blank: { ...b, label: { text: (b.before ?? "").trim().split(/\s+/).slice(-4).join(" ") || "date", how: "prefix" } },
      });
    }
    for (const b of dateBlanks) blanks.splice(blanks.indexOf(b), 1);
    attachLabels(blanks, phrases);

    const used = new Set<Phrase>();
    for (const b of blanks) {
      if (!b.label) continue;
      if (classify(b.label.text)?.kind === "witness") {
        witness++;
        continue;
      }
      const cand = toCandidate(b, geo);
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
      const cand = toCandidate(a, geo);
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
  // Defined parties whose role isn't known ("the Counterparty"): if the other side is known they're
  // the opposite; otherwise the first-defined party is the firm, the next the client. Always flagged.
  {
    const known = new Set(cands.filter((c) => c.roleHint).map((c) => c.roleHint!.side));
    const unresolved = [...new Set(cands.filter((c) => !c.roleHint && c.party !== undefined).map((c) => c.party!))].sort((a, b) => a - b);
    unresolved.forEach((party, i) => {
      const p = pm.parties[party];
      const hint =
        known.size === 1
          ? { side: (known.has("firm") ? "client" : "firm") as Side, conf: 0.6, why: `defined party "${p.term}" (the other party)` }
          : { side: (i === 0 ? "firm" : "client") as Side, conf: 0.5, why: `defined party "${p.term}" (${i === 0 ? "first" : "second"} party in the preamble; check)` };
      for (const c of cands.filter((x) => !x.roleHint && x.party === party)) c.roleHint = hint;
    });
  }
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
  for (const c of cands.filter((x) => !x.roleHint && x.partyHeading)) {
    c.roleHint = headingSide.get(`${c.page}:${c.partyHeading!.text}`);
    c.blockKey = `heading:${c.partyHeading!.text}`;
  }
  // Fields without a hint inherit from the nearest field with direct evidence in the same block (no chaining).
  const evidenced = cands.filter((x) => x.roleHint);
  for (const c of cands.filter((x) => !x.roleHint && !x.partyHeading)) {
    const near = evidenced
      .filter((o) => o.page === c.page && xOverlap(o.x - 30, o.x + o.w + 30, c.x, c.x + c.w) > 0 && Math.abs(o.y - c.y) < 160)
      .sort((a, b) => Math.abs(a.y - c.y) - Math.abs(b.y - c.y))[0];
    if (near?.roleHint) {
      c.roleHint = { ...near.roleHint, conf: near.roleHint.conf - 0.1, why: `same block as a ${near.type}` };
      c.blockKey = near.blockKey;
    }
  }
  // Complement: if only one side was ever identified, remaining unknown fields are the other side.
  for (const c of cands.filter((x) => !x.roleHint)) {
    if (sidesSeen.size === 1) {
      const other: Side = sidesSeen.has("firm") ? "client" : "firm";
      c.roleHint = { side: other, conf: 0.65, why: "the other party" };
    } else c.roleHint = { side: "client", conf: 0.4, why: "no party heading found" };
  }

  // Two different signature blocks must not resolve to the same signer on weak evidence (both
  // "client" because neither party was recognised). Split them: preamble order if known, else
  // reading order; first block = firm, second = client. Both flagged for review.
  for (const page of new Set(cands.map((c) => c.page))) {
    const sigs = cands.filter((c) => c.page === page && c.type === "signature" && c.blockKey);
    for (const side of ["client", "firm"] as Side[]) {
      const blocks = [...new Set(sigs.filter((c) => c.roleHint!.side === side).map((c) => c.blockKey!))];
      if (blocks.length < 2) continue;
      const members = (k: string) => cands.filter((c) => c.page === page && c.blockKey === k);
      if (blocks.some((k) => members(k).some((c) => c.roleHint!.conf >= 0.9))) continue; // one block is certain
      const order = (k: string) => {
        const m = /^party:(\d+)$/.exec(k);
        const first = members(k).sort((a, b) => a.y - b.y || a.x - b.x)[0];
        return m ? Number(m[1]) * 1e6 : 1e9 + first.y * 1000 + first.x;
      };
      blocks.sort((a, b) => order(a) - order(b));
      blocks.slice(0, 2).forEach((k, i) => {
        for (const c of members(k))
          c.roleHint = { side: i === 0 ? "firm" : "client", conf: 0.5, why: `two signature blocks looked like the same party; ${i === 0 ? "first" : "second"} block assumed ${i === 0 ? "firm" : "client"}, check` };
      });
    }
  }

  // Keep date/name/title only if their block has a signature for the same party (or it's a form widget).
  const sigSides = new Set(cands.filter((c) => c.type === "signature").map((c) => `${c.page}:${c.roleHint!.side}`));
  cands = cands.filter((c) => ["signature", "initials", "checkbox"].includes(c.type) || sigSides.has(`${c.page}:${c.roleHint!.side}`));

  cands.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const sysOut = systemFields.filter((d) => !cands.some((c) => c.page === d.page && xOverlap(c.x, c.x + c.w, d.x, d.x + d.w) > 0 && Math.abs(c.y - d.y) < 10));

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

  const pgOf = (n: number) => byPage.get(n)!;
  for (const d of sysOut) {
    const pg = pgOf(d.page);
    fields.push({
      id: `d${fields.length + 1}`,
      page: d.page,
      x: clamp01(d.x / pg.width),
      y: clamp01(d.y / pg.height),
      w: clamp01(d.w / pg.width),
      h: clamp01(d.h / pg.height),
      type: d.type,
      roleKey: null,
      label: d.label,
      required: true,
      confidence: d.typeConf,
      source: "rule",
      reason: `empty blank in body text next to "${d.blank.label?.text}"; ${d.type === "agreement_date" ? "mentions the Effective Date, so it's filled automatically when the last party signs" : "a date you fill in when creating the File"}; check it`,
      ...(d.type === "firm_fill" ? { firmFillKey: "date" } : {}),
    });
  }
  fields.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);

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

/**
 * A field placed by hand: if it was dropped near a blank (underscore run, drawn line, or a
 * table cell's underline), snap it onto that blank with the size detection would give it.
 * Either way it never covers printed text (a heading or label). Coordinates are fractions of
 * the displayed page; returns null when the placement is fine as it is.
 */
export function snapPlacement(page: PageLayout | undefined, f: { x: number; y: number; w: number; h: number; type: FieldType }): { x: number; y: number; w: number; h: number; snapped: boolean } | null {
  if (!page || f.type === "checkbox") return null;
  let geo = geoCache.get(page);
  if (!geo) geoCache.set(page, (geo = pageGeo(page)));
  const W = page.width, H = page.height;
  const cx = (f.x + f.w / 2) * W, cy = (f.y + f.h / 2) * H;
  const blanks = [
    ...geo.runs.map((r) => ({ x1: r.x1, x2: r.x2, bottom: r.baseline + 1 })),
    ...splitAtVerticals(page.hLines, page.vLines)
      .filter((s) => s.x2 - s.x1 >= 30 && s.x2 - s.x1 <= W * 0.75)
      // A line with printed text sitting on it (a filled table row's border, an underlined heading) isn't a blank.
      .filter((s) => !geo!.ink.some((g) => g.baseline <= s.y1 + 1 && g.baseline >= s.y1 - 14 && xOverlap(g.x, g.x2, s.x1, s.x2) > 0.5))
      .map((s) => ({ x1: s.x1, x2: s.x2, bottom: s.y1 })),
  ];
  // Near = the click is over the blank's span and just above (or on) its line.
  let best: (typeof blanks)[number] | null = null;
  let bestCost = Infinity;
  for (const b of blanks) {
    const dx = cx < b.x1 ? b.x1 - cx : cx > b.x2 ? cx - b.x2 : 0;
    const dy = b.bottom - cy;
    if (dx > 12 || dy < -10 || dy > 40) continue;
    const cost = dx * 2 + Math.abs(dy - 6);
    if (cost < bestCost) [best, bestCost] = [b, cost];
  }
  const r = (n: number) => Math.round(n * 10000) / 10000;
  const out = (b: { x: number; y: number; w: number; h: number }, snapped: boolean) => ({ x: r(b.x / W), y: r(Math.max(0, b.y) / H), w: r(Math.min(b.w, W - b.x) / W), h: r(b.h / H), snapped });
  if (best) {
    const width = best.x2 - best.x1;
    const [w, h] = f.type === "signature" ? [Math.min(Math.max(width, 120), 240), 26] : f.type === "initials" ? [Math.min(Math.max(width, 40), 70), 20] : [Math.min(Math.max(width, 60), 220), 15];
    return out(fitBox(geo, Math.min(best.x1, W - w - 4), w, h, best.bottom), true);
  }
  // Not near a blank: keep it where it was dropped unless it covers text; then fit it to the clear space.
  const x1 = f.x * W, x2 = (f.x + f.w) * W, y1 = f.y * H, y2 = (f.y + f.h) * H;
  const covers = geo.ink.some((g) => xOverlap(g.x, g.x2, x1, x2) > 0.5 && xOverlap(g.y, g.baseline, y1, y2) > 0.5);
  return covers ? out(fitBox(geo, x1, x2 - x1, y2 - y1, y2 + 1), false) : null;
}

/** Every blank on a page as the geometry pass sees it (labeled or not), in displayed points. */
export interface PageBlank {
  page: number;
  x1: number;
  x2: number;
  bottom: number;
  kind: string;
  /** The printed label next to it, if any ("Date signed:"). */
  label: string | null;
}

/** All blanks on a page, the same way detection finds them (for an AI second opinion). */
export function listBlanks(page: PageLayout): PageBlank[] {
  const phrases = buildPhrases(page);
  const geo = pageGeo(page);
  const text = textBlanks(phrases, page.items);
  snapToRuns(text, geo);
  const lines = lineBlanks(page, phrases).filter((l) => !text.some((t) => Math.abs(t.bottom - l.bottom) < 6 && xOverlap(t.x1, t.x2, l.x1, l.x2) > 0.5 * (l.x2 - l.x1)));
  const boxes = boxBlanks(page, phrases);
  const all = [...text, ...lines, ...boxes];
  attachLabels(all, phrases);
  return all.map((b) => ({ page: page.page, x1: b.x1, x2: b.x2, bottom: b.bottom, kind: b.kind, label: b.label?.text ?? null }));
}

/** A field box on a blank, sized as detection would size it, never over printed text. Fractions of the page. */
export function boxForBlank(page: PageLayout, b: PageBlank, type: FieldType) {
  return snapPlacement(page, { x: b.x1 / page.width, y: (b.bottom - 14) / page.height, w: Math.max(b.x2 - b.x1, 20) / page.width, h: 14 / page.height, type });
}
