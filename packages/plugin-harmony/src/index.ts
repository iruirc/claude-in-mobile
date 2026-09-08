import type {
  PluginContext,
  PluginManifest,
  SourcePlugin,
  ToolDefinition,
} from "@mcp-devices/plugin-api";

import { HarmonyAdapter } from "./harmony-adapter.js";

const TOOL_NAMES = ["harmony_launch_ability"] as const;

export const HARMONY_PLUGIN_MANIFEST: PluginManifest = {
  id: "harmony",
  name: "HarmonyOS Next",
  version: "4.2.0",
  apiVersion: "1",
  capabilities: [
    "screen",
    "input",
    "ui",
    "shell",
    "appLifecycle",
    "logs",
    "fileTransfer",
    "deviceMgmt",
  ],
  tools: TOOL_NAMES,
  description:
    "HarmonyOS Next automation via HDC and ArkXTest (screen, input, UI, apps, shell, logs, files)",
};

interface HarmonyToolArgs {
  deviceId?: string;
  bundleId?: string;
  ability?: string;
  moduleName?: string;
}

function toolArgs(value: unknown): HarmonyToolArgs {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Harmony tool arguments must be an object");
  }
  const args: HarmonyToolArgs = {};
  for (const key of ["deviceId", "bundleId", "ability", "moduleName"] as const) {
    const field = Reflect.get(value, key);
    if (field !== undefined && typeof field !== "string") {
      throw new TypeError(`${key} must be a string`);
    }
    if (typeof field === "string") args[key] = field;
  }
  return args;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new TypeError(`${name} is required`);
  return value;
}

export class HarmonyPlugin implements SourcePlugin {
  readonly manifest = HARMONY_PLUGIN_MANIFEST;
  readonly adapter: HarmonyAdapter;

  constructor(adapter: HarmonyAdapter = new HarmonyAdapter()) {
    this.adapter = adapter;
  }

  init(ctx: PluginContext): void {
    for (const definition of this.toolDefinitions()) ctx.registerTool(definition);
  }

  private toolDefinitions(): ToolDefinition[] {
    return [
      {
        name: "harmony_launch_ability",
        description:
          "Launch a HarmonyOS ability with an optional module name. Defaults to EntryAbility.",
        inputSchema: {
          type: "object",
          required: ["bundleId"],
          properties: {
            bundleId: { type: "string", description: "HarmonyOS bundle name" },
            ability: { type: "string", default: "EntryAbility" },
            moduleName: {
              type: "string",
              description: "Optional HAP module name, for example entry",
            },
            deviceId: { type: "string" },
          },
        },
        handler: async (value) => {
          const args = toolArgs(value);
          return {
            message: this.adapter.launchAbility(
              required(args.bundleId, "bundleId"),
              args.ability ?? "EntryAbility",
              args.moduleName,
              args.deviceId,
            ),
          };
        },
      },
    ];
  }
}

export function createHarmonyPlugin(): SourcePlugin {
  return new HarmonyPlugin();
}

export { HdcClient } from "./client.js";
export { HarmonyAdapter } from "./harmony-adapter.js";
export const createPlugin = createHarmonyPlugin;
export default createHarmonyPlugin;
