import { describe, expect, it, vi } from "vitest";

import { AndroidAdapter } from "./android-adapter.js";
import type { AdbClient } from "./adb/client.js";
import { AndroidPlugin } from "./index.js";

describe("Android resource disposal", () => {
  it("cleans a created WebView inspector exactly once", () => {
    const client = { getDeviceId: () => undefined } as unknown as AdbClient;
    const adapter = new AndroidAdapter(client);
    const cleanup = vi.fn();
    Object.assign(adapter, { _webViewInspector: { cleanup } });

    adapter.dispose();
    adapter.dispose();

    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("delegates plugin disposal to its adapter", () => {
    const adapter = { dispose: vi.fn() } as unknown as AndroidAdapter;
    const plugin = new AndroidPlugin(adapter);

    plugin.dispose();

    expect(adapter.dispose).toHaveBeenCalledOnce();
  });
});
