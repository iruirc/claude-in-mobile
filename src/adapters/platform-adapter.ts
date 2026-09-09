/**
 * Platform adapter interfaces -- segregated by capability (ISP).
 *
 * Instead of a single monolithic PlatformAdapter that forces Browser and
 * Desktop to throw "not supported" for mobile-only features, the contract
 * is split into focused interfaces:
 *
 *   CorePlatformAdapter   -- universal: every platform implements this
 *   AppManagementAdapter  -- launchApp / stopApp / installApp
 *   PermissionAdapter     -- grant / revoke / reset permissions
 *   ShellAdapter          -- shell / logs / clearLogs
 *
 * Each concrete adapter implements only the interfaces it actually supports.
 * Consumers use type guards (`hasAppManagement`, `hasPermissions`, etc.)
 * to narrow before calling capability-specific methods.
 *
 * The legacy `PlatformAdapter` type alias is preserved for backward
 * compatibility -- it is the intersection of all capability interfaces.
 */

import type { Platform, Device } from "../device-manager.js";
import type { CompressOptions } from "../utils/image.js";

// ============ Core -- every adapter MUST implement ============

export interface CorePlatformAdapter {
  /** Which platform this adapter serves. */
  readonly platform: Platform;

  // -- Device management --
  listDevices(): Device[];
  selectDevice(deviceId: string): void;
  getSelectedDeviceId(): string | undefined;
  autoDetectDevice(): Device | undefined;

  // -- Core interaction --
  tap(x: number, y: number, targetPid?: number, deviceId?: string): Promise<void>;
  doubleTap(x: number, y: number, intervalMs?: number, deviceId?: string): Promise<void>;
  longPress(x: number, y: number, durationMs?: number, deviceId?: string): Promise<void>;
  swipe(x1: number, y1: number, x2: number, y2: number, durationMs?: number, deviceId?: string): Promise<void>;
  swipeDirection(direction: "up" | "down" | "left" | "right", deviceId?: string): Promise<void>;
  inputText(text: string, targetPid?: number, deviceId?: string): Promise<void>;
  pressKey(key: string, targetPid?: number, deviceId?: string): Promise<void>;

  // -- Screenshot --
  screenshotAsync(
    compress: boolean,
    options?: CompressOptions & { monitorIndex?: number },
    deviceId?: string,
  ): Promise<{ data: string; mimeType: string }>;
  getScreenshotBufferAsync(deviceId?: string): Promise<Buffer>;

  // -- UI --
  getUiHierarchy(deviceId?: string, turbo?: boolean): Promise<string>;

  // -- System info --
  getSystemInfo(deviceId?: string): Promise<string>;
  /** Release long-lived resources owned by this adapter. Safe to call repeatedly. */
  dispose?(): void | Promise<void>;
}

// ============ App management capability ============

export interface AppManagementAdapter {
  launchApp(packageOrBundleId: string, deviceId?: string): string | Promise<string>;
  stopApp(packageOrBundleId: string, deviceId?: string): void;
  installApp(path: string, deviceId?: string): string;
}

// ============ App inventory capability ============

export interface AppInventoryAdapter {
  listApps(deviceId?: string): string[] | Promise<string[]>;
  uninstallApp(packageOrBundleId: string, deviceId?: string): string | Promise<string>;
}

// ============ Permission management capability ============

export interface PermissionAdapter {
  grantPermission(packageOrBundleId: string, permission: string, deviceId?: string): string;
  revokePermission(packageOrBundleId: string, permission: string, deviceId?: string): string;
  resetPermissions(packageOrBundleId: string, deviceId?: string): string;
}

// ============ Shell / logs capability ============

export interface ShellAdapter {
  shell(command: string, deviceId?: string): string;
  getLogs(options: {
    level?: string;
    tag?: string;
    lines?: number;
    package?: string;
  }, deviceId?: string): string;
  clearLogs(deviceId?: string): string;
}

// ============ File transfer capability ============

export interface FileTransferAdapter {
  pushFile(localPath: string, remotePath: string, deviceId?: string): string | Promise<string>;
  pullFile(remotePath: string, localPath?: string, deviceId?: string): string | Promise<string>;
}

// ============ URL opening capability ============

export interface UrlOpeningAdapter {
  openUrl(url: string, deviceId?: string): string | void | Promise<string | void>;
}

// ============ Legacy sync screenshot (Android / iOS / Aurora only) ============

export interface SyncScreenshotAdapter {
  screenshotRaw(): string;
}
// ============ Performance trace capability ============

export type PerformanceTracePreset = "ui-jank" | "startup";
export type PerformanceTraceFormat = "chrome-json" | "perfetto-proto" | "xctrace-zip";

export interface PerformanceTraceStartOptions {
  preset: PerformanceTracePreset;
  durationMs: number;
  packageName?: string;
  bundleId?: string;
  session?: string;
  deviceId?: string;
}

export interface PerformanceTraceHandle {
  traceId: string;
  platform: Platform;
  preset: PerformanceTracePreset;
  startedAt: string;
  deadlineAt: string;
}

export interface PerformanceTraceFrameStats {
  totalFrames: number;
  jankyFrames: number;
  jankyPercent: number;
  p50Ms?: number;
  p90Ms?: number;
  p95Ms?: number;
  p99Ms?: number;
}

export interface PerformanceTraceSummary {
  eventCount?: number;
  longTaskCount?: number;
  longestTaskMs?: number;
  totalLongTaskMs?: number;
  layoutCount?: number;
  paintCount?: number;
  scriptCount?: number;
  navigationCount?: number;
  frameStats?: PerformanceTraceFrameStats;
  sliceCount?: number;
  schedSliceCount?: number;
  cpuTimeMs?: number;
  jankSliceCount?: number;
  sampleCount?: number;
  instrumentCount?: number;
  analysisTool?: string;
  warnings: string[];
}

export interface PerformanceTraceCapture extends PerformanceTraceHandle {
  endedAt: string;
  durationMs: number;
  format: PerformanceTraceFormat;
  mimeType: string;
  producer: string;
  packageName?: string;
  session?: string;
  summary: PerformanceTraceSummary;
  data: Uint8Array;
}

export interface PerformanceTraceAdapter {
  startPerformanceTrace(options: PerformanceTraceStartOptions): Promise<PerformanceTraceHandle>;
  stopPerformanceTrace(traceId: string): Promise<PerformanceTraceCapture>;
}

export type HeapSnapshotFormat = "android-hprof" | "chrome-heapsnapshot" | "xctrace-allocations";

export interface HeapSnapshotOptions {
  outputPath: string;
  packageName?: string;
  bundleId?: string;
  session?: string;
  deviceId?: string;
}

export interface HeapSnapshotSummary {
  sizeBytes: number;
  nodeCount?: number;
  edgeCount?: number;
  traceFunctionCount?: number;
  totalPssMb?: number;
  nativeHeapMb?: number;
  dalvikHeapMb?: number;
  instrumentCount?: number;
  warnings: string[];
}

export interface HeapSnapshotCapture {
  platform: Platform;
  capturedAt: string;
  format: HeapSnapshotFormat;
  mimeType: string;
  producer: string;
  packageName?: string;
  session?: string;
  summary: HeapSnapshotSummary;
}

export interface HeapSnapshotAdapter {
  readonly heapSnapshotFormat: HeapSnapshotFormat;
  captureHeapSnapshot(options: HeapSnapshotOptions): Promise<HeapSnapshotCapture>;
}



// ============ Type guards ============

export function hasAppManagement(adapter: CorePlatformAdapter): adapter is CorePlatformAdapter & AppManagementAdapter {
  return (
    "launchApp" in adapter &&
    "stopApp" in adapter &&
    "installApp" in adapter
  );
}

export function hasAppInventory(adapter: CorePlatformAdapter): adapter is CorePlatformAdapter & AppInventoryAdapter {
  return "listApps" in adapter && "uninstallApp" in adapter;
}

export function hasPermissions(adapter: CorePlatformAdapter): adapter is CorePlatformAdapter & PermissionAdapter {
  return (
    "grantPermission" in adapter &&
    "revokePermission" in adapter &&
    "resetPermissions" in adapter
  );
}

export function hasShell(adapter: CorePlatformAdapter): adapter is CorePlatformAdapter & ShellAdapter {
  return (
    "shell" in adapter &&
    "getLogs" in adapter &&
    "clearLogs" in adapter
  );
}

export function hasFileTransfer(adapter: CorePlatformAdapter): adapter is CorePlatformAdapter & FileTransferAdapter {
  return "pushFile" in adapter && "pullFile" in adapter;
}

export function hasUrlOpening(adapter: CorePlatformAdapter): adapter is CorePlatformAdapter & UrlOpeningAdapter {
  return "openUrl" in adapter;
}

export function hasSyncScreenshot(adapter: CorePlatformAdapter): adapter is CorePlatformAdapter & SyncScreenshotAdapter {
  return "screenshotRaw" in adapter;
}

export function hasPerformanceTrace(adapter: CorePlatformAdapter): adapter is CorePlatformAdapter & PerformanceTraceAdapter {
  return (
    "startPerformanceTrace" in adapter &&
    "stopPerformanceTrace" in adapter
  );
}

export function hasHeapSnapshot(adapter: CorePlatformAdapter): adapter is CorePlatformAdapter & HeapSnapshotAdapter {
  return (
    "heapSnapshotFormat" in adapter &&
    "captureHeapSnapshot" in adapter
  );
}


// ============ Capability requirement helpers ============

export class CapabilityNotSupportedError extends Error {
  constructor(public readonly platform: Platform, public readonly capability: string) {
    super(`Capability '${capability}' is not supported on platform '${platform}'.`);
    this.name = "CapabilityNotSupportedError";
  }
}

export function requireAppManagement(
  adapter: CorePlatformAdapter,
): CorePlatformAdapter & AppManagementAdapter {
  if (!hasAppManagement(adapter)) {
    throw new CapabilityNotSupportedError(adapter.platform, "AppManagement");
  }
  return adapter;
}

export function requireAppInventory(
  adapter: CorePlatformAdapter,
): CorePlatformAdapter & AppInventoryAdapter {
  if (!hasAppInventory(adapter)) {
    throw new CapabilityNotSupportedError(adapter.platform, "AppInventory");
  }
  return adapter;
}

export function requirePermissions(
  adapter: CorePlatformAdapter,
): CorePlatformAdapter & PermissionAdapter {
  if (!hasPermissions(adapter)) {
    throw new CapabilityNotSupportedError(adapter.platform, "Permissions");
  }
  return adapter;
}

export function requireShell(
  adapter: CorePlatformAdapter,
): CorePlatformAdapter & ShellAdapter {
  if (!hasShell(adapter)) {
    throw new CapabilityNotSupportedError(adapter.platform, "Shell");
  }
  return adapter;
}

export function requireFileTransfer(
  adapter: CorePlatformAdapter,
): CorePlatformAdapter & FileTransferAdapter {
  if (!hasFileTransfer(adapter)) {
    throw new CapabilityNotSupportedError(adapter.platform, "FileTransfer");
  }
  return adapter;
}

export function requireUrlOpening(
  adapter: CorePlatformAdapter,
): CorePlatformAdapter & UrlOpeningAdapter {
  if (!hasUrlOpening(adapter)) {
    throw new CapabilityNotSupportedError(adapter.platform, "UrlOpening");
  }
  return adapter;
}

export function requirePerformanceTrace(
  adapter: CorePlatformAdapter,
): CorePlatformAdapter & PerformanceTraceAdapter {
  if (!hasPerformanceTrace(adapter)) {
    throw new CapabilityNotSupportedError(adapter.platform, "PerformanceTrace");
  }
  return adapter;
}

export function requireHeapSnapshot(
  adapter: CorePlatformAdapter,
): CorePlatformAdapter & HeapSnapshotAdapter {
  if (!hasHeapSnapshot(adapter)) {
    throw new CapabilityNotSupportedError(adapter.platform, "HeapSnapshot");
  }
  return adapter;
}

// ============ Backward-compatible union ============

/**
 * Legacy full interface -- the intersection of ALL capabilities.
 *
 * Existing code that imports `PlatformAdapter` still compiles, but new
 * code should prefer `CorePlatformAdapter` and narrow with type guards.
 *
 * @deprecated Prefer `CorePlatformAdapter` with capability type guards.
 */
export type PlatformAdapter =
  CorePlatformAdapter &
  AppManagementAdapter &
  AppInventoryAdapter &
  PermissionAdapter &
  ShellAdapter &
  FileTransferAdapter &
  UrlOpeningAdapter &
  SyncScreenshotAdapter;
