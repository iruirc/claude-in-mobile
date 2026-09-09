import { describe, expect, it } from "vitest";

import { runPluginContract } from "../contract-suite.js";
import { REPL_PLUGIN_MANIFEST, createReplPlugin } from "./index.js";
import { ReplBridgeClient } from "./client.js";

class FakeBridge extends ReplBridgeClient {
  async start(): Promise<void> {}
  async call<T>(): Promise<T> {
    return null as T;
  }
  async dispose(): Promise<void> {}
}

runPluginContract(() => createReplPlugin({ bridge: new FakeBridge() }));

describe("ReplPlugin manifest specifics", () => {
  it("declares terminal capability (REPL is the only terminal source)", () => {
    expect(REPL_PLUGIN_MANIFEST.capabilities).toContain("terminal");
  });

  it("does NOT declare screen capability (terminal grid is not a UI screenshot)", () => {
    expect(REPL_PLUGIN_MANIFEST.capabilities).not.toContain("screen");
  });

  it("registers all 8 MCP tools in manifest.tools", () => {
    expect(REPL_PLUGIN_MANIFEST.tools).toEqual([
      "repl_spawn",
      "repl_send",
      "repl_key",
      "repl_expect",
      "repl_snapshot",
      "repl_list",
      "repl_kill",
      "repl_resize",
    ]);
  });

  it("apiVersion is '1' — MUST NOT be bumped (BLOCKER B: ApiVersionMismatchError on registration)", () => {
    // SYNC ANCHOR: kernel constant PLUGIN_API_VERSION='1' (packages/plugin-api/src/index.ts:10).
    // registry.ts and contract-suite.ts both assert manifest.apiVersion==PLUGIN_API_VERSION.
    // mod.rs bail! on mismatch. Bumping this = registration failure for the repl plugin.
    expect(REPL_PLUGIN_MANIFEST.apiVersion).toBe("1");
  });

});
