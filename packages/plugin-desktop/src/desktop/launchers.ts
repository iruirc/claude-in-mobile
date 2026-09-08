/**
 * App-launch strategies for the desktop companion.
 *
 * Each strategy encapsulates how a single LaunchOptions variant is realised:
 * `gradle` runs a Gradle task, `bundle` uses `open`/spawn, `attach` validates an
 * existing pid, and `companion-only` is a no-op (the companion runs solo).
 *
 * The strategies are intentionally small and pid-returning so the DesktopClient
 * can stay agnostic about platform details.
 */

import { ChildProcess, execFileSync, spawn } from "child_process";
import type { GradleLauncher } from "./gradle.js";
import { MobileError } from "mcp-devices/errors";
import { validateBundleId } from "mcp-devices/utils/sanitize";
import type { LaunchOptions, LogType } from "./types.js";
import {
  getBundleIdFromAppPath,
  validateAndResolveAppPath,
  validateAttachPid,
} from "./permission-allowlist.js";

/** Strategy interface — returns the targetPid of the launched/attached app, or null. */
export interface AppLaunchStrategy {
  launch(): Promise<number | null>;
  stop(): Promise<void>;
}

export class GradleAppLauncher implements AppLaunchStrategy {
  private userAppProcess: ChildProcess | null = null;

  constructor(
    private readonly opts: Extract<LaunchOptions, { mode: "gradle" }>,
    private readonly gradleLauncher: GradleLauncher,
    private readonly addLog: (type: LogType, msg: string) => void
  ) {}

  async launch(): Promise<number | null> {
    this.addLog("stdout", `Launching user app from: ${this.opts.projectPath}`);
    // Spread to satisfy RawLaunchOptions (no as any — structural types are compatible)
    this.userAppProcess = this.gradleLauncher.launch({ ...this.opts });
    this.userAppProcess.stdout?.on("data", (data: Buffer) => this.addLog("stdout", `[UserApp] ${data.toString()}`));
    this.userAppProcess.stderr?.on("data", (data: Buffer) => this.addLog("stderr", `[UserApp] ${data.toString()}`));
    return null;
  }

  async stop(): Promise<void> {
    const child = this.userAppProcess;
    this.userAppProcess = null;
    if (child) await this.gradleLauncher.stop(child);
  }
}

export class BundleAppLauncher implements AppLaunchStrategy {
  private directProcess: ChildProcess | null = null;

  constructor(
    private readonly opts: Extract<LaunchOptions, { mode: "bundle" }>,
    private readonly gradleLauncher: GradleLauncher,
    private readonly addLog: (type: LogType, msg: string) => void
  ) {}
  async launch(): Promise<number | null> {
    // Both bundleId and appPath are pre-validated by normalizeLaunchOptions — at least one is set.
    const { bundleId, appPath, env } = this.opts;
    let resolvedBundleId: string;
    let resolvedPath: string | undefined;

    if (bundleId) {
      validateBundleId(bundleId);
      resolvedBundleId = bundleId;
    } else {
      resolvedPath = validateAndResolveAppPath(appPath!);
      resolvedBundleId = getBundleIdFromAppPath(resolvedPath);
      validateBundleId(resolvedBundleId);
    }

    const binaryPath = this.getExecutablePath(resolvedBundleId, resolvedPath);
    this.addLog(
      "stdout",
      `Launching owned app process: ${bundleId ?? resolvedPath}`,
    );
    const child = spawn(binaryPath, [], {
      env: { ...process.env, ...env },
      detached: true,
      stdio: "ignore",
    });
    this.directProcess = child;
    const spawned = this.waitForSpawn(child, resolvedBundleId);
    child.on("error", (error) => {
      this.addLog("stderr", `Owned app process error: ${error.message}`);
    });
    await spawned;
    child.unref();
    const targetPid = child.pid;
    if (!targetPid) {
      throw new MobileError(
        `Failed to obtain PID for app "${resolvedBundleId}"`,
        "BUNDLE_LAUNCH_FAILED",
      );
    }

    this.addLog("stdout", `App started with PID ${targetPid}`);
    return targetPid;
  }

  async stop(): Promise<void> {
    const directProcess = this.directProcess;
    if (!directProcess) return;
    await this.gradleLauncher.stop(directProcess);
    if (this.directProcess === directProcess) this.directProcess = null;
  }

  private getExecutablePath(bundleId: string, resolvedPath?: string): string {
    const appPath = resolvedPath ?? this.getAppPathFromBundleId(bundleId);
    const binaryName = execFileSync(
      "defaults", ["read", `${appPath}/Contents/Info`, "CFBundleExecutable"],
      { encoding: "utf-8", timeout: 3000 }
    ).trim();
    return `${appPath}/Contents/MacOS/${binaryName}`;
  }

  private waitForSpawn(child: ChildProcess, bundleId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        child.removeListener("spawn", onSpawn);
        child.removeListener("error", onError);
      };
      const onSpawn = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(new MobileError(
          `Failed to launch app "${bundleId}": ${error.message}`,
          "BUNDLE_LAUNCH_FAILED",
        ));
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
    });
  }
  private getAppPathFromBundleId(bundleId: string): string {
    try {
      const result = execFileSync(
        "osascript", ["-e", `POSIX path of (path to application id "${bundleId}")`],
        { encoding: "utf-8", timeout: 5000 }
      ).trim();
      // Strip trailing slash that osascript adds
      return result.replace(/\/$/, "");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new MobileError(`Cannot find app path for bundle ID "${bundleId}": ${message}`, "BUNDLE_PATH_NOT_FOUND");
    }
  }
}

export class AttachLauncher implements AppLaunchStrategy {
  constructor(
    private readonly opts: Extract<LaunchOptions, { mode: "attach" }>,
    private readonly addLog: (type: LogType, msg: string) => void
  ) {}

  async launch(): Promise<number | null> {
    validateAttachPid(this.opts.pid);
    this.addLog("stdout", `Attaching to existing process with PID ${this.opts.pid}`);
    return this.opts.pid;
  }

  async stop(): Promise<void> {}
}

export class NoOpLauncher implements AppLaunchStrategy {
  async launch(): Promise<number | null> { return null; }
  async stop(): Promise<void> {}
}
