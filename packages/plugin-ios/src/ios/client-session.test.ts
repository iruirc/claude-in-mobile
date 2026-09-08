import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IosClient } from "./client.js";
import { WDAManager } from "./wda/wda-manager.js";
import type { WDAClient } from "./wda/wda-client.js";

interface ClientHarness {
  wdaClient?: WDAClient & { sessionId: string | null };
  ensureWDA(deviceIdOverride?: string): Promise<WDAClient>;
}

interface ManagerHarness {
  publishInstance(deviceId: string, port: number, child: ChildProcess): unknown;
}

function fakeChild(pid: number): ChildProcess {
  const child = new EventEmitter() as unknown as ChildProcess;
  Object.assign(child, { pid, exitCode: null, signalCode: null, kill: vi.fn(() => true) });
  return child;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IosClient session lifetime", () => {
  it("recreates a session WDA has dropped instead of reusing the dead one", async () => {
    const manager = new WDAManager();
    (manager as unknown as ManagerHarness).publishInstance("device-a", 8_181, fakeChild(20_001));
    const client = new IosClient("device-a", manager);
    const harness = client as unknown as ClientHarness;

    let created = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init as RequestInit | undefined)?.method ?? "GET";
      if (method === "POST" && url.endsWith("/session")) {
        created += 1;
        return jsonResponse({ sessionId: `session-${created}` });
      }
      // WDA has evicted the session it handed out earlier.
      if (method === "GET" && url.includes("/session/")) {
        return new Response("invalid session id", { status: 404 });
      }
      return jsonResponse({ value: {} });
    });

    await harness.ensureWDA();
    expect(harness.wdaClient?.sessionId).toBe("session-1");

    await harness.ensureWDA();

    expect(harness.wdaClient?.sessionId).toBe("session-2");
    await manager.cleanup();
  });
});
