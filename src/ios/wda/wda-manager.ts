import { execSync, spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { WDAClient } from "./wda-client.js";
import { WDAInstanceInfo } from "./wda-types.js";

/** Port WDA listens on inside a physical device; the local end is forwarded. */
const DEVICE_WDA_PORT = 8100;
/** go-ios binary (overridable, mirrors src/ios/go-ios/client.ts). */
const GO_IOS_BIN = process.env.GO_IOS_BIN ?? "ios";

export class WDAManager {
  private instances: Map<string, WDAInstanceInfo> = new Map();
  private clients: Map<string, WDAClient> = new Map();
  /** Deduplicates parallel launches for the same device */
  private launchPromises: Map<string, Promise<WDAClient>> = new Map();
  /** Long-lived `ios forward` processes for physical devices, by udid. */
  private forwards: Map<string, ChildProcess> = new Map();
  private readonly startupTimeout = 30000;
  /** Physical first-run does a full device build+sign+install — much slower. */
  private readonly deviceStartupTimeout = 300000;
  private readonly buildTimeout = 120000;

  async ensureWDAReady(
    deviceId: string,
    isSimulator: boolean = true
  ): Promise<WDAClient> {
    // Check existing client
    if (this.clients.has(deviceId)) {
      const client = this.clients.get(deviceId)!;
      try {
        await client.ensureSession(deviceId);
        return client;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("WDA client failed, relaunching:", msg);
        // Clean up failed instance
        const instance = this.instances.get(deviceId);
        if (instance) {
          try {
            process.kill(instance.pid);
          } catch {}
        }
        this.clients.delete(deviceId);
        this.instances.delete(deviceId);
        // Fall through to relaunch
      }
    }

    // Deduplicate parallel launches — if another call is already launching
    // WDA for this device, reuse its promise instead of spawning a second xcodebuild
    if (this.launchPromises.has(deviceId)) {
      return this.launchPromises.get(deviceId)!;
    }

    const launchPromise = this.doLaunch(deviceId, isSimulator);
    this.launchPromises.set(deviceId, launchPromise);

    try {
      return await launchPromise;
    } finally {
      this.launchPromises.delete(deviceId);
    }
  }

  private async doLaunch(
    deviceId: string,
    isSimulator: boolean
  ): Promise<WDAClient> {
    // Reuse an already-running WDA (left over from another MCP process,
    // a previous crashed run, or launched manually). Avoids spawning a
    // second xcodebuild that would conflict over ports and the simulator.
    const existingPort = await this.discoverRunningWDA();
    if (existingPort !== undefined) {
      const client = new WDAClient(existingPort);
      try {
        await client.ensureSession(deviceId);
        this.clients.set(deviceId, client);
        return client;
      } catch {
        // Discovered WDA belongs to another device/session — fall through.
      }
    }

    const wdaPath = await this.discoverWDA();
    const port = await this.findFreePort();

    if (isSimulator) {
      await this.buildWDAIfNeeded(wdaPath);
      await this.launchWDA(wdaPath, deviceId, port);
    } else {
      await this.launchWDADevice(wdaPath, deviceId, port);
    }

    const client = new WDAClient(port);
    await client.ensureSession(deviceId);

    this.clients.set(deviceId, client);

    return client;
  }

  /**
   * Checks whether any booted simulator already has the WebDriverAgent
   * runner app installed. Used to skip an expensive xcodebuild build
   * when DerivedData has been cleaned but the app survives in the sim.
   */
  private isWDAInstalledOnAnySimulator(): boolean {
    const wdaBundleId = "com.facebook.WebDriverAgentRunner.xctrunner";
    try {
      const raw = execSync("xcrun simctl list devices booted -j", {
        encoding: "utf8",
        stdio: "pipe",
      });
      const data = JSON.parse(raw);
      for (const devices of Object.values(data.devices) as any[][]) {
        for (const device of devices) {
          try {
            const apps = execSync(`xcrun simctl listapps ${device.udid}`, {
              encoding: "utf8",
              stdio: "pipe",
            });
            if (apps.includes(wdaBundleId)) return true;
          } catch {
            // listapps fails on some sim states — continue scanning
          }
        }
      }
    } catch {
      // No booted simulators or simctl unavailable — fall through to build.
    }
    return false;
  }

  /**
   * Scans the WDA port range for a live WebDriverAgent instance.
   * Returns the port if found, otherwise undefined.
   * Probes are run in parallel so total wall time stays close to a single
   * fetch timeout regardless of range size.
   */
  private async discoverRunningWDA(): Promise<number | undefined> {
    const ports = Array.from({ length: 100 }, (_, i) => 8100 + i);
    const probes = ports.map(async (port) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 500);
        const r = await fetch(`http://localhost:${port}/status`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!r.ok) return undefined;
        const j: any = await r.json();
        // WDA /status returns { value: { os: { name: "iOS", ... }, ... } }
        if (j?.value?.os?.name === "iOS") return port;
      } catch {
        // not listening / not WDA / timed out — ignore
      }
      return undefined;
    });
    const results = await Promise.all(probes);
    return results.find((p): p is number => p !== undefined);
  }

  private async discoverWDA(): Promise<string> {
    const searchPaths = [
      process.env.WDA_PATH,
      path.join(
        os.homedir(),
        ".appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent"
      ),
      "/opt/homebrew/lib/node_modules/appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent",
      "/usr/local/lib/node_modules/appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent",
    ].filter(Boolean) as string[];

    for (const searchPath of searchPaths) {
      if (fs.existsSync(searchPath)) {
        const projectPath = path.join(searchPath, "WebDriverAgent.xcodeproj");
        if (fs.existsSync(projectPath)) {
          return searchPath;
        }
      }
    }

    throw new Error(
      "WebDriverAgent not found.\n\n" +
        "Install Appium with XCUITest driver:\n" +
        "  npm install -g appium\n" +
        "  appium driver install xcuitest\n\n" +
        "Or set WDA_PATH environment variable:\n" +
        "  export WDA_PATH=/path/to/WebDriverAgent\n\n" +
        "Search paths checked:\n" +
        searchPaths.map((p) => `  - ${p}`).join("\n")
    );
  }

  private resolveSimulatorDestination(): string | undefined {
    const isIOS = (name: string) =>
      name.includes("iPhone") || name.includes("iPad");

    // 1. Prefer a booted simulator — no extra boot time needed.
    // 2. Fall back to first available simulator across any iOS runtime.
    for (const filter of ["booted", "available"] as const) {
      try {
        const raw = execSync(`xcrun simctl list devices ${filter} -j`, {
          encoding: "utf8",
          stdio: "pipe",
        });
        const data = JSON.parse(raw);
        for (const devices of Object.values(data.devices) as any[][]) {
          for (const device of devices) {
            if (isIOS(device.name)) {
              return `platform=iOS Simulator,id=${device.udid}`;
            }
          }
        }
      } catch {
        // continue to next filter
      }
    }

    return undefined;
  }

  private async buildWDAIfNeeded(wdaPath: string): Promise<void> {
    // Cannot check wdaPath/build — that directory exists in the npm package as
    // TypeScript compiled output and is always present, regardless of whether
    // xcodebuild has run. Check for the real Xcode artifact in DerivedData instead.
    const derivedData = path.join(
      os.homedir(),
      "Library/Developer/Xcode/DerivedData"
    );
    if (fs.existsSync(derivedData)) {
      const entries = fs
        .readdirSync(derivedData)
        .filter((e) => e.startsWith("WebDriverAgent-"));
      for (const entry of entries) {
        const app = path.join(
          derivedData,
          entry,
          "Build/Products/Debug-iphonesimulator/WebDriverAgentRunner-Runner.app"
        );
        if (fs.existsSync(app)) return;
      }
    }

    // DerivedData may be cleaned even when WDA is still installed on a
    // simulator (e.g. user ran "Clean Build Folder" after a successful
    // install). xcodebuild test-without-building can run against the
    // installed app, so a rebuild is unnecessary in that case.
    if (this.isWDAInstalledOnAnySimulator()) return;

    console.error("Building WebDriverAgent for first use (~2-5 min)...");

    const destination = this.resolveSimulatorDestination();
    if (!destination) {
      throw new Error(
        "No iOS simulator available for WebDriverAgent build.\n\n" +
          "Open Xcode → Window → Devices and Simulators and add an iPhone simulator."
      );
    }

    try {
      await this.runBuildWithProgress(wdaPath, destination);
    } catch (error: any) {
      throw new Error(
        "Failed to build WebDriverAgent.\n\n" +
          `${error.message}\n\n` +
          "Troubleshooting:\n" +
          "1. Install Xcode: https://apps.apple.com/app/xcode/id497799835\n" +
          "2. Install command line tools: xcode-select --install\n" +
          "3. Accept license: sudo xcodebuild -license accept\n" +
          "4. Set Xcode path: sudo xcode-select -s /Applications/Xcode.app"
      );
    }
  }

  /**
   * Runs the WDA xcodebuild build-for-testing with progress visible in
   * stderr — a periodic heartbeat with the latest non-empty xcodebuild
   * line, so a stuck build is diagnosable without waiting for the full
   * buildTimeout to fire.
   */
  private runBuildWithProgress(
    wdaPath: string,
    destination: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        "xcodebuild",
        [
          "build-for-testing",
          "-project",
          "WebDriverAgent.xcodeproj",
          "-scheme",
          "WebDriverAgentRunner",
          "-destination",
          destination,
          "CODE_SIGNING_ALLOWED=NO",
        ],
        { cwd: wdaPath, stdio: "pipe" }
      );

      const startTime = Date.now();
      const MAX_TAIL_CHARS = 8_000;
      let tail = "";
      let lastSignificantLine = "";

      const consume = (data: Buffer) => {
        const chunk = data.toString();
        tail = (tail + chunk).slice(-MAX_TAIL_CHARS);
        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.length > 0) lastSignificantLine = trimmed;
        }
      };
      child.stdout?.on("data", consume);
      child.stderr?.on("data", consume);

      const heartbeat = setInterval(() => {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const preview = lastSignificantLine.slice(0, 200);
        console.error(`  [wda build] ${elapsed}s — ${preview}`);
      }, 10_000);

      const timeoutHandle = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        clearInterval(heartbeat);
        reject(
          new Error(
            `xcodebuild build-for-testing exceeded ${this.buildTimeout}ms.\n\n` +
              `Last output:\n${tail.slice(-2000)}`
          )
        );
      }, this.buildTimeout);

      child.on("exit", (code) => {
        clearInterval(heartbeat);
        clearTimeout(timeoutHandle);
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `xcodebuild build-for-testing exited with code ${code}.\n\n` +
                `Last output:\n${tail.slice(-2000)}`
            )
          );
        }
      });

      child.on("error", (err) => {
        clearInterval(heartbeat);
        clearTimeout(timeoutHandle);
        reject(err);
      });
    });
  }

  private async launchWDA(
    wdaPath: string,
    deviceId: string,
    port: number
  ): Promise<void> {
    const existingInstance = this.instances.get(deviceId);
    if (existingInstance) {
      try {
        process.kill(existingInstance.pid, 0);
        return;
      } catch {
        this.instances.delete(deviceId);
      }
    }

    const wdaProcess = spawn(
      "xcodebuild",
      [
        "test-without-building",
        "-project",
        "WebDriverAgent.xcodeproj",
        "-scheme",
        "WebDriverAgentRunner",
        "-destination",
        `platform=iOS Simulator,id=${deviceId}`,
      ],
      {
        cwd: wdaPath,
        env: {
          ...process.env,
          USE_PORT: port.toString(),
        },
        stdio: "pipe",
      }
    );

    this.instances.set(deviceId, {
      pid: wdaProcess.pid!,
      port,
      deviceId,
    });

    const MAX_OUTPUT_CHARS = 50_000;
    let output = "";
    let lastSignificantLine = "";
    const launchStart = Date.now();
    const appendOutput = (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;
      if (output.length > MAX_OUTPUT_CHARS) {
        output = output.slice(output.length - MAX_OUTPUT_CHARS);
      }
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length > 0) lastSignificantLine = trimmed;
      }
    };
    wdaProcess.stdout?.on("data", appendOutput);
    wdaProcess.stderr?.on("data", appendOutput);

    const heartbeat = setInterval(() => {
      const elapsed = Math.round((Date.now() - launchStart) / 1000);
      const preview = lastSignificantLine.slice(0, 200);
      console.error(`  [wda launch] ${elapsed}s — ${preview}`);
    }, 5_000);

    wdaProcess.on("exit", (code) => {
      clearInterval(heartbeat);
      this.instances.delete(deviceId);
      this.clients.delete(deviceId);
    });

    const startTime = Date.now();
    while (Date.now() - startTime < this.startupTimeout) {
      try {
        const health = await this.checkHealth(port);
        if (health) {
          clearInterval(heartbeat);
          return;
        }
      } catch {
        // Continue waiting
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    clearInterval(heartbeat);
    try {
      process.kill(wdaProcess.pid!);
    } catch {}

    throw new Error(
      "WebDriverAgent failed to start within 30s.\n\n" +
        "Troubleshooting:\n" +
        "1. Check simulator is running: xcrun simctl list | grep Booted\n" +
        "2. Check logs: ~/Library/Logs/CoreSimulator/" +
        deviceId +
        "/system.log\n" +
        "3. Try manual launch to see errors:\n" +
        `   cd ${wdaPath}\n` +
        "   xcodebuild test -project WebDriverAgent.xcodeproj \\\n" +
        "     -scheme WebDriverAgentRunner \\\n" +
        `     -destination 'platform=iOS Simulator,id=${deviceId}'\n\n` +
        `Last output:\n${output.slice(-500)}`
    );
  }

  /**
   * Launch WDA on a PHYSICAL device. Unlike the simulator path we use
   * `xcodebuild test` (build+sign+install+run in one shot, automatic
   * provisioning) targeting the device destination, then forward the device's
   * WDA port to a local port via go-ios so the localhost WDAClient is unchanged.
   */
  private async launchWDADevice(
    wdaPath: string,
    udid: string,
    localPort: number
  ): Promise<void> {
    const existingInstance = this.instances.get(udid);
    if (existingInstance) {
      try {
        process.kill(existingInstance.pid, 0);
        this.ensureForward(udid, localPort);
        return;
      } catch {
        this.instances.delete(udid);
      }
    }

    const teamId = this.resolveTeamId();
    if (!teamId) {
      throw new Error(
        "No Apple Development team found for signing WebDriverAgent on a " +
          "physical device. Set IOS_TEAM_ID, or sign in to Xcode with an " +
          "Apple ID that has a development certificate."
      );
    }

    // The stock runner bundle id `com.facebook.WebDriverAgentRunner` belongs to
    // Facebook and cannot be provisioned under another team. Override it with a
    // team-unique id for physical signing (WDA_BUNDLE_ID), defaulting to one
    // derived from the team so automatic provisioning can register it.
    const bundleId = process.env.WDA_BUNDLE_ID ?? `com.${teamId}.WebDriverAgentRunner`;

    const wdaProcess = spawn(
      "xcodebuild",
      [
        "test",
        "-project",
        "WebDriverAgent.xcodeproj",
        "-scheme",
        "WebDriverAgentRunner",
        "-destination",
        `platform=iOS,id=${udid}`,
        "-allowProvisioningUpdates",
        `DEVELOPMENT_TEAM=${teamId}`,
        "CODE_SIGN_STYLE=Automatic",
        `PRODUCT_BUNDLE_IDENTIFIER=${bundleId}`,
      ],
      {
        cwd: wdaPath,
        env: { ...process.env, USE_PORT: DEVICE_WDA_PORT.toString() },
        stdio: "pipe",
      }
    );

    this.instances.set(udid, { pid: wdaProcess.pid!, port: localPort, deviceId: udid });

    const MAX_OUTPUT_CHARS = 50_000;
    let output = "";
    const appendOutput = (data: Buffer) => {
      output += data.toString();
      if (output.length > MAX_OUTPUT_CHARS) {
        output = output.slice(output.length - MAX_OUTPUT_CHARS);
      }
    };
    let buildExited = false;
    wdaProcess.stdout?.on("data", appendOutput);
    wdaProcess.stderr?.on("data", appendOutput);
    wdaProcess.on("exit", () => {
      buildExited = true;
      this.instances.delete(udid);
      this.clients.delete(udid);
      this.stopForward(udid);
    });

    // Forward device WDA port -> local port so localhost WDAClient works.
    this.ensureForward(udid, localPort);

    const startTime = Date.now();
    while (Date.now() - startTime < this.deviceStartupTimeout) {
      try {
        if (await this.checkHealth(localPort)) return;
      } catch {
        // keep waiting through the build
      }
      // Fail fast: if xcodebuild died (e.g. a signing error) there is nothing
      // left to wait for — don't burn the full device timeout.
      if (buildExited) break;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    try {
      process.kill(wdaProcess.pid!);
    } catch {}
    this.stopForward(udid);

    const reason = buildExited
      ? "the xcodebuild test process exited before WebDriverAgent came up"
      : `WebDriverAgent did not come up within ${this.deviceStartupTimeout / 1000}s`;
    throw new Error(
      `Failed to start WebDriverAgent on the physical device: ${reason}.\n\n` +
        "Troubleshooting:\n" +
        "1. Sign in to Xcode with the Apple ID for your team in Xcode > " +
        "Settings > Accounts (automatic provisioning needs an account, not " +
        "just a keychain certificate).\n" +
        "2. Set a team-unique WDA bundle id if signing the stock one fails: " +
        "export WDA_BUNDLE_ID=com.<you>.WebDriverAgentRunner\n" +
        "3. Enable Developer Mode on the device (Settings > Privacy & " +
        "Security > Developer Mode) and trust this Mac.\n" +
        "4. On iOS 17+, port-forward may need the go-ios tunnel: " +
        "`sudo ios tunnel start` (or ENABLE_GO_IOS_AGENT=user).\n\n" +
        `Last output:\n${output.slice(-800)}`
    );
  }

  /** Start (idempotently) an `ios forward localPort -> DEVICE_WDA_PORT`. */
  private ensureForward(udid: string, localPort: number): void {
    if (this.forwards.has(udid)) return;
    const fwd = spawn(
      GO_IOS_BIN,
      ["forward", "--udid", udid, localPort.toString(), DEVICE_WDA_PORT.toString()],
      { stdio: ["ignore", "ignore", "ignore"] }
    );
    fwd.on("exit", () => this.forwards.delete(udid));
    this.forwards.set(udid, fwd);
  }

  private stopForward(udid: string): void {
    const fwd = this.forwards.get(udid);
    if (fwd) {
      try {
        fwd.kill();
      } catch {}
      this.forwards.delete(udid);
    }
  }

  /** Team ID for signing: explicit env wins, else first codesigning identity. */
  private resolveTeamId(): string | undefined {
    if (process.env.IOS_TEAM_ID) return process.env.IOS_TEAM_ID;
    if (process.env.WDA_TEAM_ID) return process.env.WDA_TEAM_ID;
    try {
      const out = execSync("security find-identity -v -p codesigning", {
        encoding: "utf-8",
        timeout: 5000,
      });
      const match = out.match(/\(([A-Z0-9]{10})\)/);
      return match?.[1];
    } catch {
      return undefined;
    }
  }

  private async checkHealth(port: number): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`http://localhost:${port}/status`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      return response.ok;
    } catch {
      return false;
    }
  }

  private async findFreePort(): Promise<number> {
    const { createServer } = await import("net");

    for (let port = 8100; port < 8200; port++) {
      try {
        await new Promise<void>((resolve, reject) => {
          const server = createServer();
          server.once("error", reject);
          server.once("listening", () => {
            server.close(() => resolve());
          });
          server.listen(port);
        });
        return port;
      } catch {
        continue;
      }
    }

    throw new Error("No free ports available in range 8100-8200");
  }

  cleanup(): void {
    for (const [deviceId, instance] of this.instances) {
      try {
        process.kill(instance.pid);
      } catch {}
      const client = this.clients.get(deviceId);
      if (client) {
        client.deleteSession().catch(() => {});
      }
    }
    for (const udid of [...this.forwards.keys()]) {
      this.stopForward(udid);
    }
    this.instances.clear();
    this.clients.clear();
  }
}
