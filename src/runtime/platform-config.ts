/**
 * Platform enablement config — which platform plugins the kernel loads.
 *
 * Resolution order (first wins):
 *   1. `MCP_DEVICES_PLATFORMS` env (csv, or `all` / `none`)
 *   2. `~/.mcp-devices/config.json` → `{ "platforms": [...] }`
 *   3. default: none (base is slim; platforms are opt-in / installed on demand)
 *
 * The `install` CLI writes the config file; the bootstrap reads it. Keeping the
 * default empty is what makes "base package, deliver platforms on demand" work.
 */

import {
  readRuntimeConfig,
  runtimeConfigPath,
  updateRuntimeConfig,
} from "./config-file.js";

export const ALL_PLATFORMS = [
  "android",
  "ios",
  "web",
  "desktop",
  "aurora",
  "harmony",
] as const;

export type PlatformId = (typeof ALL_PLATFORMS)[number];

export function configPath(): string {
  return runtimeConfigPath();
}

function isPlatformId(s: string): s is PlatformId {
  return (ALL_PLATFORMS as readonly string[]).includes(s);
}

/** Parse a csv / `all` / `none` platform spec into a deduped, valid list. */
export function parsePlatformList(raw: string): PlatformId[] {
  const t = raw.trim().toLowerCase();
  if (t === "" || t === "none") return [];
  if (t === "all") return [...ALL_PLATFORMS];
  const out = new Set<PlatformId>();
  for (const part of t.split(",")) {
    const p = part.trim();
    if (isPlatformId(p)) out.add(p);
  }
  return [...out];
}

function readConfigPlatforms(path = configPath()): PlatformId[] | undefined {
  const platforms = readRuntimeConfig(path).platforms;
  if (!Array.isArray(platforms)) return undefined;
  return platforms.filter(
    (value): value is PlatformId =>
      typeof value === "string" && isPlatformId(value),
  );
}

/** Resolve the enabled platform set per the documented precedence. */
export function resolveEnabledPlatforms(): PlatformId[] {
  const env = process.env.MCP_DEVICES_PLATFORMS;
  if (env !== undefined) return parsePlatformList(env);
  const fromConfig = readConfigPlatforms();
  if (fromConfig) return fromConfig;
  return [];
}

/** Persist the enabled platform set (used by `mcp-devices install`). */
export function writeEnabledPlatforms(
  platforms: readonly PlatformId[],
  path = configPath()
): void {
  const deduped = [...new Set(platforms)].filter(isPlatformId);
  updateRuntimeConfig({ platforms: deduped }, path);
}
