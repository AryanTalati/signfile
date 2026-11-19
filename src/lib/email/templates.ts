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

export function signRequestEmail(o: { brand: Brand; recipientName: string; documentName: string; clientLegalName: string; link: string; expiresAt: Date; senderName: string; countersign: boolean }) {
  const subject = `${o.brand.name}: please sign "${o.documentName}"`;
  // Date only, labelled UTC (the email can't know the reader's time zone).
  const exp = `${o.expiresAt.toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" })} (UTC)`;
  const html = layout(
    o.brand,
    `<p>Hi ${esc(o.recipientName.split(" ")[0])},</p>
<p>${esc(o.senderName)} at ${esc(o.brand.name)} sent you <strong>${esc(o.documentName)}</strong> to sign for ${esc(o.clientLegalName)}.</p>
${button(o.brand, o.link, "Review and sign")}
<p style="font-size:13px;color:#6b6b66">If you're not the right person to sign, open the link and use <em>Forward to someone else</em>. You can also request changes from the same page. This link expires on ${exp}.</p>`,
  );
  const text = `Hi ${o.recipientName.split(" ")[0]},\n\n${o.senderName} at ${o.brand.name} sent you "${o.documentName}" to sign for ${o.clientLegalName}.\n\nReview and sign: ${o.link}\n\nNot the right person? Open the link and choose "Forward to someone else". This link expires on ${exp}.`;
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

export function countersignRequestEmail(o: { brand: Brand; recipientName: string; documentName: string; clientLegalName: string; link: string }) {
  const subject = `Countersign: ${o.clientLegalName} signed "${o.documentName}"`;
  const html = layout(
    o.brand,
    `<p>Hi ${esc(o.recipientName.split(" ")[0])},</p>
<p><strong>${esc(o.clientLegalName)}</strong> has signed <strong>${esc(o.documentName)}</strong>. It's ready for your countersignature.</p>
${button(o.brand, o.link, "Review and countersign")}`,
  );
  const text = `${o.clientLegalName} has signed "${o.documentName}". Countersign: ${o.link}`;
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
