import { createWriteStream } from "fs";
import { chmod, open, stat } from "fs/promises";
import { finished } from "stream/promises";

import type { HeapSnapshotSummary } from "mcp-devices/adapters/platform-adapter";

import type { CDPClientInterface } from "./cdp-types.js";

const MAX_HEAP_BYTES = 128 * 1024 * 1024;
const HEADER_BYTES = 256 * 1024;

export async function captureCdpHeapSnapshot(
  cdp: CDPClientInterface,
  outputPath: string,
): Promise<HeapSnapshotSummary> {
  const writer = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  await waitForOpen(writer);
  let sizeBytes = 0;
  let overflow = false;
  let writeError: Error | undefined;
  writer.on("error", (error) => { writeError = error; });

  const onChunk = ({ chunk }: { chunk: string }) => {
    if (overflow || writeError) return;
    const bytes = Buffer.byteLength(chunk, "utf8");
    sizeBytes += bytes;
    if (sizeBytes > MAX_HEAP_BYTES) {
      overflow = true;
      return;
    }
    writer.write(chunk, "utf8");
  };

  await cdp.HeapProfiler.enable();
  cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  try {
    await cdp.HeapProfiler.takeHeapSnapshot({
      reportProgress: false,
      captureNumericValue: true,
      exposeInternals: false,
    });
  } finally {
    cdp.removeListener("HeapProfiler.addHeapSnapshotChunk", onChunk);
    await cdp.HeapProfiler.disable().catch(() => {});
    writer.end();
  }
  await finished(writer);
  if (writeError) throw writeError;
  if (overflow) {
    throw new Error(`Chrome heap snapshot exceeded ${MAX_HEAP_BYTES / 1024 / 1024}MB and was discarded.`);
  }
  if (sizeBytes === 0) throw new Error("Chrome returned an empty heap snapshot.");

  await chmod(outputPath, 0o600);
  const details = await stat(outputPath);
  const header = await readHeader(outputPath, Math.min(HEADER_BYTES, details.size));
  if (!header.trimStart().startsWith("{")) {
    throw new Error("Chrome returned an invalid heap snapshot document.");
  }
  return {
    sizeBytes: details.size,
    nodeCount: integerField(header, "node_count"),
    edgeCount: integerField(header, "edge_count"),
    traceFunctionCount: integerField(header, "trace_function_count"),
    warnings: [],
  };
}

async function waitForOpen(writer: ReturnType<typeof createWriteStream>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    writer.once("open", () => resolve());
    writer.once("error", reject);
  });
}

async function readHeader(path: string, length: number): Promise<string> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}

function integerField(header: string, name: string): number | undefined {
  const raw = header.match(new RegExp(`"${name}"\\s*:\\s*(\\d+)`))?.[1];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}
