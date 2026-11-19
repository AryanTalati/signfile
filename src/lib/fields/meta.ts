import type { FieldType } from "./types";

/** Display metadata for field types. Sizes are in PDF points (converted to page fractions when placed). */
export const FIELD_META: Record<FieldType, { label: string; short: string; w: number; h: number; signerFills: boolean; hint: string }> = {
  signature: { label: "Signature", short: "Sign", w: 180, h: 32, signerFills: true, hint: "Signer draws or types their signature" },
  initials: { label: "Initials", short: "Init", w: 50, h: 24, signerFills: true, hint: "Signer's initials" },
  date_signed: { label: "Date signed", short: "Date", w: 100, h: 16, signerFills: false, hint: "Filled automatically when they sign" },
  full_name: { label: "Full name", short: "Name", w: 160, h: 16, signerFills: true, hint: "Pre-filled with the signer's name" },
  title: { label: "Title", short: "Title", w: 140, h: 16, signerFills: true, hint: "Pre-filled with the signer's title" },
  company: { label: "Company", short: "Co.", w: 160, h: 16, signerFills: true, hint: "Pre-filled with the signer's company" },
  text: { label: "Text", short: "Text", w: 160, h: 16, signerFills: true, hint: "Any text the signer types" },
  checkbox: { label: "Checkbox", short: "Box", w: 14, h: 14, signerFills: true, hint: "Signer ticks it" },
  firm_fill: { label: "Filled by you", short: "You", w: 140, h: 16, signerFills: false, hint: "You fill it when creating the File (fee, start date…)" },
  agreement_date: { label: "Agreement date", short: "Agmt date", w: 110, h: 16, signerFills: false, hint: "Filled automatically with the date the last party signs" },
};

export const PALETTE: FieldType[] = ["signature", "initials", "date_signed", "full_name", "title", "company", "text", "checkbox", "firm_fill", "agreement_date"];

/** Role colors (editor + signing page). */
export const ROLE_COLORS: Record<string, { bg: string; border: string; text: string; chip: string }> = {
  client: { bg: "rgba(37, 99, 235, 0.12)", border: "#2563eb", text: "#1e40af", chip: "bg-blue-600" },
  firm: { bg: "rgba(124, 58, 237, 0.12)", border: "#7c3aed", text: "#5b21b6", chip: "bg-violet-600" },
  none: { bg: "rgba(5, 150, 105, 0.12)", border: "#059669", text: "#065f46", chip: "bg-emerald-600" },
};
