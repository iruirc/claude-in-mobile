import { detectForegroundPackage } from "../../perf/collector.js";
import { HeapSnapshotManager } from "../../perf/heap-manager.js";
import { PerfCollectionError, ValidationError } from "../../errors.js";
import { createLazySingleton } from "../../utils/lazy.js";
import { parseCommonArgs } from "../../utils/parse-common-args.js";
import { validateBundleId, validatePackageName } from "../../utils/sanitize.js";
import { jsonResult } from "../../utils/tool-result.js";
import { defineTool, z } from "../define-tool.js";
import { deviceIdField } from "./common.js";

const heapPlatform = z
  .enum(["android", "ios", "browser"])
  .describe("Heap backend. Android captures HPROF, iOS records Instruments Allocations, and browser captures Chrome .heapsnapshot.")
  .optional();

const artifactId = z.string().describe("Heap artifact ID returned by performance(action:'heap_capture').");
const getHeapManager = createLazySingleton(() => new HeapSnapshotManager());

export const performanceHeapCapture = defineTool({
  name: "performance_heap_capture",
  description:
    "Capture a private heap artifact without returning raw heap contents through MCP. Android requires a debuggable package, iOS requires a running Simulator app, and browser uses the active CDP session.",
  schema: z.object({
    platform: heapPlatform,
    deviceId: deviceIdField,
    packageName: z
      .string()
      .optional()
      .describe("Android package name. Auto-detected from the foreground app when omitted."),
    bundleId: z
      .string()
      .optional()
      .describe("Running iOS Simulator app bundle ID. Required for iOS Allocations capture."),
    session: z
      .string()
      .optional()
      .describe("Browser session name, or an optional comparison label. iOS defaults it to bundleId."),
  }),
  handler: async (args, ctx) => {
    const { deviceId, platform } = parseCommonArgs(args as Record<string, unknown>, ctx);
    if (platform !== "android" && platform !== "ios" && platform !== "browser") {
      throw new ValidationError(`performance_heap_capture is supported for android, ios, and browser, not "${platform}".`);
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
      if (!args.bundleId) throw new ValidationError("bundleId is required for iOS Allocations capture.");
      validateBundleId(args.bundleId);
    }
    const artifact = await getHeapManager().capture(ctx.deviceManager, platform, {
      deviceId,
      packageName,
      bundleId: args.bundleId,
      session: args.session,
    });
    return jsonResult({
      status: "captured",
      ...artifact,
      note: "Heap artifacts can contain credentials, user data, and in-memory tokens. The local file is mode 0600 and expires after 24 hours; do not attach it to untrusted reports.",
      compareWith: `performance(action:'heap_diff', beforeArtifactId:'${artifact.artifactId}', afterArtifactId:'<later-artifact-id>')`,
      deleteWith: `performance(action:'heap_delete', artifactId:'${artifact.artifactId}')`,
    });
  },
  errorCode: "HEAP_CAPTURE_FAILED",
});

export const performanceHeapDiff = defineTool({
  name: "performance_heap_diff",
  description:
    "Compare bounded metadata from two compatible heap artifacts. Returns signed size/count deltas; it does not claim that growth is a memory leak.",
  schema: z.object({
    beforeArtifactId: artifactId,
    afterArtifactId: artifactId,
  }),
  handler: async (args) => jsonResult({
    status: "compared",
    ...await getHeapManager().compare(args.beforeArtifactId, args.afterArtifactId),
    note: "Positive growth is a diagnostic signal, not proof of a leak. Reproduce across repeated equivalent workloads before drawing conclusions.",
  }),
  errorCode: "HEAP_DIFF_FAILED",
});

export const performanceHeapDelete = defineTool({
  name: "performance_heap_delete",
  description: "Delete a captured heap artifact and its metadata immediately.",
  schema: z.object({ artifactId }),
  handler: async (args) => {
    await getHeapManager().deleteArtifact(args.artifactId);
    return jsonResult({ status: "deleted", artifactId: args.artifactId });
  },
  errorCode: "HEAP_DELETE_FAILED",
});
