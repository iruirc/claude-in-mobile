import type { ToolDefinition } from "./registry.js";
import { defineTool, z } from "./define-tool.js";
import { platformEnum, deviceIdField, coordsField } from "./common-schema.js";
import { ValidationError } from "../errors.js";
import { resolveElementCoordinates, mapToDevice, describeMapping } from "./helpers/resolve-element.js";
import type { CoordinateSpace } from "./helpers/resolve-element.js";
import type { ToolContext } from "./context.js";
import { parseCommonArgs } from "../utils/parse-common-args.js";
import { textResult } from "../utils/tool-result.js";

export const interactionTools: ToolDefinition[] = [
  defineTool({
    name: "input_tap",
    description:
      "Tap by coordinates, text, resourceId, label, or element index.\n\n" +
      "COORDINATE SPACE: raw x/y are interpreted in the pixel space of the **last screenshot captured of this device** " +
      "and auto-scaled to device coordinates before dispatch — read them off the latest capture: after switching " +
      "preset, coordinates from an older image land elsewhere. If this device has no screenshot yet, x/y are " +
      "treated as device coords. Coordinates from ui(action:'find') and ui(action:'tree') are device coordinates " +
      "(Android pixels or iOS points): pass them with coords:'device'. The result names the space used and, for " +
      "screenshot space, the x/y given and the screenshot size. " +
      "Prefer label/text/resourceId/index selectors for UI-tree-sourced interactions.",
    schema: z.object({
      x: z.number().optional().describe("X coordinate (space set by coords — see tool description)"),
      y: z.number().optional().describe("Y coordinate (space set by coords — see tool description)"),
      text: z.string().optional().describe("Android/HarmonyOS: Element text. iOS: Element name (less reliable than label)"),
      label: z.string().optional().describe("iOS only: Accessibility label (most reliable)"),
      resourceId: z.string().optional().describe("Find element with this resource ID and tap it (Android/HarmonyOS)"),
      index: z.number().optional().describe("Tap element by index from ui(action:'tree') output (Android/HarmonyOS)"),
      targetPid: z.number().optional().describe("Desktop only: PID of target process. When provided, sends tap without stealing window focus."),
      hints: z.boolean().default(true).describe("Return hints about what changed after the action (new/gone elements, suggestions). Eliminates need for follow-up screen(action:'capture')/ui(action:'tree')."),
      coords: coordsField,
      platform: platformEnum,
      deviceId: deviceIdField,
    }),
    handler: async (args, ctx) => {
      const { deviceId, platform: currentPlatform } = parseCommonArgs(args as Record<string, unknown>, ctx);
      const platform = args.platform;

      const resolved = await resolveElementCoordinates(
        args as Record<string, unknown>,
        ctx,
        currentPlatform,
        deviceId,
      );

      if (!resolved) {
        throw new ValidationError("Please provide x,y coordinates, text, resourceId, label, or index.");
      }

      if (resolved.iosTapDone) {
        if (resolved.elementId) {
          const iosClient = ctx.deviceManager.getIosClient(deviceId);
          await iosClient.tapElement(resolved.elementId);
        }
        let result = `Tapped element: ${resolved.description}`;
        if (args.hints) {
          result += await ctx.generateActionHints(args.platform);
        }
        return textResult(result);
      }

      const { x, y, mapping } = await toDevice(resolved, args.coords, currentPlatform, ctx, deviceId);

      await ctx.deviceManager.tap(x, y, platform, args.targetPid, deviceId);
      ctx.invalidateUiTreeCache(currentPlatform ?? undefined);
      let result = `Tapped at (${x}, ${y})${mapping}`;
      if (args.hints) {
        result += await ctx.generateActionHints(args.platform);
      }
      return textResult(result);
    },
  }),

  defineTool({
    name: "input_double_tap",
    description:
      "Double tap by coordinates, text, resourceId, or index. Raw x/y are screenshot-space and auto-scaled to device coordinates unless coords:'device' — see input_tap description for full coordinate space rules.",
    schema: z.object({
      x: z.number().optional().describe("X coordinate (space set by coords)"),
      y: z.number().optional().describe("Y coordinate (space set by coords)"),
      text: z.string().optional().describe("Find element by text and double tap it (Android/HarmonyOS)"),
      resourceId: z.string().optional().describe("Find element with this resource ID and double tap it (Android/HarmonyOS)"),
      index: z.number().optional().describe("Double tap element by index from ui(action:'tree') output (Android/HarmonyOS)"),
      interval: z.number().default(100).describe("Delay between taps in milliseconds (default: 100)"),
      hints: z.boolean().default(true).describe("Return hints about what changed after the action."),
      coords: coordsField,
      platform: platformEnum,
      deviceId: deviceIdField,
    }),
    handler: async (args, ctx) => {
      const { deviceId, platform: currentPlatform } = parseCommonArgs(args as Record<string, unknown>, ctx);
      const platform = args.platform;
      const interval = args.interval;

      const resolved = await resolveElementCoordinates(
        args as Record<string, unknown>,
        ctx,
        currentPlatform,
        deviceId,
      );

      if (!resolved) {
        throw new ValidationError("Please provide x,y coordinates, text, resourceId, or index.");
      }

      const { x, y, mapping } = await toDevice(resolved, args.coords, currentPlatform, ctx, deviceId);

      await ctx.deviceManager.doubleTap(x, y, interval, platform, deviceId);
      let result = `Double tapped at (${x}, ${y}) with ${interval}ms interval${mapping}`;
      if (args.hints) {
        result += await ctx.generateActionHints(args.platform);
      }
      return textResult(result);
    },
  }),

  defineTool({
    name: "input_long_press",
    description:
      "Long press at coordinates or on element by text/label. Raw x/y are screenshot-space and auto-scaled to device coordinates unless coords:'device' — see input_tap description for full coordinate space rules.",
    schema: z.object({
      x: z.number().optional().describe("X coordinate (space set by coords)"),
      y: z.number().optional().describe("Y coordinate (space set by coords)"),
      label: z.string().optional().describe("iOS only: Accessibility label (most reliable)"),
      text: z.string().optional().describe("Find element by text (Android/HarmonyOS)"),
      duration: z.number().default(1000).describe("Duration in milliseconds (default: 1000)"),
      coords: coordsField,
      platform: platformEnum,
      deviceId: deviceIdField,
    }),
    handler: async (args, ctx) => {
      const { deviceId, platform: currentPlatform } = parseCommonArgs(args as Record<string, unknown>, ctx);
      const platform = args.platform;
      const duration = args.duration;

      const resolved = await resolveElementCoordinates(
        args as Record<string, unknown>,
        ctx,
        currentPlatform,
        deviceId,
      );

      if (!resolved) {
        throw new ValidationError("Please provide x,y coordinates, text, or label.");
      }

      if (resolved.iosTapDone) {
        if (resolved.elementId) {
          const iosClient = ctx.deviceManager.getIosClient(deviceId);
          const rect = await iosClient.getElementRect(resolved.elementId);
          if (rect) {
            const cx = Math.round(rect.x + rect.width / 2);
            const cy = Math.round(rect.y + rect.height / 2);
            await ctx.deviceManager.longPress(cx, cy, duration, platform, deviceId);
            return textResult(`Long pressed element: ${resolved.description} at (${cx}, ${cy}) for ${duration}ms`);
          }
        }
        throw new ValidationError(`Could not resolve coordinates for element: ${resolved.description}`);
      }

      const { x, y, mapping } = await toDevice(resolved, args.coords, currentPlatform, ctx, deviceId);

      await ctx.deviceManager.longPress(x, y, duration, platform, deviceId);
      return textResult(`Long pressed at (${x}, ${y}) for ${duration}ms${mapping}`);
    },
  }),

  defineTool({
    name: "input_swipe",
    description:
      "Swipe by direction or custom coordinates. Raw x1/y1/x2/y2 are screenshot-space and auto-scaled to device coordinates unless coords:'device' — see input_tap description for full coordinate space rules.",
    schema: z.object({
      direction: z
        .enum(["up", "down", "left", "right"])
        .optional()
        .describe("Swipe direction"),
      x1: z.number().optional().describe("Start X (space set by coords)"),
      y1: z.number().optional().describe("Start Y (space set by coords)"),
      x2: z.number().optional().describe("End X (space set by coords)"),
      y2: z.number().optional().describe("End Y (space set by coords)"),
      duration: z.number().default(300).describe("Duration in ms (default: 300)"),
      hints: z.boolean().default(true).describe("Return hints about what changed after the action."),
      coords: coordsField,
      platform: platformEnum,
      deviceId: deviceIdField,
    }),
    handler: async (args, ctx) => {
      const { deviceId, platform: currentPlatform } = parseCommonArgs(args as Record<string, unknown>, ctx);
      const platform = args.platform;
      const direction = args.direction;

      if (direction) {
        await ctx.deviceManager.swipeDirection(direction, platform, deviceId);
        ctx.invalidateUiTreeCache(platform ?? ctx.deviceManager.getCurrentPlatform() ?? undefined);
        let result = `Swiped ${direction}`;
        if (args.hints) {
          result += await ctx.generateActionHints(args.platform);
        }
        return textResult(result);
      }

      const x1 = args.x1;
      const y1 = args.y1;
      const x2 = args.x2;
      const y2 = args.y2;

      if (x1 !== undefined && y1 !== undefined &&
          x2 !== undefined && y2 !== undefined) {
        const duration = args.duration;
        const p1 = await mapToDevice(x1, y1, currentPlatform ?? undefined, ctx, deviceId, args.coords);
        const p2 = await mapToDevice(x2, y2, currentPlatform ?? undefined, ctx, deviceId, args.coords);
        await ctx.deviceManager.swipe(p1.x, p1.y, p2.x, p2.y, duration, platform, deviceId);
        ctx.invalidateUiTreeCache(currentPlatform ?? undefined);
        const mapping = describeMapping(currentPlatform ?? undefined, [
          { raw: { x: x1, y: y1 }, mapped: p1 },
          { raw: { x: x2, y: y2 }, mapped: p2 },
        ], args.coords);
        let result = `Swiped from (${p1.x}, ${p1.y}) to (${p2.x}, ${p2.y})${mapping}`;
        if (args.hints) {
          result += await ctx.generateActionHints(args.platform);
        }
        return textResult(result);
      }

      throw new ValidationError("Please provide direction or x1,y1,x2,y2 coordinates.");
    },
  }),

  defineTool({
    name: "input_drag",
    description:
      "iOS only: press and hold at x1/y1, then drag to x2/y2 without lifting — the gesture that picks up and moves an item " +
      "(a timeline clip, a home-screen icon) where swipe would scroll and long_press would open a menu. " +
      "x1/y1/x2/y2 are screenshot-space like input_swipe and auto-scaled unless coords:'device'.",
    schema: z.object({
      x1: z.number().describe("Start X (space set by coords)"),
      y1: z.number().describe("Start Y (space set by coords)"),
      x2: z.number().describe("End X (space set by coords)"),
      y2: z.number().describe("End Y (space set by coords)"),
      hold: z.number().min(0).default(600).describe("How long to hold still at the start before moving, ms (default: 600)"),
      duration: z.number().min(0).default(500).describe("Duration of the movement in ms (default: 500)"),
      hints: z.boolean().default(true).describe("Return hints about what changed after the action."),
      coords: coordsField,
      platform: platformEnum,
      deviceId: deviceIdField,
    }),
    handler: async (args, ctx) => {
      const { deviceId, platform: currentPlatform } = parseCommonArgs(args as Record<string, unknown>, ctx);
      if (currentPlatform !== "ios") {
        throw new ValidationError("input(action:'drag') is supported on iOS only.");
      }
      const iosClient = ctx.deviceManager.getIosClient(deviceId);
      if (typeof iosClient.drag !== "function") {
        throw new ValidationError("The installed iOS plugin does not support drag.");
      }

      const p1 = await mapToDevice(args.x1, args.y1, currentPlatform, ctx, deviceId, args.coords);
      const p2 = await mapToDevice(args.x2, args.y2, currentPlatform, ctx, deviceId, args.coords);
      await iosClient.drag(p1.x, p1.y, p2.x, p2.y, args.hold, args.duration, deviceId);
      ctx.invalidateUiTreeCache(currentPlatform);
      const mapping = describeMapping(currentPlatform, [
        { raw: { x: args.x1, y: args.y1 }, mapped: p1 },
        { raw: { x: args.x2, y: args.y2 }, mapped: p2 },
      ], args.coords);
      let result = `Dragged from (${p1.x}, ${p1.y}) to (${p2.x}, ${p2.y}) after a ${args.hold}ms hold${mapping}`;
      if (args.hints) {
        result += await ctx.generateActionHints(args.platform);
      }
      return textResult(result);
    },
  }),

  defineTool({
    name: "input_pinch",
    description:
      "iOS only: two-finger pinch around a centre point. scale > 1 spreads the fingers (zoom in), scale < 1 closes them (zoom out). " +
      "x/y (centre) and distance (initial finger spread) are in the space coords names, like input_tap; without x/y the screen centre is used and distance is in points.",
    schema: z.object({
      x: z.number().optional().describe("Centre X (space set by coords; default: screen centre)"),
      y: z.number().optional().describe("Centre Y (space set by coords; default: screen centre)"),
      scale: z.number().positive().describe("Final finger spread relative to the initial one: 2 = zoom in 2x, 0.5 = zoom out"),
      distance: z.number().positive().default(200).describe("Initial finger spread (default: 200)"),
      duration: z.number().default(500).describe("Duration of the finger movement in ms (default: 500)"),
      hints: z.boolean().default(true).describe("Return hints about what changed after the action."),
      coords: coordsField,
      platform: platformEnum,
      deviceId: deviceIdField,
    }),
    handler: async (args, ctx) => {
      const { deviceId, platform: currentPlatform } = parseCommonArgs(args as Record<string, unknown>, ctx);
      if (currentPlatform !== "ios") {
        throw new ValidationError("input(action:'pinch') is supported on iOS only.");
      }
      if (args.scale === 1) {
        throw new ValidationError("scale must differ from 1 (> 1 zooms in, < 1 zooms out).");
      }
      const iosClient = ctx.deviceManager.getIosClient(deviceId);
      if (typeof iosClient.pinch !== "function") {
        throw new ValidationError("The installed iOS plugin does not support pinch.");
      }

      let x: number;
      let y: number;
      let distance = args.distance;
      let mapping = "";
      if (args.x !== undefined && args.y !== undefined) {
        const centre = await mapToDevice(args.x, args.y, currentPlatform, ctx, deviceId, args.coords);
        const edge = await mapToDevice(args.x + args.distance, args.y, currentPlatform, ctx, deviceId, args.coords);
        ({ x, y } = centre);
        distance = Math.abs(edge.x - centre.x);
        mapping = describeMapping(currentPlatform, [{ raw: { x: args.x, y: args.y }, mapped: centre }], args.coords);
      } else if (args.x === undefined && args.y === undefined) {
        const size = await iosClient.getScreenPointSize(deviceId);
        x = Math.round(size.width / 2);
        y = Math.round(size.height / 2);
      } else {
        throw new ValidationError("Provide both x and y, or neither for the screen centre.");
      }

      const spread = await iosClient.pinch(x, y, args.scale, distance, args.duration, deviceId);
      ctx.invalidateUiTreeCache(currentPlatform);
      let result = `Pinched at (${x}, ${y}): finger spread ${spread.startDistance} -> ${spread.endDistance}${mapping}`;
      if (args.hints) {
        result += await ctx.generateActionHints(args.platform);
      }
      return textResult(result);
    },
  }),

  defineTool({
    name: "input_text",
    description: "Type text into focused input field",
    schema: z.object({
      text: z.string().describe("Text to type"),
      targetPid: z.number().optional().describe("Desktop only: PID of target process. When provided, sends input without stealing window focus."),
      hints: z.boolean().default(true).describe("Return hints about what changed after the action."),
      platform: platformEnum,
      deviceId: deviceIdField,
    }),
    handler: async (args, ctx) => {
      const { deviceId } = parseCommonArgs(args as Record<string, unknown>, ctx);
      const platform = args.platform;
      const text = args.text;
      await ctx.deviceManager.inputText(text, platform, args.targetPid, deviceId);
      ctx.invalidateUiTreeCache(platform ?? ctx.deviceManager.getCurrentPlatform() ?? undefined);
      let result = `Entered ${text.length} character(s).`;
      if (args.hints) {
        result += await ctx.generateActionHints(args.platform);
      }
      return textResult(result);
    },
  }),

  defineTool({
    name: "input_key",
    description: "Press hardware key (BACK, HOME, ENTER, etc.)",
    schema: z.object({
      key: z.string().describe("Key name: BACK, HOME, ENTER, TAB, DELETE, MENU, POWER, VOLUME_UP, VOLUME_DOWN, etc."),
      targetPid: z.number().optional().describe("Desktop only: PID of target process. When provided, sends key without stealing window focus."),
      hints: z.boolean().default(true).describe("Return hints about what changed after the action."),
      platform: platformEnum,
      deviceId: deviceIdField,
    }),
    handler: async (args, ctx) => {
      const { deviceId } = parseCommonArgs(args as Record<string, unknown>, ctx);
      const platform = args.platform;
      const key = args.key;
      await ctx.deviceManager.pressKey(key, platform, args.targetPid, deviceId);
      ctx.invalidateUiTreeCache(platform ?? ctx.deviceManager.getCurrentPlatform() ?? undefined);
      let result = `Pressed key: ${key}`;
      if (args.hints) {
        result += await ctx.generateActionHints(args.platform);
      }
      return textResult(result);
    },
  }),
];

/** Raw x/y go through the coordinate mapping; an element's centre is already in device coordinates. */
async function toDevice(
  resolved: { x: number; y: number; fromRawArgs: boolean },
  coords: CoordinateSpace,
  platform: string | undefined,
  ctx: ToolContext,
  deviceId: string | undefined,
): Promise<{ x: number; y: number; mapping: string }> {
  if (!resolved.fromRawArgs) return { x: resolved.x, y: resolved.y, mapping: "" };
  const mapped = await mapToDevice(resolved.x, resolved.y, platform, ctx, deviceId, coords);
  const mapping = describeMapping(platform, [{ raw: { x: resolved.x, y: resolved.y }, mapped }], coords);
  return { x: mapped.x, y: mapped.y, mapping };
}
