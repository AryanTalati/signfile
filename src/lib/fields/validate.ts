import type { FieldDef, RoleDef } from "./types";

/** Default signing parties: the client signs first, then the firm countersigns. */
export const DEFAULT_ROLES: RoleDef[] = [
  { key: "client", label: "Client", order: 1, kind: "client" },
  { key: "firm", label: "Firm (countersign)", order: 2, kind: "firm" },
];

export function rolesFor(countersign: boolean): RoleDef[] {
  return countersign ? DEFAULT_ROLES : DEFAULT_ROLES.filter((r) => r.kind === "client");
}

/** Problems that block sending. Pure: used by the editor (live) and the server (on save/send). */
export function validateFields(fields: FieldDef[], roles: RoleDef[], pageCount: number): string[] {
  const problems: string[] = [];
  const keys = new Set(roles.map((r) => r.key));
  for (const r of roles) if (!fields.some((f) => f.roleKey === r.key && f.type === "signature")) problems.push(`Add a signature field for the ${r.kind === "client" ? "client" : "firm"}.`);
  const orphan = fields.filter((f) => f.type !== "firm_fill" && (!f.roleKey || !keys.has(f.roleKey)));
  if (orphan.length) problems.push(`${orphan.length} field${orphan.length > 1 ? "s are" : " is"} assigned to a signer who isn't on this template.`);
  if (fields.some((f) => f.page > pageCount)) problems.push("A field is on a page that doesn't exist.");
  return problems;
}
