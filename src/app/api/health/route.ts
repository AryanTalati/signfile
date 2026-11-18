import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { pingDatabase } from "@/lib/db/ping";
import { convertToPdf, ConversionError } from "@/lib/pdf/convert";
import { storageSelfTest } from "@/lib/storage";
import { mb, memoryReport } from "@/lib/system/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/health          light: DB `select 1` + memory. Hit every 10 min by
 *                          an uptime pinger so Render and Supabase stay awake.
 * GET /api/health?deep=1   also round-trips a storage object, converts a realistic multi-page DOCX with
 *                          LibreOffice and reports duration + peak memory.
 *                          Single-flight and cached for 60s so it can't be
 *                          used to pin the CPU.
 */
export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get("deep") === "1";
  const [db, memory] = await Promise.all([pingDatabase(), memoryReport()]);

  const body: Record<string, unknown> = {
    ok: db.ok || !db.configured,
    service: "signfile",
    commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null,
    uptimeSec: Math.round(process.uptime()),
    db,
    memory,
  };

  if (deep) {
    const [conversion, storage] = await Promise.all([
      deepCheck(),
      storageSelfTest().catch((e: Error) => ({ ok: false, error: e.message })),
    ]);
    body.conversion = conversion;
    body.storage = storage;
    if (!conversion.ok || !storage.ok) body.ok = false;
  }

  return Response.json(body, {
    status: body.ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}

type DeepResult = Record<string, unknown> & { ok: boolean };
let inflight: Promise<DeepResult> | null = null;
let cached: { at: number; result: DeepResult } | null = null;

function deepCheck(): Promise<DeepResult> {
  if (cached && Date.now() - cached.at < 60_000) return Promise.resolve({ ...cached.result, cached: true });
  inflight ??= runConversion()
    .then((result) => {
      cached = { at: Date.now(), result };
      return result;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

async function runConversion(): Promise<DeepResult> {
  try {
    const docx = await readFile(path.join(process.cwd(), "fixtures/health/sample-agreement.docx"));
    const { pdf, durationMs, peakMemory } = await convertToPdf(docx, "docx");
    const pages = (await PDFDocument.load(pdf)).getPageCount();
    return {
      ok: pages > 1,
      fixture: "sample-agreement.docx",
      inputKb: Math.round(docx.length / 1024),
      outputKb: Math.round(pdf.length / 1024),
      pages,
      durationMs,
      peakMemoryMb: mb(peakMemory.bytes),
      peakMemorySource: peakMemory.source,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      detail: err instanceof ConversionError ? err.detail?.slice(0, 500) : undefined,
    };
  }
}
