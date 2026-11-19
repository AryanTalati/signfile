import { hasNoSigner, type FieldDef, type RoleDef } from "./types";

/** Default signing parties: the client signs first, then the firm countersigns. */
export const DEFAULT_ROLES: RoleDef[] = [
  { key: "client", label: "Client", order: 1, kind: "client" },
  { key: "firm", label: "Firm (countersign)", order: 2, kind: "firm" },
];

/**
 * Signers for a template. countersign=false: client only. firmFirst=true ("Firm signs when
 * sending"): the firm signs first (order 1), the client last, so the File completes when the
 * client signs. Otherwise the client signs first and the firm countersigns.
 */
export function rolesFor(countersign: boolean, firmFirst = false): RoleDef[] {
  if (!countersign) return DEFAULT_ROLES.filter((r) => r.kind === "client");
  if (!firmFirst) return DEFAULT_ROLES;
  return [
    { key: "firm", label: "Firm (signs when sending)", order: 1, kind: "firm" },
    { key: "client", label: "Client", order: 2, kind: "client" },
  ];
}

export const isFirmFirst = (roles: RoleDef[] | null | undefined) => {
  const firm = roles?.find((r) => r.kind === "firm");
  const client = roles?.find((r) => r.kind === "client");
  return !!firm && !!client && firm.order < client.order;
};

/** Problems that block sending. Pure: used by the editor (live) and the server (on save/send). */
export function validateFields(fields: FieldDef[], roles: RoleDef[], pageCount: number): string[] {
  const problems: string[] = [];
  const keys = new Set(roles.map((r) => r.key));
  for (const r of roles) if (!fields.some((f) => f.roleKey === r.key && f.type === "signature")) problems.push(`Add a signature field for the ${r.kind === "client" ? "client" : "firm"}.`);
  const orphan = fields.filter((f) => !hasNoSigner(f.type) && (!f.roleKey || !keys.has(f.roleKey)));
  if (orphan.length) problems.push(`${orphan.length} field${orphan.length > 1 ? "s are" : " is"} assigned to a signer who isn't on this template.`);
  if (fields.some((f) => f.page > pageCount)) problems.push("A field is on a page that doesn't exist.");
  return problems;
}
