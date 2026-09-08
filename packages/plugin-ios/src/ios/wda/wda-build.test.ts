import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { WDAManager } from "./wda-manager.js";

/**
 * Build-path tests. Follows the fake-binary-on-PATH strategy from client.test.ts:
 * real code runs, only `xcrun` / `xcodebuild` are shimmed, so nothing here mocks
 * the module under test.
 */

interface BuildHarness {
  derivedDataRoot: string;
  buildWDAIfNeeded(wdaPath: string): Promise<void>;
}

function harness(manager: WDAManager): BuildHarness {
  return manager as unknown as BuildHarness;
}

const DEVICES_JSON = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
      { udid: "UDID-BOOTED", name: "iPhone 16 Pro", state: "Booted", isAvailable: true },
      { udid: "UDID-SHUTDOWN", name: "iPhone 16", state: "Shutdown", isAvailable: true },
    ],
  },
});

describe("WDAManager build path", () => {
  let workDir: string;
  let wdaPath: string;
  let derivedDataRoot: string;
  let buildArgsLog: string;
  let devicesJson: string;
  let savedPath: string | undefined;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "cim-wda-build-"));
    wdaPath = join(workDir, "wda");
    derivedDataRoot = join(workDir, "DerivedData");
    buildArgsLog = join(workDir, "xcodebuild-args");
    devicesJson = join(workDir, "devices.json");

    mkdirSync(join(wdaPath, "WebDriverAgent.xcodeproj"), { recursive: true });
    // appium-webdriveragent ships `build/` as its TypeScript output — always present,
    // and unrelated to whether xcodebuild has ever run.
    mkdirSync(join(wdaPath, "build"), { recursive: true });
    mkdirSync(derivedDataRoot, { recursive: true });

    const bin = join(workDir, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "xcodebuild"), `#!/bin/sh\necho "$@" > "${buildArgsLog}"\nexit 0\n`);
    chmodSync(join(bin, "xcodebuild"), 0o755);
    writeFileSync(devicesJson, DEVICES_JSON);
    writeFileSync(join(bin, "xcrun"), `#!/bin/sh\ncat "${devicesJson}"\n`);
    chmodSync(join(bin, "xcrun"), 0o755);

    savedPath = process.env.PATH;
    process.env.PATH = `${bin}${delimiter}${savedPath ?? ""}`;
  });

  afterEach(() => {
    if (savedPath !== undefined) process.env.PATH = savedPath;
    rmSync(workDir, { recursive: true, force: true });
  });

  it("builds when DerivedData holds no runner app, despite the npm build/ directory", async () => {
    const manager = new WDAManager();
    harness(manager).derivedDataRoot = derivedDataRoot;

    await harness(manager).buildWDAIfNeeded(wdaPath);

    expect(existsSync(buildArgsLog)).toBe(true);
  });

  it("skips the build when DerivedData already holds the runner app", async () => {
    mkdirSync(
      join(derivedDataRoot, "WebDriverAgent-abc123", "Build", "Products",
           "Debug-iphonesimulator", "WebDriverAgentRunner-Runner.app"),
      { recursive: true },
    );
    const manager = new WDAManager();
    harness(manager).derivedDataRoot = derivedDataRoot;

    await harness(manager).buildWDAIfNeeded(wdaPath);

    expect(existsSync(buildArgsLog)).toBe(false);
  });

  it("targets a booted simulator instead of a hardcoded device name", async () => {
    const manager = new WDAManager();
    harness(manager).derivedDataRoot = derivedDataRoot;

    await harness(manager).buildWDAIfNeeded(wdaPath);

    const args = readFileSync(buildArgsLog, "utf8");
    expect(args).toContain("id=UDID-BOOTED");
    expect(args).not.toContain("iPhone 14");
  });

  it("reports that no simulator is available instead of failing obscurely", async () => {
    writeFileSync(devicesJson, JSON.stringify({ devices: {} }));
    const manager = new WDAManager();
    harness(manager).derivedDataRoot = derivedDataRoot;

    await expect(harness(manager).buildWDAIfNeeded(wdaPath)).rejects.toThrow(/no iOS simulator/i);
  });

  it("builds the simulator runner without code signing", async () => {
    const manager = new WDAManager();
    harness(manager).derivedDataRoot = derivedDataRoot;

    await harness(manager).buildWDAIfNeeded(wdaPath);

    expect(readFileSync(buildArgsLog, "utf8")).toContain("CODE_SIGNING_ALLOWED=NO");
  });

  // A cold `build-for-testing` writes ~1 MB of progress to stdout; execSync's default
  // maxBuffer is exactly that, and Node SIGTERMs the child once it is exceeded.
  it("survives a build whose output exceeds the default execSync buffer", async () => {
    writeFileSync(
      join(workDir, "bin", "xcodebuild"),
      `#!/bin/sh\nawk 'BEGIN { for (i = 0; i < 40000; i++) print "xcodebuild progress line padding" }'\nexit 0\n`,
    );
    chmodSync(join(workDir, "bin", "xcodebuild"), 0o755);
    const manager = new WDAManager();
    harness(manager).derivedDataRoot = derivedDataRoot;

    await expect(harness(manager).buildWDAIfNeeded(wdaPath)).resolves.toBeUndefined();
  });
});
