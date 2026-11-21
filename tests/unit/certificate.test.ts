import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { appendCertificate, type CertData } from "../../src/lib/pdf/certificate";
import { extractLayout } from "../../src/lib/pdf/extract";
import { uaSummary } from "../../src/lib/http/user-agent";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36";
const t = (s: number) => new Date(Date.UTC(2026, 10, 20, 23, 19, s));

/** A typical File: client signs in their browser, the firm countersigns automatically. */
function typicalEvents() {
  const ev = (s: number, type: string, actor: string, data: Record<string, unknown> = {}, ip: string | null = "70.162.26.248") => ({ at: t(s), type, actor, ip, data });
  return [
    ev(1, "file.created", "Test Admin", {}, null),
    ev(2, "file.sent", "Test Admin", { to: { name: "Jordan Blake" } }),
    ev(3, "recipient.viewed", "Jordan Blake"),
    ev(4, "recipient.consented", "Jordan Blake"),
    ev(5, "recipient.details_changed", "Jordan Blake", { field: "Title", from: "CEO", to: "Managing Director" }),
    ev(6, "recipient.signed", "Jordan Blake"),
    ev(7, "recipient.activated", "system", { name: "Test Admin" }, null),
    ev(8, "recipient.consented", "Test Admin", { inAdvance: true, authorizedAt: t(0).toISOString() }),
    ev(9, "recipient.signed", "Test Admin"),
    ev(10, "file.completed", "system", {}, null),
    ev(11, "recipient.auto_countersigned", "Test Admin", { authorizedAt: t(0).toISOString() }),
  ];
}

async function build(events: CertData["events"]) {
  const pdf = await PDFDocument.create();
  const data: CertData = {
    font: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    fileId: "8a229a12-3e54-4fd8-aed8-0d66ddfa791b",
    documentName: "Consulting Services Agreement",
    firm: "Astra AI",
    client: "Northwind Analytics LLC",
    reference: "JOB-2026-114",
    completedAt: t(10),
    firmTimezone: "America/Phoenix",
    sourceSha256: "a".repeat(64),
    documentSha256: "b".repeat(64),
    documentVersion: 2,
    verifyUrl: "https://signfile.onrender.com/verify",
    signers: [
      { name: "Jordan Blake", email: "jordan@example.com", title: "Managing Director", role: "Signed for Northwind Analytics LLC", ip: "70.162.26.248", userAgent: MAC_CHROME, timezone: "America/Phoenix", consentAt: t(4), signedAt: t(6), autoAuthorizedAt: null, signature: PNG },
      { name: "Test Admin", email: "admin@example.com", title: "Managing Partner", role: "Signed for Astra AI", ip: "70.162.26.248", userAgent: MAC_CHROME, timezone: null, consentAt: t(0), signedAt: t(9), autoAuthorizedAt: t(0), signature: PNG },
    ],
    events,
  };
  const pages = await appendCertificate(pdf, data);
  const layout = await extractLayout(new Uint8Array(await pdf.save()));
  return { pages, layout };
}

/** Lines of text on a page (distinct baselines), excluding the "(continued)" header. */
const contentLines = (p: Awaited<ReturnType<typeof extractLayout>>[number]) => {
  const items = p.items.filter((i) => !i.str.startsWith("Certificate of Completion (continued)") && !(i.str.startsWith("File ID ") && p.items.some((x) => x.str.startsWith("Certificate of Completion (continued)"))));
  return new Set(items.map((i) => Math.round(i.baseline))).size;
};

test("certificate: a typical File fits on one page; long event logs paginate without orphan lines", async () => {
  const typical = await build(typicalEvents());
  assert.equal(typical.pages, 1, "typical certificate is one page");
  const text = typical.layout[0].items.map((i) => i.str).join(" ");
  assert.match(text, /Chrome 158 on macOS/);
  assert.doesNotMatch(text, /Mozilla\/5\.0/); // the short browser summary, not the raw string
  assert.match(text, /Signed 2026-11-20 23:19:09 UTC \/ Nov 20, 2026, 4:19:09 PM MST \(America\/Phoenix, Astra AI's time zone\)/);
  assert.match(text, /Countersigned automatically with Test Admin's saved signature \(authorized Nov 20, 2026\)(?! · IP)/);

  // Long logs: continued pages carry the header and never a single line. Sweep the sizes
  // where the break lands on every possible spot.
  for (let n = 1; n <= 90; n++) {
    const events = [...typicalEvents(), ...Array.from({ length: n }, (_, i) => ({ at: t(12), type: "recipient.viewed", actor: `Signer ${i}`, ip: "203.0.113.9", data: {} }))];
    const { pages, layout } = await build(events);
    assert.equal(layout.length, pages);
    layout.forEach((p, i) => {
      if (i > 0) assert.ok(p.items.some((x) => x.str === "Certificate of Completion (continued)"), `n=${n}: page ${i + 1} has the continued header`);
      assert.ok(contentLines(p) >= 2, `n=${n}: page ${i + 1} has ${contentLines(p)} line(s)`);
    });
    if (n === 90) assert.ok(pages >= 2);
  }
});

test("browser summary", () => {
  assert.equal(uaSummary(MAC_CHROME), "Chrome 158 on macOS");
  assert.equal(uaSummary("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), "Safari 18 on iOS");
  assert.equal(uaSummary("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"), "Edge 131 on Windows");
  assert.equal(uaSummary("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/159.0.0.0 Mobile Safari/537.36"), "Chrome 159 on Android");
  assert.equal(uaSummary("Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0"), "Firefox 133 on Linux");
  assert.equal(uaSummary(null), "not recorded");
  assert.equal(uaSummary("curl/8.4.0"), "unrecognized browser");
});
