import { describe, expect, it, vi } from "vitest";

import {
  applyInstall,
  applyUninstall,
  doctorReport,
  formatProbe,
  probePlatform,
  runPlatformCommand,
} from "./platform-cli.js";

describe("applyInstall", () => {
  it("adds and dedupes", () => {
    expect(applyInstall(["ios"], ["android", "ios"])).toEqual(["ios", "android"]);
  });
  it("expands all", () => {
    expect(applyInstall([], ["all"]).sort()).toEqual(
      ["android", "aurora", "desktop", "harmony", "ios", "web"].sort()
    );
  });
  it("ignores unknown tokens", () => {
    expect(applyInstall([], ["bogus", "ios"])).toEqual(["ios"]);
  });
});

describe("applyUninstall", () => {
  it("removes listed platforms", () => {
    expect(applyUninstall(["ios", "android", "web"], ["android"])).toEqual([
      "ios",
      "web",
    ]);
  });
  it("uninstall all clears", () => {
    expect(applyUninstall(["ios", "web"], ["all"])).toEqual([]);
  });
});

describe("runPlatformCommand dispatch", () => {
  it("returns false for non-platform argv (falls through)", () => {
    const r = runPlatformCommand(["node", "cli.js", "--version"], (() => {
      throw new Error("should not exit");
    }) as never);
    expect(r).toBe(false);
  });

  it("handles a known command and exits 0", () => {
    let code: number | undefined;
    const exit = ((c: number) => {
      code = c;
      return undefined as never;
    }) as (c: number) => never;
    runPlatformCommand(["node", "cli.js", "platforms"], exit);
    expect(code).toBe(0);
  });

  it("install with no args exits 1", () => {
    const codes: number[] = [];
    const exit = ((c: number) => {
      codes.push(c);
      return undefined as never;
    }) as (c: number) => never;
    runPlatformCommand(["node", "cli.js", "install"], exit);
    expect(codes).toContain(1);
  });
});

describe("probePlatform (doctor toolchain check)", () => {
  // The `present` predicate is injected — no real process spawn — so these
  // guard the found / MISSING branches on EVERY OS, including Windows where
  // the old `/bin/sh -c command -v` path reported everything MISSING.

  it("reports ok when the probe binary is present", () => {
    const r = probePlatform("android", () => true);
    expect(r.missing).toEqual([]);
    expect(r.noExternalCli).toBe(false);
    expect(formatProbe(r)).toContain("ok (adb)");
  });

  it("reports MISSING when the probe binary is absent (regression: win32 desync)", () => {
    const r = probePlatform("android", () => false);
    expect(r.missing).toEqual(["adb"]);
    expect(formatProbe(r)).toContain("MISSING adb");
  });

  it("does NOT report false-MISSING when a probe IS on PATH", () => {
    // Simulates a Windows box with adb on PATH: present=true must yield ok.
    const found = new Set(["adb", "hdc", "java", "xcrun", "flutter-aurora"]);
    for (const p of ["android", "ios", "desktop", "aurora", "harmony"] as const) {
      const r = probePlatform(p, (bin) => found.has(bin));
      expect(r.missing).toEqual([]);
      expect(formatProbe(r)).toContain("ok (");
    }
  });

  it("probes HDC for HarmonyOS", () => {
    const result = probePlatform("harmony", (binary) => binary === "hdc");
    expect(result.missing).toEqual([]);
    expect(formatProbe(result)).toContain("ok (hdc)");
  });

  it("honors HDC_PATH when probing HarmonyOS", () => {
    const result = probePlatform(
      "harmony",
      (binary) => binary === "/opt/deveco/hdc",
      "/opt/deveco/hdc",
    );
    expect(result.missing).toEqual([]);
    expect(formatProbe(result)).toContain("ok (/opt/deveco/hdc)");
  });

  it("web needs no external CLI regardless of presence check", () => {
    const r = probePlatform("web", () => false);
    expect(r.noExternalCli).toBe(true);
    expect(r.missing).toEqual([]);
    expect(formatProbe(r)).toContain("no external CLI required");
  });

  it("returns an unhealthy verdict when any requested toolchain is missing", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(doctorReport(["android", "web"], () => false)).toBe(false);
      expect(doctorReport(["android", "web"], (binary) => binary === "adb")).toBe(true);
    } finally {
      log.mockRestore();
    }
  });
});
