/**
 * KernelDeviceLocator -- bridge from microkernel plugin registry to the
 * legacy CorePlatformAdapter map used by DeviceManager.
 *
 * Extracted from device-manager.ts (D9.1). The structural KernelHandleView
 * type lives here so device-manager doesn't have to know about plugins/**
 * (preserves ADR 0001 layering: the facade must not statically depend on
 * plugin modules).
 */

import type { CorePlatformAdapter } from "../adapters/platform-adapter.js";
import type { Platform } from "../platform-types.js";

/**
 * Structural view of the microkernel handle used by `DeviceManager.fromKernel`.
 * Defined structurally so device-manager.ts does NOT import from `plugins/**`
 * -- preserves the layering rule from ADR 0001 (plugins must not import the
 * legacy facade, and the facade must not statically depend on plugin modules).
 */
export interface KernelHandleView {
  registry: {
    list(): readonly {
      state: string;
      plugin: {
        manifest: { id: string };
        adapter?: CorePlatformAdapter;
      };
    }[];
  };
}

/**
 * Collect adapters from a kernel handle into a Platform→adapter map.
 *
 * Plugins that expose an `adapter` field contribute one adapter under the
 * adapter's platform id. Plugin ids may name the delivery package instead
 * (`web`) while the public platform remains `browser`.
 */
export function adaptersFromKernel(
  handle: KernelHandleView,
): Map<Platform, CorePlatformAdapter> {
  const adapters = new Map<Platform, CorePlatformAdapter>();
  for (const entry of handle.registry.list()) {
    const adapter = entry.plugin.adapter;
    if (entry.state === "active" && adapter) {
      adapters.set(adapter.platform, adapter);
    }
  }
  return adapters;
}
