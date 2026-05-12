import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { WDAManager } from "./wda-manager.js";

// ── helpers ──────────────────────────────────────────────────────────────────

type MockResponse = { status: number; body: unknown };

/**
 * Maps `localhost:<port>` URLs to canned responses. Unmapped ports reject
 * (mirrors a connection refused). Mirrors the makeFetch helper style used
 * in src/store/google-play.test.ts.
 */
function makePortFetch(map: Record<number, MockResponse>) {
  return vi.fn().mockImplementation((url: string) => {
    const m = String(url).match(/localhost:(\d+)/);
    if (!m) throw new Error(`Unexpected URL: ${url}`);
    const port = Number(m[1]);
    const r = map[port];
    if (!r) return Promise.reject(new Error("ECONNREFUSED"));
    const isJson = typeof r.body === "object" && r.body !== null;
    const text = isJson ? JSON.stringify(r.body) : String(r.body ?? "");
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: () => Promise.resolve(text),
      json: () => Promise.resolve(r.body),
    });
  });
}

const WDA_STATUS = { value: { os: { name: "iOS", version: "17.0" } } };

// ── tests: discoverRunningWDA ───────────────────────────────────────────────

describe("WDAManager.discoverRunningWDA", () => {
  let mgr: WDAManager;

  beforeEach(() => {
    mgr = new WDAManager();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns undefined when no port responds", async () => {
    vi.stubGlobal("fetch", makePortFetch({}));
    const port = await (mgr as any).discoverRunningWDA();
    expect(port).toBeUndefined();
  });

  it("returns the port when a WDA /status responds with an iOS payload", async () => {
    vi.stubGlobal(
      "fetch",
      makePortFetch({ 8100: { status: 200, body: WDA_STATUS } })
    );
    const port = await (mgr as any).discoverRunningWDA();
    expect(port).toBe(8100);
  });

  it("skips a listener that returns 200 but not a WDA payload", async () => {
    vi.stubGlobal(
      "fetch",
      makePortFetch({
        8105: { status: 200, body: { value: { something: "else" } } },
      })
    );
    const port = await (mgr as any).discoverRunningWDA();
    expect(port).toBeUndefined();
  });

  it("skips ports returning non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      makePortFetch({ 8100: { status: 500, body: "err" } })
    );
    const port = await (mgr as any).discoverRunningWDA();
    expect(port).toBeUndefined();
  });

  it("returns the lowest matching port when several respond", async () => {
    vi.stubGlobal(
      "fetch",
      makePortFetch({
        8120: { status: 200, body: WDA_STATUS },
        8150: { status: 200, body: WDA_STATUS },
      })
    );
    const port = await (mgr as any).discoverRunningWDA();
    expect(port).toBe(8120);
  });
});

// ── tests: acquireDeviceLock ────────────────────────────────────────────────

describe("WDAManager.acquireDeviceLock", () => {
  let mgr: WDAManager;
  let deviceId: string;
  let lockPath: string;

  beforeEach(() => {
    mgr = new WDAManager();
    deviceId = `testdev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    lockPath = path.join(
      os.tmpdir(),
      `claude-in-mobile-wda-${deviceId}.lock`
    );
    try {
      fs.unlinkSync(lockPath);
    } catch {}
  });

  afterEach(() => {
    try {
      fs.unlinkSync(lockPath);
    } catch {}
  });

  it("creates a lockfile carrying pid+startedAt and removes it on release", async () => {
    const release = await (mgr as any).acquireDeviceLock(deviceId);
    expect(fs.existsSync(lockPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    expect(parsed.pid).toBe(process.pid);
    expect(typeof parsed.startedAt).toBe("number");
    release();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("supports sequential acquire → release → acquire", async () => {
    const r1 = await (mgr as any).acquireDeviceLock(deviceId);
    r1();
    const r2 = await (mgr as any).acquireDeviceLock(deviceId);
    expect(fs.existsSync(lockPath)).toBe(true);
    r2();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("steals the lockfile when the holder pid is dead", async () => {
    // PID 999999 is overwhelmingly unlikely to be alive on a normal system.
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 999999, startedAt: Date.now() })
    );
    const release = await (mgr as any).acquireDeviceLock(deviceId);
    const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    expect(parsed.pid).toBe(process.pid);
    release();
  });

  it("steals a corrupt lockfile", async () => {
    fs.writeFileSync(lockPath, "not json{{{");
    const release = await (mgr as any).acquireDeviceLock(deviceId);
    const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    expect(parsed.pid).toBe(process.pid);
    release();
  });

  it("steals a lockfile older than buildTimeout + startupTimeout", async () => {
    (mgr as any).buildTimeout = 50;
    (mgr as any).startupTimeout = 50;
    // Alive holder pid but stale by age — must still be stolen.
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, startedAt: Date.now() - 10_000 })
    );
    const release = await (mgr as any).acquireDeviceLock(deviceId);
    const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    expect(parsed.pid).toBe(process.pid);
    expect(parsed.startedAt).toBeGreaterThan(Date.now() - 2_000);
    release();
  });

  it("times out when the holder is alive and the lock is fresh", async () => {
    (mgr as any).buildTimeout = 100;
    (mgr as any).startupTimeout = 100;
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, startedAt: Date.now() })
    );
    await expect(
      (mgr as any).acquireDeviceLock(deviceId)
    ).rejects.toThrow(/Timed out waiting for WDA lock/);
  });
});
