// Segregated interfaces
export type {
  CorePlatformAdapter,
  AppManagementAdapter,
  AppInventoryAdapter,
  PermissionAdapter,
  ShellAdapter,
  FileTransferAdapter,
  UrlOpeningAdapter,
  SyncScreenshotAdapter,
  PerformanceTraceAdapter,
  PerformanceTraceStartOptions,
  PerformanceTraceHandle,
  PerformanceTraceCapture,
  PerformanceTraceSummary,
  PerformanceTraceFrameStats,
  PerformanceTracePreset,
  PerformanceTraceFormat,
  HeapSnapshotAdapter,
  HeapSnapshotOptions,
  HeapSnapshotCapture,
  HeapSnapshotSummary,
  HeapSnapshotFormat,
  PlatformAdapter,
} from "./platform-adapter.js";

// Type guards
export {
  hasAppManagement,
  hasAppInventory,
  hasPermissions,
  hasShell,
  hasFileTransfer,
  hasUrlOpening,
  hasSyncScreenshot,
  hasPerformanceTrace,
  requirePerformanceTrace,
  hasHeapSnapshot,
  requireHeapSnapshot,
} from "./platform-adapter.js";

// Concrete adapters
// AuroraAdapter moved to @mcp-devices/plugin-aurora (4.0.0 physical split).
