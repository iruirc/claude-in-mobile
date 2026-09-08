import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";

import { ReplBridgeClient, ReplBridgeError } from "./client.js";

describe("ReplBridgeClient construction", () => {
  it("falls back to MCP_DEVICES_BIN env override", () => {
    const prior = process.env.MCP_DEVICES_BIN;
    process.env.MCP_DEVICES_BIN = "/nonexistent/path-to-binary-xyz";
    try {
      const c = new ReplBridgeClient();
      expect(c).toBeInstanceOf(ReplBridgeClient);
    } finally {
      if (prior === undefined) delete process.env.MCP_DEVICES_BIN;
      else process.env.MCP_DEVICES_BIN = prior;
    }
  });

  it("starts the native companion through the unambiguous CLI alias", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-devices-cli-"));
    const companion = join(dir, "mcp-devices-cli");
    await writeFile(
      companion,
      [
        "#!/usr/bin/env node",
        `process.stdout.write('{"event":"ready"}\\n');`,
        `process.stdin.on("data", () => process.stdout.write('{"id":"r1","result":null}\\n'));`,
        "",
      ].join("\n"),
      { mode: 0o755 }
    );

    const client = new ReplBridgeClient({
      env: {
        PATH: `${dir}${delimiter}${process.env.PATH ?? ""}`,
      },
      requestTimeoutMs: 2_000,
      startTimeoutMs: 2_000,
    });

    try {
      await expect(client.start()).resolves.toBeUndefined();
    } finally {
      await client.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects when binary cannot be spawned", async () => {
    const c = new ReplBridgeClient({
      binaryPath: "/this/binary/definitely/does/not/exist/xyz",
      requestTimeoutMs: 500,
    });
    await expect(c.call("noop")).rejects.toBeInstanceOf(ReplBridgeError);
  });

  // Regression for #46: a supervisor binary that spawns but exits before
  // emitting `ready` must reject start() (and therefore call()) instead of
  // hanging forever. `true` exits 0 immediately and prints nothing.
  it("rejects when supervisor exits before ready", async () => {
    const c = new ReplBridgeClient({
      binaryPath: "true",
      requestTimeoutMs: 500,
    });
    await expect(c.call("spawn")).rejects.toBeInstanceOf(ReplBridgeError);
  });

  // Regression for #46: a supervisor that stays alive but never speaks the
  // protocol must time out on startup rather than hang. `yes` floods stdout
  // with lines that never parse as the `ready` event and never exits.
  it("rejects when supervisor never emits ready (startup timeout)", async () => {
    const c = new ReplBridgeClient({
      binaryPath: "yes",
      startTimeoutMs: 200,
      requestTimeoutMs: 5_000,
    });
    await expect(c.call("spawn")).rejects.toThrow(/within 200ms/);
    await c.dispose();
  });

  // A failed startup must not poison the client: a subsequent call() should
  // re-attempt a fresh supervisor rather than re-throw the cached rejection.
  it("retries a fresh supervisor after a failed start", async () => {
    const c = new ReplBridgeClient({
      binaryPath: "true",
      requestTimeoutMs: 500,
    });
    await expect(c.call("spawn")).rejects.toBeInstanceOf(ReplBridgeError);
    // Second attempt must also reject (binary is still `true`) — proving the
    // client retried rather than returning a stale settled promise.
    await expect(c.call("spawn")).rejects.toBeInstanceOf(ReplBridgeError);
  });
});
