import { PERFORMANCE } from "../../constants/timeouts.js";
import { detectForegroundPackage } from "../../perf/collector.js";
import { PerformanceTraceManager } from "../../perf/trace-manager.js";
import { createLazySingleton } from "../../utils/lazy.js";
import { parseCommonArgs } from "../../utils/parse-common-args.js";
import { validateBundleId, validatePackageName } from "../../utils/sanitize.js";
import { jsonResult } from "../../utils/tool-result.js";
import { PerfCollectionError, ValidationError } from "../../errors.js";
import { defineTool, z } from "../define-tool.js";
import { deviceIdField } from "./common.js";

const tracePlatform = z
  .enum(["android", "ios", "browser"])
  .describe("Trace backend. Android uses Perfetto, iOS uses xctrace, and browser uses Chrome DevTools Protocol.")
  .optional();

const traceId = z
  .string()
  .describe("Trace ID returned by performance(action:'trace_start').");

const artifactId = z
  .string()
  .describe("Artifact ID returned by performance(action:'trace_stop').");

const getTraceManager = createLazySingleton(() => new PerformanceTraceManager());

export const performanceTraceStart = defineTool({
  name: "performance_trace_start",
  description:
    "Start a bounded native performance trace. Android records Perfetto, iOS records an Instruments xctrace bundle, and browser records Chrome tracing. Stop it to persist a private artifact and receive a compact summary.",
  schema: z.object({
    platform: tracePlatform,
    deviceId: deviceIdField,
    packageName: z
      .string()
      .optional()
      .describe("Android package name. Auto-detected from the foreground app when omitted."),
    bundleId: z
      .string()
      .optional()
      .describe("Running iOS app bundle ID. Required for iOS xctrace capture."),
    session: z
      .string()
      .optional()
      .describe("Browser session name (default: default)."),
    preset: z
      .enum(["ui-jank", "startup"])
      .default("ui-jank")
      .describe("Trace categories optimized for UI jank or app/page startup."),
    duration: z
      .number()
      .int()
      .min(1000)
      .max(PERFORMANCE.MAX_TRACE_DURATION_MS)
      .default(10_000)
      .describe(`Maximum trace window in milliseconds (1000-${PERFORMANCE.MAX_TRACE_DURATION_MS}).`),
  }),
  handler: async (args, ctx) => {
    const { deviceId, platform } = parseCommonArgs(args as Record<string, unknown>, ctx);
    if (platform !== "android" && platform !== "ios" && platform !== "browser") {
      throw new ValidationError(
        `performance_trace_start is supported for android, ios, and browser, not "${platform}".`,
      );
    }

    let packageName = args.packageName;
    if (platform === "android") {
      const adb = ctx.deviceManager.getAndroidClient(deviceId);
      packageName ??= detectForegroundPackage(adb);
      if (!packageName) {
        throw new PerfCollectionError(
          "android",
          "Could not detect foreground package. Provide packageName explicitly.",
        );
      }
      validatePackageName(packageName);
    }
    if (platform === "ios") {
      if (!args.bundleId) {
        throw new ValidationError("bundleId is required for iOS xctrace capture.");
      }
      validateBundleId(args.bundleId);
    }

    const handle = await getTraceManager().start(ctx.deviceManager, platform, {
      preset: args.preset,
      durationMs: args.duration,
      packageName,
      session: args.session,
      bundleId: args.bundleId,
      deviceId,
    });
    return jsonResult({
      status: "recording",
      ...handle,
      next: `performance(action:'trace_stop', traceId:'${handle.traceId}')`,
    });
  },
  errorCode: "PERF_TRACE_START_FAILED",
});

export const performanceTraceStop = defineTool({
  name: "performance_trace_stop",
  description:
    "Finalize an active performance trace, store the native artifact with mode 0600 and 24-hour TTL, and return a bounded agent-readable summary plus checksum.",
  schema: z.object({ traceId }),
  handler: async (args) => {
    const artifact = await getTraceManager().stop(args.traceId);
    return jsonResult({
      status: "captured",
      ...artifact,
      note: "The native trace may contain URLs, symbols, and process metadata. Treat the local artifact as sensitive.",
      deleteWith: `performance(action:'trace_delete', artifactId:'${artifact.artifactId}')`,
    });
  },
  errorCode: "PERF_TRACE_STOP_FAILED",
});

export const performanceTraceStatus = defineTool({
  name: "performance_trace_status",
  description: "List active performance traces and the remaining capture window.",
  schema: z.object({ traceId: traceId.optional() }),
  handler: async (args) => jsonResult({ traces: getTraceManager().status(args.traceId) }),
});

export const performanceTraceDelete = defineTool({
  name: "performance_trace_delete",
  description: "Delete a captured native performance trace artifact and its metadata.",
  schema: z.object({ artifactId }),
  handler: async (args) => {
    await getTraceManager().deleteArtifact(args.artifactId);
    return jsonResult({ status: "deleted", artifactId: args.artifactId });
  },
  errorCode: "PERF_TRACE_DELETE_FAILED",
});
