import type { ToolDefinition } from "./registry.js";
import { defineTool, z } from "./define-tool.js";
import { platformEnum, deviceIdField } from "./common-schema.js";
import { validatePackageName, validatePath } from "../utils/sanitize.js";
import { parseCommonArgs } from "../utils/parse-common-args.js";
import { textResult } from "../utils/tool-result.js";
import { sleep } from "../utils/sleep.js";

const commonFields = {
  platform: platformEnum,
  deviceId: deviceIdField,
} as const;

export const appTools: ToolDefinition[] = [
  defineTool({
    name: "app_launch",
    description: "Launch app by package name or bundle ID",
    schema: z.object({
      package: z
        .string()
        .describe(
          "App package or bundle ID (Android/iOS/HarmonyOS), e.g., com.android.settings or com.example.demo",
        ),
      ...commonFields,
    }),
    handler: async (args, ctx) => {
      const { deviceId, platform } = parseCommonArgs(args as Record<string, unknown>, ctx);
      validatePackageName(args.package);
      const result = await ctx.deviceManager.launchApp(args.package, platform, deviceId);
      return textResult(result);
    },
  }),

  defineTool({
    name: "app_stop",
    description: "Force stop an app",
    schema: z.object({
      package: z.string().describe("App package or bundle ID (Android/iOS/HarmonyOS)"),
      ...commonFields,
    }),
    handler: async (args, ctx) => {
      const { deviceId, platform } = parseCommonArgs(args as Record<string, unknown>, ctx);
      validatePackageName(args.package);
      ctx.deviceManager.stopApp(args.package, platform, deviceId);
      return textResult(`Stopped: ${args.package}`);
    },
  }),

  defineTool({
    name: "app_install",
    description: "Install APK (Android), .app bundle (iOS), RPM (Aurora), or HAP (HarmonyOS)",
    schema: z.object({
      path: z.string().describe("Path to APK, .app bundle, RPM, or HAP"),
      ...commonFields,
    }),
    handler: async (args, ctx) => {
      const { deviceId, platform } = parseCommonArgs(args as Record<string, unknown>, ctx);
      validatePath(args.path, "install_path");
      const result = ctx.deviceManager.installApp(args.path, platform, deviceId);
      return textResult(result);
    },
  }),

  defineTool({
    name: "app_restart",
    description:
      "Force-stop then re-launch an app. Common pattern for clearing in-memory state without uninstall.",
    schema: z.object({
      package: z.string().describe("App package or bundle ID (Android/iOS/HarmonyOS)"),
      delayMs: z
        .number()
        .default(500)
        .describe(
          "Delay between stop and launch in ms (default: 500). Useful so OS releases resources.",
        ),
      ...commonFields,
    }),
    handler: async (args, ctx) => {
      const { deviceId, platform } = parseCommonArgs(args as Record<string, unknown>, ctx);
      validatePackageName(args.package);
      const delayMs = Math.max(0, Math.min(args.delayMs, 10_000));

      ctx.deviceManager.stopApp(args.package, platform, deviceId);
      if (delayMs > 0) {
        await sleep(delayMs);
      }
      const launchResult = await ctx.deviceManager.launchApp(args.package, platform, deviceId);
      return textResult(`Restarted: ${args.package} (delay=${delayMs}ms). ${launchResult}`);
    },
  }),

  defineTool({
    name: "app_uninstall",
    description: "Uninstall an app by package name or bundle ID",
    schema: z.object({
      package: z.string().describe("App package or bundle ID"),
      ...commonFields,
    }),
    handler: async (args, ctx) => {
      const { deviceId, platform } = parseCommonArgs(args as Record<string, unknown>, ctx);
      validatePackageName(args.package);
      const result = await ctx.deviceManager.uninstallApp(args.package, platform, deviceId);
      return textResult(result);
    },
  }),

  defineTool({
    name: "app_list",
    description: "List installed apps on a platform with app inventory support",
    schema: z.object(commonFields),
    handler: async (args, ctx) => {
      const { deviceId, platform } = parseCommonArgs(args as Record<string, unknown>, ctx);
      const packages = await ctx.deviceManager.listApps(platform, deviceId);
      const body = packages.length > 0 ? packages.join("\n") : "(none)";
      return textResult(`Installed apps (${packages.length}):\n${body}`);
    },
  }),
];
