/**
 * Tool-plugin enablement config — which tool plugins the kernel loads.
 *
 * Mirrors the pattern of platform-config.ts / resolveEnabledPlatforms().
 *
 * Resolution order (first wins):
 *   1. `MCP_DEVICES_TOOL_PLUGINS` env (csv, e.g. "debug" or "debug,profiler")
 *   2. `~/.mcp-devices/config.json` → `{ "tool_plugins": [...] }`
 *   3. default: empty set (tool plugins are opt-in; debug is off by default)
 *
 * Tool plugins are NOT platform plugins — they do not appear in ALL_PLATFORMS /
 * PlatformId. A missing package degrades gracefully (plugin unavailable, no crash).
 */

import {
  readRuntimeConfig,
  runtimeConfigPath,
  updateRuntimeConfig,
} from "./config-file.js";

/** Well-known tool plugin identifiers. Extend as new tool plugins ship. */
export const ALL_TOOL_PLUGINS = ["debug"] as const;
export type ToolPluginId = (typeof ALL_TOOL_PLUGINS)[number];

export function isToolPluginId(value: string): value is ToolPluginId {
  return (ALL_TOOL_PLUGINS as readonly string[]).includes(value);
}

export function toolPluginConfigPath(): string {
  return runtimeConfigPath();
}

/** Parse a csv tool-plugin spec into a deduped, valid list. */
export function parseToolPluginList(raw: string): ToolPluginId[] {
  const t = raw.trim().toLowerCase();
  if (t === "" || t === "none") return [];
  if (t === "all") return [...ALL_TOOL_PLUGINS];
  const out = new Set<ToolPluginId>();
  for (const part of t.split(",")) {
    const p = part.trim();
    if (isToolPluginId(p)) out.add(p);
  }
  return [...out];
}

function readConfigToolPlugins(
  path = toolPluginConfigPath(),
): ToolPluginId[] | undefined {
  const plugins = readRuntimeConfig(path).tool_plugins;
  if (!Array.isArray(plugins)) return undefined;
  return plugins.filter(
    (value): value is ToolPluginId =>
      typeof value === "string" && isToolPluginId(value),
  );
}

/**
 * Resolve the enabled tool-plugin set per the documented precedence.
 * Default is empty — tool plugins are opt-in.
 */
export function resolveEnabledToolPlugins(): ToolPluginId[] {
  const env = process.env["MCP_DEVICES_TOOL_PLUGINS"];
  if (env !== undefined) return parseToolPluginList(env);
  const fromConfig = readConfigToolPlugins();
  if (fromConfig !== undefined) return fromConfig;
  return [];
}

export function writeEnabledToolPlugins(
  plugins: readonly ToolPluginId[],
  path = toolPluginConfigPath(),
): void {
  const deduped = [...new Set(plugins)].filter(isToolPluginId);
  updateRuntimeConfig({ tool_plugins: deduped }, path);
}
