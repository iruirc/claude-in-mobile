import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface RuntimeConfigFile {
  platforms?: unknown;
  tool_plugins?: unknown;
  [key: string]: unknown;
}

export function runtimeConfigPath(): string {
  return join(homedir(), ".mcp-devices", "config.json");
}

export function readRuntimeConfig(path = runtimeConfigPath()): RuntimeConfigFile {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as RuntimeConfigFile;
    }
  } catch {
    // Missing or malformed config starts from an empty object.
  }
  return {};
}

export function updateRuntimeConfig(
  patch: Partial<RuntimeConfigFile>,
  path = runtimeConfigPath(),
): void {
  const config = { ...readRuntimeConfig(path), ...patch };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}
