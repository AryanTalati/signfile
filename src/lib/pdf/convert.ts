import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sampleMemory, type MemorySample } from "@/lib/system/memory";

/** Max time a single DOCX->PDF conversion may take before it is killed. */
const CONVERT_TIMEOUT_MS = 90_000;

export class ConversionError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
    this.name = "ConversionError";
  }
}

// One conversion at a time: LibreOffice peaks at a few hundred MB and the
// Render free instance has 512 MB. Uploads queue instead of crashing the box.
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** SOFFICE_PATH if it exists on this machine, else `soffice` on PATH (a stale macOS path must not break Docker). */
export function sofficeBinary(): string {
  const p = process.env.SOFFICE_PATH;
  return p && existsSync(p) ? p : "soffice";
}

export interface ConversionResult {
  pdf: Buffer;
  durationMs: number;
  /** Peak memory seen while LibreOffice ran (container-level when available). */
  peakMemory: MemorySample;
}

/**
 * Converts a DOCX (or other office doc) to PDF with headless LibreOffice.
 *
 * Runs share one LibreOffice user profile: initializing a fresh profile costs
 * ~30% of a conversion on Render's 0.1 CPU. Sharing is safe because runs are
 * serialized. The Docker image pre-builds the profile (LO_PROFILE_DIR) so the
 * first conversion after a deploy is fast too. If a run fails, the profile is
 * deleted so a corrupted profile can't break later runs.
 */
export function convertToPdf(input: Buffer, ext = "docx"): Promise<ConversionResult> {
  return serialize(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "convert-"));
    const src = path.join(dir, `input.${ext.replace(/[^a-z0-9]/gi, "")}`);
    const profile = profileDir();
    let failed = true;
    try {
      await writeFile(src, input);
      const started = Date.now();
      let peak = await sampleMemory();
      const sampler = setInterval(async () => {
        const s = await sampleMemory();
        if (s.bytes > peak.bytes) peak = s;
      }, 100);

      try {
        await runSoffice([
          `-env:UserInstallation=file://${profile}`,
          "--headless",
          "--norestore",
          "--nolockcheck",
          "--convert-to",
          "pdf",
          "--outdir",
          dir,
          src,
        ]);
      } finally {
        clearInterval(sampler);
      }
      const final = await sampleMemory();
      if (final.bytes > peak.bytes) peak = final;

      const pdf = await readFile(path.join(dir, "input.pdf")).catch(() => {
        throw new ConversionError("LibreOffice finished but produced no PDF. The document may be corrupt or password-protected.");
      });
      failed = false;
      return { pdf, durationMs: Date.now() - started, peakMemory: peak };
    } finally {
      await rm(dir, { recursive: true, force: true });
      // Best effort; never mask the original conversion error.
      if (failed) await rm(path.join(profile, "user"), { recursive: true, force: true }).catch(() => undefined);
    }
  });
}

function profileDir() {
  return process.env.LO_PROFILE_DIR || path.join(tmpdir(), "signfile-lo-profile");
}

function runSoffice(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(sofficeBinary(), args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      // Kill the whole process group (soffice forks soffice.bin).
      try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      reject(new ConversionError("Document conversion timed out.", stderr));
    }, CONVERT_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new ConversionError(`Could not start LibreOffice (${sofficeBinary()}).`, err.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new ConversionError(`LibreOffice exited with code ${code}.`, stderr));
    });
  });
}
