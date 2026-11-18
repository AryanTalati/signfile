/**
 * Writes a small, genuinely encrypted PDF (Standard Security Handler, V1/R2,
 * 40-bit RC4) by hand. pdf-lib can't write encrypted PDFs and we don't want a
 * qpdf dependency just for fixtures.
 *
 * - userPassword non-empty  -> the PDF needs a password to open (we must reject it)
 * - userPassword ""          -> opens without a password, but is encrypted with
 *                               permission restrictions (common in the wild)
 */
import { createHash } from "node:crypto";

const PAD = Buffer.from(
  "28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A",
  "hex",
);

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

const md5 = (...parts: Buffer[]) => createHash("md5").update(Buffer.concat(parts)).digest();
const pad = (pw: string) => Buffer.concat([Buffer.from(pw, "latin1"), PAD]).subarray(0, 32);

export function encryptedPdf(opts: { userPassword: string; ownerPassword: string; lines: string[] }): Buffer {
  const id = createHash("md5").update(opts.lines.join("|") + opts.userPassword).digest();
  const P = -44; // no print/modify/copy/annotate beyond the basics
  const pBytes = Buffer.alloc(4);
  pBytes.writeInt32LE(P);

  const O = rc4(md5(pad(opts.ownerPassword || opts.userPassword)).subarray(0, 5), pad(opts.userPassword));
  const fileKey = md5(pad(opts.userPassword), O, pBytes, id).subarray(0, 5);
  const U = rc4(fileKey, PAD);

  const objKey = (num: number) => {
    const b = Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0]);
    return md5(fileKey, b).subarray(0, 10);
  };

  const content =
    "BT /F1 11 Tf 72 720 Td 14 TL\n" +
    opts.lines.map((l) => `(${l.replace(/[()\\]/g, "\\$&")}) '`).join("\n") +
    "\nET";
  const stream = rc4(objKey(4), Buffer.from(content, "latin1"));

  const hex = (b: Buffer) => `<${b.toString("hex")}>`;
  const objects: (string | Buffer)[][] = [
    ["<< /Type /Catalog /Pages 2 0 R >>"],
    ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
    ["<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"],
    [`<< /Length ${stream.length} >>\nstream\n`, stream, "\nendstream"],
    ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"],
    [`<< /Filter /Standard /V 1 /R 2 /O ${hex(O)} /U ${hex(U)} /P ${P} >>`],
  ];

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  let offset = chunks[0].length;
  const offsets: number[] = [];
  objects.forEach((parts, i) => {
    offsets.push(offset);
    const body = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      ...parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : p)),
      Buffer.from("\nendobj\n"),
    ]);
    chunks.push(body);
    offset += body.length;
  });
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 6 0 R /ID [${hex(id)} ${hex(id)}] >>\n` +
    `startxref\n${offset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(chunks);
}
