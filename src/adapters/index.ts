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
} from "./platform-adapter.js";

// Concrete adapters
// AuroraAdapter moved to @mcp-devices/plugin-aurora (4.0.0 physical split).
