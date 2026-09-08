import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { HdcClient, type HdcExecutor } from "./client.js";

interface RecordedCall {
  binary: string;
  args: string[];
}

function fakeHdc(
  calls: RecordedCall[],
  response: (args: readonly string[]) => string = () => "",
): HdcExecutor {
  return (binary, args) => {
    calls.push({ binary, args: [...args] });
    const recvIndex = args.findIndex((arg, index) => arg === "recv" && args[index - 1] === "file");
    if (recvIndex !== -1) {
      const localPath = args[recvIndex + 2];
      const remotePath = args[recvIndex + 1];
      if (localPath && remotePath) {
        const content = remotePath.endsWith(".json")
          ? JSON.stringify({ attributes: { type: "Button", text: "Continue", bounds: "[0,0][100,40]" } })
          : Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        writeFileSync(localPath, content);
      }
    }
    return response(args);
  };
}

describe("HdcClient", () => {
  it("parses verbose HDC targets", () => {
    const calls: RecordedCall[] = [];
    const client = new HdcClient({
      hdcPath: "/sdk/hdc",
      executor: fakeHdc(calls, () => [
        "ABC123 USB Connected Mate60 hdc",
        "127.0.0.1:5555 TCP Offline localhost hdc",
      ].join("\n")),
    });

    expect(client.listDevices()).toEqual([
      {
        id: "ABC123",
        name: "Mate60",
        platform: "harmony",
        state: "connected",
        isSimulator: false,
        connection: "USB",
      },
      {
        id: "127.0.0.1:5555",
        name: "127.0.0.1:5555",
        platform: "harmony",
        state: "offline",
        isSimulator: false,
        connection: "TCP",
      },
    ]);
    expect(calls[0]).toEqual({
      binary: "/sdk/hdc",
      args: ["list", "targets", "-v"],
    });
  });

  it("routes an explicit device without mutating the selected target", () => {
    const calls: RecordedCall[] = [];
    const client = new HdcClient({ executor: fakeHdc(calls), deviceId: "selected" });

    client.tap(12, 34, "explicit");

    expect(client.getDeviceId()).toBe("selected");
    expect(calls[0]?.args).toEqual([
      "-t", "explicit", "shell", "uitest", "uiInput", "click", "12", "34",
    ]);
  });

  it("translates gesture durations and common key names to ArkXTest arguments", () => {
    const calls: RecordedCall[] = [];
    const client = new HdcClient({ executor: fakeHdc(calls), deviceId: "phone" });

    client.swipe(0, 0, 600, 0, 300);
    client.longPress(10, 20, 1_500);
    client.pressKey("ENTER");
    client.pressKey("back");

    expect(calls.map((call) => call.args)).toEqual([
      ["-t", "phone", "shell", "uitest", "uiInput", "swipe", "0", "0", "600", "0", "2000"],
      ["-t", "phone", "shell", "uitest", "uiInput", "longClick", "10", "20", "1500"],
      ["-t", "phone", "shell", "uitest", "uiInput", "keyEvent", "2054"],
      ["-t", "phone", "shell", "uitest", "uiInput", "keyEvent", "Back"],
    ]);
    expect(() => client.pressKey("not-a-key")).toThrow("Unknown HarmonyOS key");
  });

  it("captures PNG and layout through device temp files", () => {
    const calls: RecordedCall[] = [];
    const client = new HdcClient({ executor: fakeHdc(calls), deviceId: "phone" });

    expect(client.screenshotRaw()).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(JSON.parse(client.getUiHierarchy())).toMatchObject({
      attributes: { type: "Button", text: "Continue" },
    });
    expect(calls.some((call) => call.args.includes("screenCap"))).toBe(true);
    expect(calls.some((call) => call.args.includes("dumpLayout"))).toBe(true);
    expect(calls.filter((call) => call.args.includes("recv"))).toHaveLength(2);
    expect(calls.filter((call) => call.args.includes("rm"))).toHaveLength(2);
  });

  it("launches default, explicit, and module-qualified abilities", () => {
    const calls: RecordedCall[] = [];
    const client = new HdcClient({ executor: fakeHdc(calls) });

    client.launchApp("com.example.demo", "phone");
    client.launchApp("com.example.demo/SettingsAbility", "phone");
    client.launchAbility("com.example.demo", "MainAbility", "entry", "phone");

    expect(calls.map((call) => call.args)).toEqual([
      ["-t", "phone", "shell", "aa", "start", "-b", "com.example.demo", "-a", "EntryAbility"],
      ["-t", "phone", "shell", "aa", "start", "-b", "com.example.demo", "-a", "SettingsAbility"],
      ["-t", "phone", "shell", "aa", "start", "-b", "com.example.demo", "-a", "MainAbility", "-m", "entry"],
    ]);
  });

  it("opens URLs through AA without device-shell interpolation", () => {
    const calls: RecordedCall[] = [];
    const client = new HdcClient({ executor: fakeHdc(calls) });

    client.openUrl("https://example.com/path?a=1&b=2", "phone");

    expect(calls[0]?.args).toEqual([
      "-t", "phone", "shell", "aa", "start",
      "-A", "ohos.want.action.viewData",
      "-U", "https://example.com/path?a=1&b=2",
    ]);
  });

  it("returns a bounded filtered HiLog snapshot", () => {
    const calls: RecordedCall[] = [];
    const client = new HdcClient({
      executor: fakeHdc(calls, () => [
        "I Demo first",
        "E Other failure",
        "E Demo second",
      ].join("\n")),
    });

    expect(client.getLogs({ level: "E", tag: "Demo", lines: 1 })).toBe("E Demo second");
    expect(calls[0]?.args).toEqual(["hilog", "-x"]);
  });

  it("reports a missing HDC binary with an actionable error", () => {
    const missing: HdcExecutor = () => {
      const error = new Error("spawn ENOENT");
      Object.assign(error, { code: "ENOENT" });
      throw error;
    };
    const client = new HdcClient({ hdcPath: "/missing/hdc", executor: missing });

    expect(() => client.listDevices()).toThrow("set HDC_PATH");
  });
});
