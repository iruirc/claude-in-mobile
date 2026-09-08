import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeEnabledPlatforms } from "./platform-config.js";
import {
  writeEnabledToolPlugins,
} from "./tool-plugin-config.js";
import {
  applyToolPluginDisable,
  applyToolPluginEnable,
  runToolPluginCommand,
} from "./tool-plugin-cli.js";

describe("tool plugin selection", () => {
  it("enables and disables known plugins deterministically", () => {
    expect(applyToolPluginEnable([], ["debug", "debug"])).toEqual(["debug"]);
    expect(applyToolPluginDisable(["debug"], ["all"])).toEqual([]);
  });

  it("rejects unknown plugin names at the CLI boundary", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitCodes: number[] = [];
    const exit = ((code: number) => {
      exitCodes.push(code);
      return undefined as never;
    }) as (code: number) => never;
    try {
      runToolPluginCommand(
        ["node", "mcp-devices", "plugin", "enable", "unknown"],
        exit,
      );
      expect(exitCodes).toEqual([1]);
      expect(errors).toHaveBeenCalledWith(
        "Unknown tool plugin: unknown. Available: debug",
      );
    } finally {
      errors.mockRestore();
    }
  });
});

describe("shared runtime config persistence", () => {
  let directory: string;
  let path: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "mcp-devices-plugins-"));
    path = join(directory, "config.json");
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it("preserves platform, tool-plugin, and unknown settings across updates", () => {
    writeFileSync(path, JSON.stringify({ custom: true, tool_plugins: ["debug"] }));
    writeEnabledPlatforms(["harmony"], path);
    writeEnabledToolPlugins(["debug"], path);

    const config = JSON.parse(readFileSync(path, "utf-8"));
    expect(config).toEqual({
      custom: true,
      tool_plugins: ["debug"],
      platforms: ["harmony"],
    });
  });
});
