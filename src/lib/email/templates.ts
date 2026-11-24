/** Branded transactional emails. Plain, table-free HTML that renders in every client. */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface Brand {
  name: string;
  color: string;
}

function layout(brand: Brand, body: string) {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1a">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e4df;border-radius:12px;overflow:hidden">
<div style="padding:16px 24px;border-bottom:4px solid ${esc(brand.color)};font-weight:600;font-size:16px">${esc(brand.name)}</div>
<div style="padding:24px;font-size:15px;line-height:1.55">${body}</div>
</div>
<p style="max-width:560px;margin:12px auto 0;font-size:12px;color:#6b6b66">Sent with signfile on behalf of ${esc(brand.name)}.</p>
</body></html>`;
}

const button = (brand: Brand, href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${esc(href)}" style="display:inline-block;background:${esc(brand.color)};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${esc(label)}</a></p>`;

export function signRequestEmail(o: { brand: Brand; recipientName: string; documentName: string; clientLegalName: string; link: string; expiresAt: Date; senderName: string; countersign: boolean; revised?: { version: number; signAgain: boolean; note?: string | null } }) {
  const subject = o.revised ? `${o.brand.name}: revised "${o.documentName}" (version ${o.revised.version}) to sign` : `${o.brand.name}: please sign "${o.documentName}"`;
  // Date only, labelled UTC (the email can't know the reader's time zone).
  const exp = `${o.expiresAt.toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" })} (UTC)`;
  const html = layout(
    o.brand,
    `<p>Hi ${esc(o.recipientName.split(" ")[0])},</p>
<p>${esc(o.senderName)} at ${esc(o.brand.name)} sent you ${o.revised ? `a <strong>revised version (version ${o.revised.version})</strong> of ` : ""}<strong>${esc(o.documentName)}</strong> to sign for ${esc(o.clientLegalName)}.</p>
${o.revised?.note ? `<p><strong>What changed:</strong> ${esc(o.revised.note).replace(/\n/g, "<br>")}</p>` : ""}
${o.revised?.signAgain ? `<p><strong>You signed the earlier version. That signature doesn't carry over: please review and sign this version again.</strong> Your earlier link no longer works.</p>` : o.revised ? "<p>Earlier links no longer work; use the button below.</p>" : ""}
${button(o.brand, o.link, "Review and sign")}
<p style="font-size:13px;color:#6b6b66">You can also request changes from the same page. This link expires on ${exp}.</p>`,
  );
  const text = `Hi ${o.recipientName.split(" ")[0]},\n\n${o.senderName} at ${o.brand.name} sent you ${o.revised ? `a revised version (version ${o.revised.version}) of ` : ""}"${o.documentName}" to sign for ${o.clientLegalName}.${o.revised?.note ? `\n\nWhat changed: ${o.revised.note}` : ""}${o.revised?.signAgain ? "\n\nYou signed the earlier version; please sign this version again." : ""}\n\nReview and sign: ${o.link}\n\nYou can also request changes from the same page. This link expires on ${exp}.`;
  return { subject, html, text };
}

export function firmSignFirstEmail(o: { brand: Brand; recipientName: string; documentName: string; clientLegalName: string; link: string }) {
  const subject = `Sign to send: "${o.documentName}" for ${o.clientLegalName}`;
  const html = layout(
    o.brand,
    `<p>Hi ${esc(o.recipientName.split(" ")[0])},</p>
<p><strong>${esc(o.documentName)}</strong> for <strong>${esc(o.clientLegalName)}</strong> is ready. Your firm signs first; it goes to the client as soon as you sign.</p>
${button(o.brand, o.link, "Review and sign")}`,
  );
  const text = `"${o.documentName}" for ${o.clientLegalName}: your firm signs first. Sign: ${o.link}`;
  return { subject, html, text };
}

/**
 * Who just signed, for email copy: the signer's name, plus their company if one was entered,
 * never the firm's own name (if the client company equals the firm name, it's left out).
 */
export function signerLabel(name: string, company: string | null | undefined, firmName: string) {
  const c = (company ?? "").trim();
  // Compare ignoring case, punctuation and legal suffixes ("Acme Rentals LLC" is "Acme Rentals").
  const key = (x: string) =>
    x
      .toLowerCase()
      .replace(/\b(llc|inc|ltd|limited|corp|corporation|co|company|plc|gmbh|llp|lp)\b\.?/g, "")
      .replace(/[^a-z0-9]/g, "");
  const same = key(c) === key(firmName);
  return c && !same ? `${name} (${c})` : name;
}

export function countersignRequestEmail(o: { brand: Brand; recipientName: string; documentName: string; signerName: string; signerCompany?: string | null; link: string }) {
  const who = signerLabel(o.signerName, o.signerCompany, o.brand.name);
  const subject = `Countersign: ${who} signed "${o.documentName}"`;
  const html = layout(
    o.brand,
    `<p>Hi ${esc(o.recipientName.split(" ")[0])},</p>
<p><strong>${esc(who)}</strong> has signed <strong>${esc(o.documentName)}</strong>. It's ready for your countersignature.</p>
${button(o.brand, o.link, "Review and countersign")}`,
  );
  const text = `${who} has signed "${o.documentName}". Countersign: ${o.link}`;
  return { subject, html, text };
}

export function voidedEmail(o: { brand: Brand; recipientName: string; documentName: string; clientLegalName: string }) {
  const subject = `Voided: "${o.documentName}"`;
  const html = layout(
    o.brand,
    `<p>Hi ${esc(o.recipientName.split(" ")[0])},</p>
<p>${esc(o.brand.name)} has voided <strong>${esc(o.documentName)}</strong> for ${esc(o.clientLegalName)}. It can no longer be signed, and earlier signing links no longer work.</p>
<p style="font-size:13px;color:#6b6b66">If you have questions, reply to ${esc(o.brand.name)} directly.</p>`,
  );
  const text = `${o.brand.name} has voided "${o.documentName}" for ${o.clientLegalName}. It can no longer be signed.`;
  return { subject, html, text };
}

export function declinedEmail(o: { brand: Brand; recipientName: string; documentName: string; clientLegalName: string; declinedBy: string; reason: string }) {
  const subject = `Declined: "${o.documentName}" (${o.clientLegalName})`;
  const html = layout(
    o.brand,
    `<p>Hi ${esc(o.recipientName.split(" ")[0])},</p>
<p><strong>${esc(o.declinedBy)}</strong> declined to sign <strong>${esc(o.documentName)}</strong> for ${esc(o.clientLegalName)}. Signing has stopped and the signing links no longer work.</p>
<p><strong>Reason:</strong> ${esc(o.reason)}</p>`,
  );
  const text = `${o.declinedBy} declined to sign "${o.documentName}" for ${o.clientLegalName}. Signing has stopped.\n\nReason: ${o.reason}`;
  return { subject, html, text };
}

export function changesRequestedEmail(o: { brand: Brand; recipientName: string; documentName: string; clientLegalName: string; requestedBy: string; message: string; fileUrl: string }) {
  const subject = `Changes requested: "${o.documentName}" (${o.clientLegalName})`;
  const html = layout(
    o.brand,
    `<p>Hi ${esc(o.recipientName.split(" ")[0])},</p>
<p><strong>${esc(o.requestedBy)}</strong> requested changes to <strong>${esc(o.documentName)}</strong> for ${esc(o.clientLegalName)}. Signing is paused until you send a revised version.</p>
<p><strong>Their message:</strong><br>${esc(o.message).replace(/\n/g, "<br>")}</p>
${button(o.brand, o.fileUrl, "Open the File")}`,
  );
  const text = `${o.requestedBy} requested changes to "${o.documentName}" for ${o.clientLegalName}. Signing is paused.\n\nMessage: ${o.message}\n\nOpen the File: ${o.fileUrl}`;
  return { subject, html, text };
}

export function revisionNoticeEmail(o: { brand: Brand; recipientName: string; documentName: string; clientLegalName: string; version: number; signAgain: boolean; note?: string | null }) {
  const subject = `Revised: "${o.documentName}" (${o.clientLegalName}), version ${o.version}`;
  const html = layout(
    o.brand,
    `<p>Hi ${esc(o.recipientName.split(" ")[0])},</p>
<p>A revised version (version ${o.version}) of <strong>${esc(o.documentName)}</strong> for ${esc(o.clientLegalName)} has been sent for signature. Earlier links no longer work.</p>
${o.note ? `<p><strong>What changed:</strong> ${esc(o.note).replace(/\n/g, "<br>")}</p>` : ""}
<p>${o.signAgain ? "You signed the earlier version; that signature doesn't carry over. " : ""}You'll get a new link when it's your turn to sign.</p>`,
  );
  const text = `A revised version (version ${o.version}) of "${o.documentName}" for ${o.clientLegalName} has been sent. ${o.signAgain ? "Your earlier signature doesn't carry over. " : ""}You'll get a new link when it's your turn.`;
  return { subject, html, text };
}

/** To the firm: a File's signing links expired before everyone signed. */
export function expiredEmail(o: { brand: Brand; recipientName: string; documentName: string; clientLegalName: string; waitingOn: string | null; fileUrl: string }) {
  const subject = `Expired: "${o.documentName}" for ${o.clientLegalName}`;
  const waiting = o.waitingOn ? ` It was waiting on ${esc(o.waitingOn)}.` : "";
  const html = layout(
    o.brand,
    `<p>Hi ${esc(o.recipientName.split(" ")[0])},</p>
<p>The signing links for <strong>${esc(o.documentName)}</strong> for ${esc(o.clientLegalName)} expired before everyone signed.${waiting}</p>
<p>Open the File to extend it and resend the link, or void it.</p>
${button(o.brand, o.fileUrl, "Open the File")}`,
  );
  const text = `The signing links for "${o.documentName}" for ${o.clientLegalName} expired before everyone signed.${o.waitingOn ? ` It was waiting on ${o.waitingOn}.` : ""}\n\nOpen the File to extend it and resend the link, or void it: ${o.fileUrl}`;
  return { subject, html, text };
}

/** The signed-copy email for someone on "Send the signed copy to": same message as signers get, PDF attached, no signing link. */
export function signedCopyCcEmail(o: { documentName: string; firm: string; clientLegalName: string }) {
  return {
    subject: `Signed: "${o.documentName}"`,
    html: `<p>Hello,</p><p>Everyone has signed <strong>${esc(o.documentName)}</strong> (${esc(o.firm)} and ${esc(o.clientLegalName)}). ${esc(o.firm)} asked us to send you the signed copy: it's attached, with its certificate of completion.</p>`,
    text: `Everyone has signed "${o.documentName}" (${o.firm} and ${o.clientLegalName}). ${o.firm} asked us to send you the signed copy: it's attached, with its certificate of completion.`,
  };
}
