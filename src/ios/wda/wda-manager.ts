import { execSync, spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { WDAClient } from "./wda-client.js";
import { WDAInstanceInfo } from "./wda-types.js";

export class WDAManager {
  private instances: Map<string, WDAInstanceInfo> = new Map();
  private clients: Map<string, WDAClient> = new Map();
  /** Deduplicates parallel launches for the same device */
  private launchPromises: Map<string, Promise<WDAClient>> = new Map();
  private readonly startupTimeout = 30000;
  private readonly buildTimeout = 120000;

  async ensureWDAReady(deviceId: string): Promise<WDAClient> {
    // Check existing client
    if (this.clients.has(deviceId)) {
      const client = this.clients.get(deviceId)!;
      try {
        await client.ensureSession(deviceId);
        return client;
      } catch (error: any) {
        console.error("WDA client failed, relaunching:", error.message);
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

    const launchPromise = this.doLaunch(deviceId);
    this.launchPromises.set(deviceId, launchPromise);

    try {
      return await launchPromise;
    } finally {
      this.launchPromises.delete(deviceId);
    }
  }

  private async doLaunch(deviceId: string): Promise<WDAClient> {
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
    await this.buildWDAIfNeeded(wdaPath);
    const port = await this.findFreePort();
    await this.launchWDA(wdaPath, deviceId, port);

    const client = new WDAClient(port);
    await client.ensureSession(deviceId);

    this.clients.set(deviceId, client);

    return client;
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

    console.error("Building WebDriverAgent for first use (~2-5 min)...");

    const destination = this.resolveSimulatorDestination();
    if (!destination) {
      throw new Error(
        "No iOS simulator available for WebDriverAgent build.\n\n" +
          "Open Xcode → Window → Devices and Simulators and add an iPhone simulator."
      );
    }

    try {
      execSync(
        "xcodebuild build-for-testing " +
          "-project WebDriverAgent.xcodeproj " +
          "-scheme WebDriverAgentRunner " +
          `"-destination" "${destination}" ` +
          "CODE_SIGNING_ALLOWED=NO",
        {
          cwd: wdaPath,
          timeout: this.buildTimeout,
          stdio: "pipe",
        }
      );
    } catch (error: any) {
      throw new Error(
        "Failed to build WebDriverAgent.\n\n" +
          `${error.stderr?.toString() || error.stdout?.toString() || error.message}\n\n` +
          "Troubleshooting:\n" +
          "1. Install Xcode: https://apps.apple.com/app/xcode/id497799835\n" +
          "2. Install command line tools: xcode-select --install\n" +
          "3. Accept license: sudo xcodebuild -license accept\n" +
          "4. Set Xcode path: sudo xcode-select -s /Applications/Xcode.app"
      );
    }
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
    const appendOutput = (data: Buffer) => {
      output += data.toString();
      if (output.length > MAX_OUTPUT_CHARS) {
        output = output.slice(output.length - MAX_OUTPUT_CHARS);
      }
    };
    wdaProcess.stdout?.on("data", appendOutput);
    wdaProcess.stderr?.on("data", appendOutput);

    wdaProcess.on("exit", (code) => {
      this.instances.delete(deviceId);
      this.clients.delete(deviceId);
    });

    const startTime = Date.now();
    while (Date.now() - startTime < this.startupTimeout) {
      try {
        const health = await this.checkHealth(port);
        if (health) {
          return;
        }
      } catch {
        // Continue waiting
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

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
    this.instances.clear();
    this.clients.clear();
  }
}
