import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MobileError } from "mcp-devices/errors";
import {
  validateDeviceId,
  validatePackageName,
  validatePath,
} from "mcp-devices/utils/sanitize";

const EXEC_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 50 * 1024 * 1024;
const ABILITY_NAME_RE = /^[A-Za-z][A-Za-z0-9_.]*$/;
const MODULE_NAME_RE = /^[A-Za-z][A-Za-z0-9_.]*$/;
const HARMONY_KEY_IDS: Readonly<Record<string, string>> = Object.freeze({
  BACK: "Back",
  HOME: "Home",
  POWER: "Power",
  ENTER: "2054",
  RETURN: "2054",
  TAB: "2049",
  SPACE: "2050",
  DELETE: "2055",
  BACKSPACE: "2055",
  ESCAPE: "2070",
  ESC: "2070",
});

function resolveHarmonyKey(key: string): string {
  const normalized = key.trim().toUpperCase();
  const mapped = HARMONY_KEY_IDS[normalized];
  if (mapped) return mapped;
  if (/^\d+$/.test(normalized)) return normalized;
  throw new MobileError(
    `Unknown HarmonyOS key: "${key}". Use BACK, HOME, POWER, ENTER, TAB, SPACE, DELETE, ESCAPE, or a numeric KeyCode.`,
    "INVALID_KEY",
  );
}

function swipeVelocity(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  durationMs: number,
): string {
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 300;
  const pixelsPerSecond = Math.round((Math.hypot(x2 - x1, y2 - y1) * 1_000) / duration);
  return String(Math.max(200, Math.min(40_000, pixelsPerSecond)));
}

export interface HarmonyDevice {
  id: string;
  name: string;
  platform: "harmony";
  state: string;
  isSimulator: boolean;
  connection?: string;
}

export interface HarmonyLogOptions {
  level?: string;
  tag?: string;
  lines?: number;
  package?: string;
}

export type HdcExecutor = (
  binary: string,
  args: readonly string[],
) => string;

export interface HdcClientOptions {
  hdcPath?: string;
  executor?: HdcExecutor;
  deviceId?: string;
}

function defaultExecutor(binary: string, args: readonly string[]): string {
  return execFileSync(binary, [...args], {
    encoding: "utf-8",
    maxBuffer: MAX_BUFFER_BYTES,
    timeout: EXEC_TIMEOUT_MS,
  }).trim();
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

function errorOutput(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  for (const key of ["stderr", "stdout"] as const) {
    const value = Reflect.get(error, key);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Buffer.isBuffer(value) && value.length > 0) return value.toString("utf-8").trim();
  }
  return "";
}

function validateAbilityName(ability: string): void {
  if (!ABILITY_NAME_RE.test(ability)) {
    throw new MobileError(
      `Invalid HarmonyOS ability name: "${ability}"`,
      "INVALID_ABILITY_NAME",
    );
  }
}

function validateModuleName(moduleName: string): void {
  if (!MODULE_NAME_RE.test(moduleName)) {
    throw new MobileError(
      `Invalid HarmonyOS module name: "${moduleName}"`,
      "INVALID_MODULE_NAME",
    );
  }
}

function parseLaunchTarget(value: string): { bundleId: string; ability: string } {
  const separator = value.indexOf("/");
  const bundleId = separator === -1 ? value : value.slice(0, separator);
  const ability = separator === -1 ? "EntryAbility" : value.slice(separator + 1);
  validatePackageName(bundleId);
  validateAbilityName(ability);
  return { bundleId, ability };
}

export class HdcClient {
  private readonly hdcPath: string;
  private readonly executor: HdcExecutor;
  private selectedDeviceId?: string;

  constructor(options: HdcClientOptions = {}) {
    this.hdcPath = options.hdcPath ?? process.env.HDC_PATH ?? "hdc";
    this.executor = options.executor ?? defaultExecutor;
    const configuredDeviceId = options.deviceId ?? process.env.HARMONY_DEVICE_ID;
    if (configuredDeviceId) this.setDevice(configuredDeviceId);
  }

  checkAvailability(): boolean {
    try {
      this.runHost(["version"]);
      return true;
    } catch {
      return false;
    }
  }

  setDevice(deviceId: string): void {
    validateDeviceId(deviceId);
    this.selectedDeviceId = deviceId;
  }

  getDeviceId(): string | undefined {
    return this.selectedDeviceId;
  }

  listDevices(): HarmonyDevice[] {
    const output = this.runHost(["list", "targets", "-v"]);
    if (!output) return [];
    const devices: HarmonyDevice[] = [];
    for (const rawLine of output.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("[Empty]")) continue;
      const fields = line.split(/\s+/);
      const id = fields[0];
      if (!id || id.startsWith("[")) continue;
      const connection = fields[1];
      const rawState = fields.find((field) =>
        /^(Connected|Ready|Offline|Unauthorized|Unknown)$/i.test(field)
      );
      const state = rawState?.toLowerCase() ?? "connected";
      devices.push({
        id,
        name: fields[3] && !/^(hdc|localhost)$/i.test(fields[3]) ? fields[3] : id,
        platform: "harmony",
        state,
        isSimulator: /emulator|simulator/i.test(line),
        connection,
      });
    }
    return devices;
  }

  tap(x: number, y: number, deviceId?: string): void {
    this.run(["shell", "uitest", "uiInput", "click", String(x), String(y)], deviceId);
  }

  doubleTap(x: number, y: number, deviceId?: string): void {
    this.run(["shell", "uitest", "uiInput", "doubleClick", String(x), String(y)], deviceId);
  }

  longPress(x: number, y: number, durationMs = 1_000, deviceId?: string): void {
    this.run(
      ["shell", "uitest", "uiInput", "longClick", String(x), String(y), String(durationMs)],
      deviceId,
    );
  }

  swipe(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    durationMs = 300,
    deviceId?: string,
  ): void {
    const velocity = swipeVelocity(x1, y1, x2, y2, durationMs);
    this.run([
      "shell", "uitest", "uiInput", "swipe",
      String(x1), String(y1), String(x2), String(y2), velocity,
    ], deviceId);
  }

  swipeDirection(
    direction: "up" | "down" | "left" | "right",
    deviceId?: string,
  ): void {
    const directionCode = { left: "0", right: "1", up: "2", down: "3" }[direction];
    this.run(["shell", "uitest", "uiInput", "dircFling", directionCode], deviceId);
  }

  inputText(text: string, deviceId?: string): void {
    this.run(["shell", "uitest", "uiInput", "text", text], deviceId);
  }

  pressKey(key: string, deviceId?: string): void {
    this.run(
      ["shell", "uitest", "uiInput", "keyEvent", resolveHarmonyKey(key)],
      deviceId,
    );
  }

  screenshotRaw(deviceId?: string): Buffer {
    const nonce = randomBytes(8).toString("hex");
    const remotePath = `/data/local/tmp/mcp-devices-${nonce}.png`;
    const localPath = join(tmpdir(), `mcp-devices-harmony-${nonce}.png`);
    try {
      this.run(["shell", "uitest", "screenCap", "-p", remotePath], deviceId);
      this.run(["file", "recv", remotePath, localPath], deviceId);
      return readFileSync(localPath);
    } finally {
      try { unlinkSync(localPath); } catch {}
      try { this.run(["shell", "rm", "-f", remotePath], deviceId); } catch {}
    }
  }

  screenshot(deviceId?: string): string {
    return this.screenshotRaw(deviceId).toString("base64");
  }

  getUiHierarchy(deviceId?: string): string {
    const nonce = randomBytes(8).toString("hex");
    const remotePath = `/data/local/tmp/mcp-devices-ui-${nonce}.json`;
    const localPath = join(tmpdir(), `mcp-devices-harmony-ui-${nonce}.json`);
    try {
      this.run(["shell", "uitest", "dumpLayout", "-p", remotePath], deviceId);
      this.run(["file", "recv", remotePath, localPath], deviceId);
      return readFileSync(localPath, "utf-8");
    } finally {
      try { unlinkSync(localPath); } catch {}
      try { this.run(["shell", "rm", "-f", remotePath], deviceId); } catch {}
    }
  }

  launchApp(target: string, deviceId?: string): string {
    const { bundleId, ability } = parseLaunchTarget(target);
    return this.launchAbility(bundleId, ability, undefined, deviceId);
  }

  launchAbility(
    bundleId: string,
    ability = "EntryAbility",
    moduleName?: string,
    deviceId?: string,
  ): string {
    validatePackageName(bundleId);
    validateAbilityName(ability);
    const args = ["shell", "aa", "start", "-b", bundleId, "-a", ability];
    if (moduleName) {
      validateModuleName(moduleName);
      args.push("-m", moduleName);
    }
    const output = this.run(args, deviceId);
    const target = moduleName
      ? `${bundleId}/${moduleName}/${ability}`
      : `${bundleId}/${ability}`;
    return output || `Launched ${target}`;
  }

  openUrl(url: string, deviceId?: string): string {
    const output = this.run(
      ["shell", "aa", "start", "-A", "ohos.want.action.viewData", "-U", url],
      deviceId,
    );
    return output || `Opened URL: ${url}`;
  }

  stopApp(bundleId: string, deviceId?: string): void {
    validatePackageName(bundleId);
    this.run(["shell", "aa", "force-stop", bundleId], deviceId);
  }

  installApp(localPath: string, deviceId?: string): string {
    validatePath(localPath, "app path");
    const output = this.run(["install", "-r", localPath], deviceId);
    return output || `Installed ${localPath}`;
  }

  uninstallApp(bundleId: string, deviceId?: string): string {
    validatePackageName(bundleId);
    const output = this.run(["uninstall", bundleId], deviceId);
    return output || `Uninstalled ${bundleId}`;
  }

  listPackages(deviceId?: string): string[] {
    const output = this.run(["shell", "bm", "dump", "-a"], deviceId);
    const packages = new Set<string>();
    for (const match of output.matchAll(/bundleName\s*[:=]\s*"?([A-Za-z][A-Za-z0-9_.]*)"?/g)) {
      packages.add(match[1]!);
    }
    for (const line of output.split(/\r?\n/)) {
      const value = line.trim();
      if (/^[A-Za-z][A-Za-z0-9_.]*\.[A-Za-z0-9_.]+$/.test(value)) packages.add(value);
    }
    return [...packages].sort();
  }

  shell(command: string, deviceId?: string): string {
    return this.run(["shell", command], deviceId);
  }

  getLogs(options: HarmonyLogOptions = {}, deviceId?: string): string {
    let lines = this.run(["hilog", "-x"], deviceId).split(/\r?\n/);
    for (const filter of [options.level, options.tag, options.package]) {
      if (filter) lines = lines.filter((line) => line.includes(filter));
    }
    const limit = options.lines === undefined
      ? 500
      : Math.max(1, Math.min(10_000, Math.trunc(options.lines)));
    return lines.slice(-limit).join("\n");
  }

  clearLogs(deviceId?: string): string {
    const output = this.run(["shell", "hilog", "-r"], deviceId);
    return output || "HarmonyOS HiLog buffers cleared";
  }

  getSystemInfo(deviceId?: string): string {
    return this.run(["shell", "param", "get"], deviceId);
  }

  pushFile(localPath: string, remotePath: string, deviceId?: string): string {
    validatePath(localPath, "localPath");
    validatePath(remotePath, "remotePath");
    const output = this.run(["file", "send", localPath, remotePath], deviceId);
    return output || `Uploaded ${localPath} → ${remotePath}`;
  }

  pullFile(remotePath: string, localPath: string, deviceId?: string): string {
    validatePath(remotePath, "remotePath");
    validatePath(localPath, "localPath");
    const output = this.run(["file", "recv", remotePath, localPath], deviceId);
    return output || `Downloaded ${remotePath} → ${localPath}`;
  }

  private run(args: readonly string[], deviceId?: string): string {
    const target = deviceId ?? this.selectedDeviceId;
    if (target) validateDeviceId(target);
    const targetArgs = target ? ["-t", target, ...args] : [...args];
    return this.runHost(targetArgs);
  }

  private runHost(args: readonly string[]): string {
    try {
      return this.executor(this.hdcPath, args).trim();
    } catch (error: unknown) {
      if (errorCode(error) === "ENOENT") {
        throw new MobileError(
          `hdc not found at "${this.hdcPath}". Add the DevEco Studio SDK toolchains directory to PATH or set HDC_PATH.`,
          "HDC_NOT_FOUND",
        );
      }
      const detail = errorOutput(error)
        || (error instanceof Error ? error.message : String(error));
      throw new MobileError(
        `Command '${this.hdcPath} ${args.join(" ")}' failed: ${detail}`,
        "HDC_COMMAND_FAILED",
      );
    }
  }
}
