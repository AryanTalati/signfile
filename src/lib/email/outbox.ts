import "server-only";
import { db, schema } from "@/lib/db/client";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Every email is recorded here BEFORE any send attempt, so it's visible in the
 * in-app outbox even if delivery fails or isn't configured. Delivery is
 * best-effort and never blocks the signing path.
 *
 * Outbox-only for now (decided Nov 19): without an email provider configured,
 * rows are stored as "skipped" with a clear reason. Signing links are always
 * shown in the app, so nothing depends on delivery.
 */
export async function recordEmail(
  tx: Tx,
  e: { companyId: string; fileId?: string; recipientId?: string; kind: string; toEmail: string; toName?: string; subject: string; html: string; text: string },
) {
  const configured = !!process.env.RESEND_API_KEY;
  const [row] = await tx
    .insert(schema.outbox)
    .values({
      ...e,
      status: configured ? "queued" : "skipped",
      provider: configured ? "resend" : null,
      error: configured ? null : "Email delivery isn't configured yet (outbox only). Share the signing link from the File page.",
    })
    .returning({ id: schema.outbox.id });
  return row.id;
}
