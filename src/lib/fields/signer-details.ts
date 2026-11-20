/**
 * A signer's own details (name, title) as they appear in the signed document. Pure.
 */
import type { FieldDef } from "./types";

const DETAIL_LABEL = { full_name: "Name", title: "Title" } as const;
type DetailType = keyof typeof DETAIL_LABEL;

/**
 * Prefilled name/title values the signer changed before signing, once per field type
 * ("Name changed from X to Y"). A blank prefill (e.g. no title on the File) isn't a change.
 */
export function detailChanges(mine: FieldDef[], prefill: Record<string, string>, values: Record<string, string>) {
  const out: { field: string; from: string; to: string }[] = [];
  for (const type of Object.keys(DETAIL_LABEL) as DetailType[]) {
    const fields = mine.filter((f) => f.type === type);
    const from = fields.map((f) => (prefill[f.id] ?? "").trim()).find(Boolean);
    if (!from) continue;
    const to = fields.map((f) => (values[f.id] ?? "").trim()).find((v) => v !== from);
    if (to !== undefined) out.push({ field: DETAIL_LABEL[type], from, to });
  }
  return out;
}

/**
 * The title this signer used in the signed document: what they entered in their own Title
 * field. Null when the document has no Title field for them (the certificate then shows none,
 * rather than a title from their profile or the File form that may contradict the document).
 */
export function signedTitle(fields: FieldDef[], roleKey: string, values: Record<string, unknown>): string | null {
  for (const f of fields) {
    if (f.type !== "title" || f.roleKey !== roleKey) continue;
    const v = values[f.id];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
