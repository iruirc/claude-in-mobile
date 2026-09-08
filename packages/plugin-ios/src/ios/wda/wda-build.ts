/**
 * Filesystem probes for the WebDriverAgent build. No process spawning.
 */

import * as fs from "fs";
import * as path from "path";

const RUNNER_APP = "WebDriverAgentRunner-Runner.app";

/**
 * DerivedData carries the only reliable evidence that xcodebuild has produced a
 * runner. The `build/` directory inside the appium-webdriveragent package does
 * not: npm ships it as that package's TypeScript output, so it is always there.
 */
export function findRunnerApp(derivedDataRoot: string): string | undefined {
  for (const entry of readdirOrEmpty(derivedDataRoot)) {
    if (!entry.startsWith("WebDriverAgent-")) continue;
    const products = path.join(derivedDataRoot, entry, "Build", "Products");
    for (const config of readdirOrEmpty(products)) {
      const app = path.join(products, config, RUNNER_APP);
      if (fs.existsSync(app)) return app;
    }
  }
  return undefined;
}

function readdirOrEmpty(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
