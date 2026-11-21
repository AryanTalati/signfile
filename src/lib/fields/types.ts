/** Shared field/role/page types, stored as JSON in templates and File snapshots. */

export const FIELD_TYPES = [
  "signature",
  "initials",
  "date_signed",
  "full_name",
  "title",
  "company",
  "text",
  "checkbox",
  "firm_fill",
  "agreement_date",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** A signing party. Default roles: client (order 1), firm (order 2). */
export interface RoleDef {
  key: string;
  label: string;
  order: number;
  /** firm roles are signed by a user of the company (countersign). */
  kind: "client" | "firm";
}

/**
 * A field on the page AS DISPLAYED (rotation applied). x/y/w/h are fractions
 * (0-1) of the displayed page width/height, origin top-left. Only the stamping
 * code converts to PDF user space.
 */
export interface FieldDef {
  id: string;
  page: number; // 1-based
  x: number;
  y: number;
  w: number;
  h: number;
  type: FieldType;
  /** Which role fills it. null for firm_fill (filled at File creation) and agreement_date (filled automatically when the last party signs). */
  roleKey: string | null;
  label: string;
  required: boolean;
  /** For firm_fill: the key in files.firm_values. */
  firmFillKey?: string;
  /** 0-1. Below the review threshold (0.7), the editor flags it until reviewed. */
  confidence: number;
  source: "rule" | "manual" | "ai" | "appended" | "acroform";
  /** Why the detector placed it (shown on hover in the editor). */
  reason?: string;
  /** A person confirmed, moved or edited it in the editor. Clears the low-confidence flag. */
  reviewed?: boolean;
  /**
   * Set when the AI review proposed this field or disagreed with the rules about it. The field
   * stays in "Check fields" until a person confirms it, whatever its confidence (never auto-confirmed).
   */
  ai?: { suggestion: string; confidence: number };
}

export const REVIEW_THRESHOLD = 0.7;
/** Field types nobody signs: filled by the firm at File creation, or by the system. */
export const NO_SIGNER_TYPES: FieldType[] = ["firm_fill", "agreement_date"];
export const hasNoSigner = (t: FieldType) => NO_SIGNER_TYPES.includes(t);
export const needsReview = (f: FieldDef) => !f.reviewed && f.source !== "manual" && (f.confidence < REVIEW_THRESHOLD || !!f.ai);

export interface PageInfo {
  /** Media box size in PDF points, before rotation. */
  width: number;
  height: number;
  /** /Rotate, normalized to 0, 90, 180, 270. */
  rotation: 0 | 90 | 180 | 270;
}
