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
  /** Which role fills it. firm_fill fields have no role (filled at File creation). */
  roleKey: string | null;
  label: string;
  required: boolean;
  /** For firm_fill: the key in files.firm_values. */
  firmFillKey?: string;
  /** 0-1. Below the review threshold, the editor flags it. */
  confidence: number;
  source: "rule" | "manual" | "ai" | "appended" | "acroform";
}

export interface PageInfo {
  /** Media box size in PDF points, before rotation. */
  width: number;
  height: number;
  /** /Rotate, normalized to 0, 90, 180, 270. */
  rotation: 0 | 90 | 180 | 270;
}
