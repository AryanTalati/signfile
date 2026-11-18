import "server-only";
import { readFile } from "node:fs/promises";

export interface MemorySample {
  /** Bytes in use. */
  bytes: number;
  /** Where the number came from: the container's cgroup (includes child processes like LibreOffice) or just this Node process. */
  source: "cgroup" | "process";
}

async function readNumber(file: string): Promise<number | null> {
  try {
    const raw = (await readFile(file, "utf8")).trim();
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Non-reclaimable memory of the whole container (all processes, incl.
 * LibreOffice): anonymous memory + shared memory + kernel memory, from
 * memory.stat. memory.current is NOT used: it includes page cache, which the
 * kernel drops under pressure, so it drifts up to the limit without any risk
 * of an OOM kill. Falls back to this process's RSS outside a container.
 */
export async function sampleMemory(): Promise<MemorySample> {
  const stat = await readStat("/sys/fs/cgroup/memory.stat");
  if (stat) {
    const bytes = (stat.anon ?? 0) + (stat.shmem ?? 0) + (stat.kernel ?? (stat.kernel_stack ?? 0) + (stat.slab_unreclaimable ?? 0));
    if (bytes > 0) return { bytes, source: "cgroup" };
  }
  const v1 = await readStat("/sys/fs/cgroup/memory/memory.stat");
  if (v1?.total_rss !== undefined) return { bytes: v1.total_rss + (v1.total_shmem ?? 0), source: "cgroup" };
  return { bytes: process.memoryUsage().rss, source: "process" };
}

async function readStat(file: string): Promise<Record<string, number> | null> {
  try {
    const out: Record<string, number> = {};
    for (const line of (await readFile(file, "utf8")).split("\n")) {
      const [k, v] = line.split(" ");
      if (k && v) out[k] = Number(v);
    }
    return out;
  } catch {
    return null;
  }
}

/** Container memory limit in bytes, or null if unlimited/unknown. */
export async function memoryLimit(): Promise<number | null> {
  try {
    const raw = (await readFile("/sys/fs/cgroup/memory.max", "utf8")).trim();
    if (raw !== "max") return Number(raw);
  } catch {}
  const v1 = await readNumber("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  // cgroup v1 reports a huge number when unlimited.
  return v1 !== null && v1 < 2 ** 60 ? v1 : null;
}

export async function memoryReport() {
  const mu = process.memoryUsage();
  const container = await sampleMemory();
  const limit = await memoryLimit();
  return {
    processRssMb: mb(mu.rss),
    heapUsedMb: mb(mu.heapUsed),
    heapTotalMb: mb(mu.heapTotal),
    containerMb: container.source === "cgroup" ? mb(container.bytes) : null,
    containerLimitMb: limit ? mb(limit) : null,
  };
}

export const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;
