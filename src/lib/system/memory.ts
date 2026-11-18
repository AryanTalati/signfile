import "server-only";
import { readFile } from "node:fs/promises";

export interface MemorySample {
  /** Bytes in use. */
  bytes: number;
  /** Where the number came from: the container's cgroup (includes child processes like LibreOffice) or just this Node process. */
  source: "cgroup" | "process";
}

const CGROUP_V2_CURRENT = "/sys/fs/cgroup/memory.current";
const CGROUP_V1_USAGE = "/sys/fs/cgroup/memory/memory.usage_in_bytes";

async function readNumber(file: string): Promise<number | null> {
  try {
    const raw = (await readFile(file, "utf8")).trim();
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Current memory use of the whole container if we can see it, else this process's RSS. */
export async function sampleMemory(): Promise<MemorySample> {
  const cg = (await readNumber(CGROUP_V2_CURRENT)) ?? (await readNumber(CGROUP_V1_USAGE));
  if (cg !== null) return { bytes: cg, source: "cgroup" };
  return { bytes: process.memoryUsage().rss, source: "process" };
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
