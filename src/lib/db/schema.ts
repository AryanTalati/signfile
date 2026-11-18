/**
 * Database schema (Drizzle). Every tenant table carries company_id and every
 * query must filter by it (see scoped helpers). RLS is enabled on all tables
 * with no policies: the server connects as the owner (bypasses RLS), while
 * Supabase's anon/authenticated roles get nothing even if the Data API is
 * turned on later. See drizzle/0001_security_and_audit.sql.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { FieldDef, PageInfo, RoleDef } from "@/lib/fields/types";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });
const companyId = () =>
  uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" });

// ---------- Enums ----------

export const userRole = pgEnum("user_role", ["admin", "member"]);

export const fileStatus = pgEnum("file_status", [
  "draft",
  "sent",
  "partially_signed",
  "completed",
  "changes_requested",
  "declined",
  "voided",
  "expired",
]);

export const recipientStatus = pgEnum("recipient_status", [
  "waiting", // not their turn yet (sequential signing)
  "active", // link is live, not opened
  "viewed",
  "signed",
  "declined",
  "changes_requested",
  "forwarded", // handed to another signer; this link is revoked
  "revoked", // voided File, superseded document version, or resend
]);

export const outboxStatus = pgEnum("outbox_status", ["queued", "sent", "failed", "skipped"]);

// ---------- Companies & users ----------

export const companies = pgTable("companies", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoKey: text("logo_key"),
  brandColor: text("brand_color").notNull().default("#1f4fd1"),
  /** Default firm countersigner for new Files. */
  defaultCountersignerId: uuid("default_countersigner_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  /** Days until a sent File's links expire. */
  linkExpiryDays: integer("link_expiry_days").notNull().default(30),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    companyId: companyId(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    title: text("title"),
    role: userRole("role").notNull().default("member"),
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
    lastLoginAt: ts("last_login_at"),
  },
  (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`), index("users_company_idx").on(t.companyId)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** sha256 of the cookie token; the raw token is never stored. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: companyId(),
    expiresAt: ts("expires_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const userInvites = pgTable(
  "user_invites",
  {
    id: id(),
    companyId: companyId(),
    email: text("email").notNull(),
    role: userRole("role").notNull().default("member"),
    tokenHash: text("token_hash").notNull().unique(),
    invitedById: uuid("invited_by_id").references(() => users.id, { onDelete: "set null" }),
    expiresAt: ts("expires_at").notNull(),
    acceptedAt: ts("accepted_at"),
    createdAt: createdAt(),
  },
  (t) => [index("user_invites_company_idx").on(t.companyId)],
);

// ---------- Templates ----------

export const templates = pgTable(
  "templates",
  {
    id: id(),
    companyId: companyId(),
    name: text("name").notNull(),
    currentVersion: integer("current_version").notNull().default(1),
    archivedAt: ts("archived_at"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("templates_company_idx").on(t.companyId)],
);

/** An agreement version. A revised agreement (after "request changes") is a new version. */
export const templateVersions = pgTable(
  "template_versions",
  {
    id: id(),
    companyId: companyId(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    sourceKey: text("source_key").notNull(),
    sourceFilename: text("source_filename").notNull(),
    sourceMime: text("source_mime").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    /** The PDF signers see (converted from DOCX, or the uploaded PDF with restrictions stripped). */
    pdfKey: text("pdf_key").notNull(),
    pdfSha256: text("pdf_sha256").notNull(),
    pageCount: integer("page_count").notNull(),
    pages: jsonb("pages").$type<PageInfo[]>().notNull(),
    roles: jsonb("roles").$type<RoleDef[]>().notNull(),
    fields: jsonb("fields").$type<FieldDef[]>().notNull().default([]),
    /** Detector output summary (method, counts, warnings) for review and debugging. */
    detection: jsonb("detection").$type<Record<string, unknown>>(),
    signaturePageAppended: boolean("signature_page_appended").notNull().default(false),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("template_versions_uq").on(t.templateId, t.version), index("template_versions_company_idx").on(t.companyId)],
);

// ---------- Files ----------

export const files = pgTable(
  "files",
  {
    id: id(),
    companyId: companyId(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    templateId: uuid("template_id").references(() => templates.id, { onDelete: "set null" }),
    reference: text("reference"),
    clientLegalName: text("client_legal_name").notNull(),
    /** Values the firm fills when creating the File (fee, start date, address...), keyed by firm_fill_key. */
    firmValues: jsonb("firm_values").$type<Record<string, string>>().notNull().default({}),
    status: fileStatus("status").notNull().default("draft"),
    /** The document version currently out for signature. */
    currentDocumentId: uuid("current_document_id"),
    expiresAt: ts("expires_at"),
    sentAt: ts("sent_at"),
    completedAt: ts("completed_at"),
    voidedAt: ts("voided_at"),
    voidReason: text("void_reason"),
    finalPdfKey: text("final_pdf_key"),
    finalSha256: text("final_sha256"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("files_company_status_idx").on(t.companyId, t.status),
    index("files_company_client_idx").on(t.companyId, t.clientLegalName),
    uniqueIndex("files_final_sha_uq").on(t.finalSha256),
  ],
);

/**
 * Snapshot of the agreement (PDF + fields) a File was sent with. Version 1 is
 * the original; each revision after "request changes" adds one. Later template
 * edits never change these rows.
 */
export const fileDocuments = pgTable(
  "file_documents",
  {
    id: id(),
    companyId: companyId(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    templateVersionId: uuid("template_version_id").references(() => templateVersions.id, { onDelete: "set null" }),
    pdfKey: text("pdf_key").notNull(),
    pdfSha256: text("pdf_sha256").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    sourceFilename: text("source_filename").notNull(),
    pages: jsonb("pages").$type<PageInfo[]>().notNull(),
    roles: jsonb("roles").$type<RoleDef[]>().notNull(),
    fields: jsonb("fields").$type<FieldDef[]>().notNull(),
    supersededAt: ts("superseded_at"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("file_documents_uq").on(t.fileId, t.versionNo), index("file_documents_company_idx").on(t.companyId)],
);

export const recipients = pgTable(
  "recipients",
  {
    id: id(),
    companyId: companyId(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => fileDocuments.id, { onDelete: "cascade" }),
    roleKey: text("role_key").notNull(),
    signingOrder: integer("signing_order").notNull(),
    /** Set for the firm countersigner; null for external signers. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    title: text("title"),
    email: text("email").notNull(),
    /** 32 random bytes, base64url. Stored so the firm can copy the link again; revoked by status. */
    token: text("token").notNull().unique(),
    status: recipientStatus("status").notNull().default("waiting"),
    values: jsonb("values").$type<Record<string, unknown>>().notNull().default({}),
    consentAt: ts("consent_at"),
    viewedAt: ts("viewed_at"),
    signedAt: ts("signed_at"),
    declinedAt: ts("declined_at"),
    declineReason: text("decline_reason"),
    changeComment: text("change_comment"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    /** Signer's IANA time zone from the browser, for local time on the certificate. */
    timezone: text("timezone"),
    forwardedFromId: uuid("forwarded_from_id").references((): AnyPgColumn => recipients.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("recipients_file_idx").on(t.fileId), index("recipients_company_idx").on(t.companyId)],
);

// ---------- Audit, email, deletion ----------

/** Append-only audit log. UPDATE/DELETE are blocked by trigger except inside purge_client_files(). */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    companyId: companyId(),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id").references(() => recipients.id, { onDelete: "cascade" }),
    /** 'user' | 'recipient' | 'system' */
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    actorLabel: text("actor_label"),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("events_file_idx").on(t.fileId, t.createdAt), index("events_company_idx").on(t.companyId, t.createdAt)],
);

/** Every email the platform sends, recorded before sending. Shown in-app. */
export const outbox = pgTable(
  "outbox",
  {
    id: id(),
    companyId: companyId(),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id").references(() => recipients.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    toEmail: text("to_email").notNull(),
    toName: text("to_name"),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),
    /** [{ filename, storageKey }] */
    attachments: jsonb("attachments").$type<{ filename: string; storageKey: string }[]>().notNull().default([]),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    status: outboxStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    createdAt: createdAt(),
    sentAt: ts("sent_at"),
  },
  (t) => [index("outbox_company_idx").on(t.companyId, t.createdAt), index("outbox_file_idx").on(t.fileId)],
);

/** PII-free record that a purge happened. Not cascaded from files. */
export const deletionLog = pgTable("deletion_log", {
  id: id(),
  companyId: companyId(),
  deletedByUserId: uuid("deleted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  /** sha256 of the lower-cased client legal name, so a repeat request can be matched without storing the name. */
  clientNameSha256: text("client_name_sha256").notNull(),
  fileCount: integer("file_count").notNull(),
  createdAt: createdAt(),
});
