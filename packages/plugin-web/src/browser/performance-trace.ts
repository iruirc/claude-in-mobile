import type {
  PerformanceTracePreset,
  PerformanceTraceSummary,
} from "mcp-devices/adapters/platform-adapter";

import type { CDPClientInterface } from "./cdp-types.js";

const MAX_TRACE_BYTES = 32 * 1024 * 1024;
const STREAM_CHUNK_BYTES = 1024 * 1024;
const TRACE_COMPLETE_TIMEOUT_MS = 10_000;
const LONG_TASK_US = 50_000;

const BASE_CATEGORIES = [
  "devtools.timeline",
  "toplevel",
  "blink.user_timing",
  "loading",
  "rail",
  "disabled-by-default-devtools.timeline",
];

const STARTUP_CATEGORIES = [
  ...BASE_CATEGORIES,
  "navigation",
  "v8",
];

interface ChromeTraceEvent {
  name?: unknown;
  ph?: unknown;
  dur?: unknown;
}

interface ChromeTraceDocument {
  traceEvents?: unknown;
}

export async function startCdpPerformanceTrace(
  cdp: CDPClientInterface,
  preset: PerformanceTracePreset,
): Promise<void> {
  const categories = preset === "startup" ? STARTUP_CATEGORIES : BASE_CATEGORIES;
  await cdp.Tracing.start({
    categories: categories.join(","),
    transferMode: "ReturnAsStream",
  });
}

export async function stopCdpPerformanceTrace(
  cdp: CDPClientInterface,
): Promise<{ data: Buffer; summary: PerformanceTraceSummary }> {
  const complete = withTimeout(
    cdp.Tracing.tracingComplete(),
    TRACE_COMPLETE_TIMEOUT_MS,
    "Chrome did not finalize the performance trace",
  );
  await cdp.Tracing.end();
  const completed = await complete;
  if (!completed.stream) {
    throw new Error("Chrome finalized the trace without an IO stream handle.");
  }

  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await cdp.IO.read({
        handle: completed.stream,
        size: STREAM_CHUNK_BYTES,
      });
      const bytes = Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8");
      size += bytes.length;
      if (size > MAX_TRACE_BYTES) {
        throw new Error(
          `Chrome performance trace exceeded ${MAX_TRACE_BYTES / 1024 / 1024}MB and was discarded.`,
        );
      }
      chunks.push(bytes);
      if (chunk.eof) break;
    }
  } finally {
    await cdp.IO.close({ handle: completed.stream }).catch(() => {});
  }

  const data = Buffer.concat(chunks, size);
  const summary = summarizeChromeTrace(data);
  if (completed.dataLossOccurred) {
    summary.warnings.push("Chrome reported trace data loss; summary may be incomplete.");
  }
  return { data, summary };
}

export function summarizeChromeTrace(data: Uint8Array): PerformanceTraceSummary {
  let parsed: ChromeTraceDocument;
  try {
    parsed = JSON.parse(Buffer.from(data).toString("utf8")) as ChromeTraceDocument;
  } catch {
    throw new Error("Chrome returned an invalid JSON performance trace.");
  }
  if (!Array.isArray(parsed.traceEvents)) {
    throw new Error("Chrome performance trace does not contain a traceEvents array.");
  }

  let longTaskCount = 0;
  let longestTaskUs = 0;
  let totalLongTaskUs = 0;
  let layoutCount = 0;
  let paintCount = 0;
  let scriptCount = 0;
  let navigationCount = 0;

  for (const raw of parsed.traceEvents) {
    if (!raw || typeof raw !== "object") continue;
    const event = raw as ChromeTraceEvent;
    const name = typeof event.name === "string" ? event.name : "";
    const durationUs = typeof event.dur === "number" && Number.isFinite(event.dur)
      ? event.dur
      : 0;

    if (
      event.ph === "X"
      && durationUs >= LONG_TASK_US
      && (name === "RunTask" || name.endsWith("::RunTask"))
    ) {
      longTaskCount += 1;
      totalLongTaskUs += durationUs;
      longestTaskUs = Math.max(longestTaskUs, durationUs);
    }
    if (name === "Layout" || name === "UpdateLayoutTree") layoutCount += 1;
    if (name === "Paint" || name === "PaintImage" || name === "RasterTask") paintCount += 1;
    if (name === "EvaluateScript" || name === "FunctionCall" || name === "RunMicrotasks") scriptCount += 1;
    if (name === "navigationStart" || name === "firstContentfulPaint" || name === "largestContentfulPaint::Candidate") {
      navigationCount += 1;
    }
  }

  return {
    eventCount: parsed.traceEvents.length,
    longTaskCount,
    longestTaskMs: roundMs(longestTaskUs),
    totalLongTaskMs: roundMs(totalLongTaskUs),
    layoutCount,
    paintCount,
    scriptCount,
    navigationCount,
    warnings: [],
  };
}

function roundMs(microseconds: number): number {
  return Math.round((microseconds / 1000) * 10) / 10;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${message} within ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
