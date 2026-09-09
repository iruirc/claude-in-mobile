import type { HeapSnapshotSummary } from "mcp-devices/adapters/platform-adapter";

export function summarizeAndroidHeap(sizeBytes: number, meminfo: string): HeapSnapshotSummary {
  const totalPssKb = matchKilobytes(meminfo, /^\s*TOTAL\s+(\d+)\b/m)
    ?? matchKilobytes(meminfo, /TOTAL PSS:\s*(\d+)/);
  const nativeHeapKb = matchKilobytes(meminfo, /^\s*Native Heap\s+(\d+)\b/m);
  const dalvikHeapKb = matchKilobytes(meminfo, /^\s*Dalvik Heap\s+(\d+)\b/m);
  const warnings: string[] = [];
  if (totalPssKb === undefined) {
    warnings.push("Android meminfo did not expose TOTAL PSS; the HPROF artifact is still complete.");
  }
  return {
    sizeBytes,
    totalPssMb: megabytes(totalPssKb),
    nativeHeapMb: megabytes(nativeHeapKb),
    dalvikHeapMb: megabytes(dalvikHeapKb),
    warnings,
  };
}

function matchKilobytes(input: string, pattern: RegExp): number | undefined {
  const value = input.match(pattern)?.[1];
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function megabytes(kilobytes: number | undefined): number | undefined {
  return kilobytes === undefined ? undefined : Math.round((kilobytes / 1024) * 100) / 100;
}
