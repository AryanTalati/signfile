/** PDF test agreements, each exercising a layout the detector wasn't built around. */
import { createCanvas } from "@napi-rs/canvas";
import { degrees, rgb } from "pdf-lib";
import { clauses, Writer } from "./layout";

const intro = (w: Writer, title: string, firm: string, client: string, firmTerm = "Provider", clientTerm = "Client") => {
  w.para(title, { size: 16, bold: true, align: "center", after: 14 });
  w.para(
    `This agreement is entered into by ${firm} (the "${firmTerm}") and ${client} (the "${clientTerm}"). TEST DOCUMENT - NOT A REAL AGREEMENT.`,
    { after: 10 },
  );
};

/** Signature lines drawn as vector paths, labels BELOW the line, stacked blocks. */
export async function pdfDrawnLines(firm: string, client: string) {
  const w = await Writer.create({ serif: true });
  intro(w, "MASTER SERVICES AGREEMENT", firm, client);
  clauses(w, 9);
  w.newPage();
  w.heading("SIGNATURES");
  w.para("The parties have caused this Agreement to be executed by their duly authorized representatives.", { after: 24 });

  const block = (heading: string) => {
    w.para(heading, { bold: true, after: 34 });
    const left = w.margin;
    const y1 = w.y;
    w.line(left, y1, left + 260, y1);
    w.line(left + 300, y1, left + 460, y1);
    w.text("Signature", left, y1 - 12, { size: 8 });
    w.text("Date", left + 300, y1 - 12, { size: 8 });
    const y2 = y1 - 50;
    w.line(left, y2, left + 260, y2);
    w.line(left + 300, y2, left + 460, y2);
    w.text("Printed name", left, y2 - 12, { size: 8 });
    w.text("Title", left + 300, y2 - 12, { size: 8 });
    w.y = y2 - 60;
  };
  block("CLIENT");
  block(firm.toUpperCase());
  return w.doc.save();
}

/** Two signature blocks side by side; party labels PROVIDER / CUSTOMER, underscores as text. */
export async function pdfTwoColumn(firm: string, client: string) {
  const w = await Writer.create();
  intro(w, "Professional Services Agreement", firm, client, "Provider", "Customer");
  clauses(w, 6);
  w.ensure(260);
  w.gap(20);
  w.para("IN WITNESS WHEREOF, the parties have executed this Agreement as of the Effective Date.", { after: 24 });
  const top = w.y;
  const cols = [
    { x: w.margin, head: "PROVIDER", name: firm },
    { x: w.margin + w.width / 2 + 10, head: "CUSTOMER", name: client },
  ];
  for (const c of cols) {
    let y = top;
    w.text(c.head, c.x, y, { bold: true, size: 10 });
    w.text(c.name, c.x, (y -= 14), { size: 10 });
    for (const label of ["By:", "Name:", "Title:", "Date:"]) {
      y -= 30;
      w.text(`${label} ______________________________`, c.x, y, { size: 10 });
    }
  }
  return w.doc.save();
}

/** Six pages with per-page initials boxes in the footer, signatures on the last page. */
export async function pdfMultipageInitials(firm: string, client: string) {
  const w = await Writer.create();
  const footer = (wr: Writer) => {
    const y = 40;
    wr.text("Client initials:", wr.margin, y, { size: 8 });
    wr.rect(wr.margin + 62, y - 6, 48, 20);
    wr.text(`${firm} initials:`, wr.margin + 200, y, { size: 8 });
    wr.rect(wr.margin + 200 + wr.font.widthOfTextAtSize(`${firm} initials:`, 8) + 6, y - 6, 48, 20);
    wr.text(`Page ${wr.pageNo}`, wr.size[0] - wr.margin - 30, y, { size: 8 });
  };
  w.onNewPage = footer;
  footer(w);
  intro(w, "STATEMENT OF WORK AND SERVICES TERMS", firm, client);
  clauses(w, 13);
  while (w.pageNo < 5) clauses(w, 2, 7);
  w.newPage();
  w.heading("AGREED AND ACCEPTED");
  w.gap(16);
  w.para(`Signed for the Client (${client}):   ________________________________`, { after: 18 });
  w.para("Date:   ________________", { after: 40 });
  w.para(`Signed for ${firm}:   ________________________________`, { after: 18 });
  w.para("Date:   ________________");
  return w.doc.save();
}

/** Page 2 is stored landscape with /Rotate 90 and content drawn so it displays upright. */
export async function pdfRotated(firm: string, client: string) {
  const w = await Writer.create();
  intro(w, "Data Services Agreement", firm, client);
  clauses(w, 4);

  const page = w.doc.addPage([792, 612]);
  page.setRotation(degrees(90));
  // Displayed (portrait) coords: dx from left, dy from top  ->  media x = dy, y = dx.
  const t = (s: string, dx: number, dy: number, size = 10, bold = false) =>
    page.drawText(s, { x: dy, y: dx, size, font: bold ? w.bold : w.font, rotate: degrees(90) });
  const ln = (dx1: number, dx2: number, dy: number) =>
    page.drawLine({ start: { x: dy, y: dx1 }, end: { x: dy, y: dx2 }, thickness: 0.75, color: rgb(0, 0, 0) });

  t("SIGNATURE PAGE", 72, 90, 14, true);
  t("Data Services Agreement", 72, 110);
  let dy = 180;
  for (const party of [`CLIENT: ${client}`, firm]) {
    t(party, 72, dy, 11, true);
    dy += 40;
    for (const label of ["Signature", "Name", "Title", "Date"]) {
      t(label, 72, dy);
      ln(150, 400, dy + 2);
      dy += 34;
    }
    dy += 30;
  }
  return w.doc.save();
}

/** An engagement letter with no signature area at all. Should fall back to "append a signature page". */
export async function pdfNoSignatureArea(firm: string, client: string) {
  const w = await Writer.create({ serif: true });
  w.para(firm, { size: 14, bold: true, after: 2 });
  w.para("1200 Example Street, Denver, CO 80202", { size: 9, after: 20 });
  w.para(`Attn: Legal Department\n${client}`, { after: 16 });
  w.para("Re: Engagement Letter for AI Readiness Assessment", { bold: true, after: 12 });
  w.para("Dear Client,", { after: 10 });
  w.para(
    `Thank you for choosing ${firm}. This letter confirms the terms of our engagement. Please sign and return this letter to confirm your acceptance. TEST DOCUMENT - NOT A REAL AGREEMENT.`,
  );
  clauses(w, 5);
  w.para("We look forward to working with you.", { after: 20 });
  w.para("Sincerely,", { after: 6 });
  w.para(firm);
  return w.doc.save();
}

/** Existing AcroForm text fields and a checkbox, like PDFs exported from contract tools. */
export async function pdfAcroForm(firm: string, client: string) {
  const w = await Writer.create();
  intro(w, "SOFTWARE DEVELOPMENT AGREEMENT", firm, client, "Developer", "Customer");
  clauses(w, 7);
  w.newPage();
  w.heading("Acceptance");
  const form = w.doc.getForm();
  const field = (name: string, label: string, x: number, y: number, width = 200) => {
    w.text(label, x, y + 22, { size: 8 });
    const f = form.createTextField(name);
    f.addToPage(w.page, { x, y, width, height: 18, borderColor: rgb(0.4, 0.4, 0.4) });
  };
  const top = w.y - 40;
  w.text("CUSTOMER", w.margin, top + 40, { bold: true });
  field("customer_signature", "Signature", w.margin, top);
  field("customer_name", "Name", w.margin, top - 50);
  field("customer_date", "Date", w.margin, top - 100, 120);
  w.text("DEVELOPER", w.margin + 260, top + 40, { bold: true });
  field("developer_signature", "Signature", w.margin + 260, top);
  field("developer_name", "Name", w.margin + 260, top - 50);
  field("developer_date", "Date", w.margin + 260, top - 100, 120);
  const cb = form.createCheckBox("dpa_ack");
  cb.addToPage(w.page, { x: w.margin, y: top - 160, width: 12, height: 12 });
  w.text("Customer acknowledges the Data Processing Addendum.", w.margin + 18, top - 158, { size: 9 });
  return w.doc.save();
}

/**
 * ~150 pages with an incompressible image every 10 pages, so the file is
 * several MB. Signature block (underscores) on the final page.
 */
export async function pdfLarge(firm: string, client: string) {
  const w = await Writer.create();
  intro(w, "ENTERPRISE FRAMEWORK AGREEMENT", firm, client);
  let seed = 42;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  while (w.pageNo < 150) {
    clauses(w, 3, w.pageNo);
    if (w.pageNo % 10 === 0) {
      const c = createCanvas(700, 500);
      const ctx = c.getContext("2d");
      const img = ctx.createImageData(700, 500);
      for (let i = 0; i < img.data.length; i++) img.data[i] = i % 4 === 3 ? 255 : Math.floor(rand() * 256);
      ctx.putImageData(img, 0, 0);
      const png = await w.doc.embedJpg(await c.encode("jpeg", 92));
      w.ensure(220);
      w.page.drawImage(png, { x: w.margin, y: w.y - 200, width: 280, height: 200 });
      w.y -= 214;
      w.para(`Figure ${w.pageNo / 10}: architecture diagram (placeholder).`, { size: 8 });
    }
  }
  w.newPage();
  w.heading("SIGNATURES");
  for (const party of [client, firm]) {
    w.para(party.toUpperCase(), { bold: true, after: 20 });
    for (const label of ["Signature", "Name", "Date"]) w.para(`${label}: ______________________________`, { after: 16 });
    w.gap(20);
  }
  return w.doc.save();
}

/** The source for the scanned fixture: a short agreement with an underscore signature block. */
export async function pdfScanSource(firm: string, client: string) {
  const w = await Writer.create({ serif: true });
  intro(w, "CONSULTING AGREEMENT", firm, client);
  clauses(w, 5);
  w.gap(20);
  for (const party of [`CLIENT: ${client}`, firm]) {
    w.para(party, { bold: true, after: 20 });
    w.para("Signature: ______________________________    Date: ______________", { after: 16 });
    w.para("Name: ___________________________________    Title: _____________", { after: 30 });
  }
  return w.doc.save();
}

/** A body-text line containing one or more blanks; optionally overlays a value on a blank (as DocuSign/Word fill-ins do). */
function lineWithBlanks(w: Writer, parts: (string | { blank: string; fill?: string })[], size = 10.5) {
  w.ensure(size * 2);
  const text = parts.map((p) => (typeof p === "string" ? p : p.blank)).join("");
  const y = w.y - size;
  w.page.drawText(text, { x: w.margin, y, size, font: w.font });
  let x = w.margin;
  for (const p of parts) {
    const s = typeof p === "string" ? p : p.blank;
    if (typeof p !== "string" && p.fill) w.page.drawText(p.fill, { x: x + 4, y: y + 1.5, size: size - 0.5, font: w.font });
    x += w.font.widthOfTextAtSize(s, size);
  }
  w.y -= size * 1.6;
}

/**
 * Date blanks inside body text: 'made as of ____ (the "Effective Date")', 'Dated: ____',
 * 'Signed this ___ day of ____, 2026'. With fill=true, each blank already has a value typed
 * over it (DocuSign/Word-filled), and the client's printed name is filled in too.
 */
export async function pdfDateBlanks(firm: string, client: string, fill: boolean) {
  const w = await Writer.create();
  const B = (n: number, value?: string) => ({ blank: "_".repeat(n), fill: fill ? value : undefined });
  w.para("MUTUAL NON-DISCLOSURE AGREEMENT", { size: 15, bold: true, align: "center", after: 12 });
  lineWithBlanks(w, ["Dated: ", B(22, "November 20, 2026")]);
  w.gap(6);
  lineWithBlanks(w, ["This Mutual Non-Disclosure Agreement is made as of ", B(18, "10/22/2026"), ' (the "Effective Date")']);
  w.para(`by and between ${firm} (the "Provider") and ${client} (the "Client"). TEST DOCUMENT - NOT A REAL AGREEMENT.`, { after: 10 });
  clauses(w, 6);
  w.newPage();
  w.heading("SIGNATURES");
  lineWithBlanks(w, ["Signed this ", B(8, "20th"), " day of ", B(16, "November"), ", 2026."]);
  w.gap(18);
  for (const [party, filledName] of [[`CLIENT: ${client}`, "Pat Example"], [firm.toUpperCase(), undefined]] as const) {
    w.para(party, { bold: true, after: 16 });
    lineWithBlanks(w, ["Signature: ", B(34)]);
    w.gap(6);
    lineWithBlanks(w, ["Name: ", B(38, filledName)]);
    w.gap(6);
    lineWithBlanks(w, ["Date: ", B(20)]);
    w.gap(22);
  }
  return w.doc.save();
}

/**
 * Parties defined with words outside our vocabulary ("Company" + "Counterparty"), a firm
 * account name that doesn't appear in the document, two-column blocks, and a zero-size
 * leftover form widget at a page corner (as DocuSign exports leave behind).
 */
export async function pdfUnknownParties(first: string, second: string) {
  const w = await Writer.create();
  w.para("MUTUAL NON-DISCLOSURE AGREEMENT", { size: 15, bold: true, align: "center", after: 12 });
  w.para(`This Mutual Non-Disclosure Agreement is entered into by ${first} (the "Company") and ${second} (the "Counterparty"). TEST DOCUMENT - NOT A REAL AGREEMENT.`, { after: 10 });
  clauses(w, 6);
  const form = w.doc.getForm();
  const ghost = form.createTextField("Signature_leftover");
  ghost.addToPage(w.page, { x: 0, y: 0, width: 0.5, height: 0.5, borderWidth: 0 });
  w.newPage();
  w.heading("SIGNATURES");
  w.gap(10);
  const top = w.y;
  const cols = [
    { x: w.margin, head: first.toUpperCase() },
    { x: w.margin + w.width / 2 + 10, head: "COUNTERPARTY" },
  ];
  for (const c of cols) {
    let y = top;
    w.text(c.head, c.x, y, { bold: true, size: 10 });
    for (const label of ["By:", "Name:", "Title:", "Date:"]) {
      y -= 30;
      w.text(`${label} ____________________________`, c.x, y, { size: 10 });
    }
  }
  return w.doc.save();
}
