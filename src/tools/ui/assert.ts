import { defineTool, z } from "../define-tool.js";
import { platformEnum, deviceIdField } from "../common-schema.js";
import { findElements, formatElement } from "../../ui-tree/ui-parser.js";
import { getUiElements } from "../helpers/get-elements.js";
import { parseCommonArgs } from "../../utils/parse-common-args.js";
import { textResult, errorResult } from "../../utils/tool-result.js";

export const uiAssertVisible = defineTool({
  name: "ui_assert_visible",
  description: "Assert element is visible on screen (pass/fail)",
  schema: z.object({
    text: z.string().optional().describe("Element text to check for (partial match)"),
    resourceId: z.string().optional().describe("Android/HarmonyOS: resource ID to check for"),
    className: z.string().optional().describe("Find by class name (partial match)"),
    platform: platformEnum,
    deviceId: deviceIdField,
  }),
  handler: async (args, ctx) => {
    const { deviceId, platform: currentPlatform } = parseCommonArgs(args as Record<string, unknown>, ctx);
    const searchText = args.text;
    const searchId = args.resourceId;
    const searchClass = args.className;

    if (!searchText && !searchId && !searchClass) {
      return textResult("Provide text, resourceId, or className to assert");
    }

    const { elements } = await getUiElements(ctx, currentPlatform, deviceId);

    const found = findElements(elements, {
      text: searchText,
      resourceId: searchId,
      className: searchClass,
    });

    if (found.length > 0) {
      return textResult(`PASS: Element visible -- ${formatElement(found[0])}`);
    }
    return errorResult(
      `FAIL: Element not visible (text=${searchText ?? ""}, resourceId=${searchId ?? ""}, className=${searchClass ?? ""})`,
    );
  },
});

export const uiAssertGone = defineTool({
  name: "ui_assert_gone",
  description: "Assert element does NOT exist on screen (pass/fail)",
  schema: z.object({
    text: z.string().optional().describe("Element text that should NOT be present"),
    resourceId: z.string().optional().describe("Android/HarmonyOS: resource ID that should NOT be present"),
    className: z.string().optional().describe("Class name that should NOT be present (partial match)"),
    platform: platformEnum,
    deviceId: deviceIdField,
  }),
  handler: async (args, ctx) => {
    const { deviceId, platform: currentPlatform } = parseCommonArgs(args as Record<string, unknown>, ctx);
    const searchText = args.text;
    const searchId = args.resourceId;
    const searchClass = args.className;

    if (!searchText && !searchId && !searchClass) {
      return textResult("Provide text, resourceId, or className to assert absence");
    }

    const { elements } = await getUiElements(ctx, currentPlatform, deviceId);

    const found = findElements(elements, {
      text: searchText,
      resourceId: searchId,
      className: searchClass,
    });

    if (found.length === 0) {
      return textResult(
        `PASS: Element not present (text=${searchText ?? ""}, resourceId=${searchId ?? ""}, className=${searchClass ?? ""})`,
      );
    }
    return errorResult(`FAIL: Element exists -- ${formatElement(found[0])}`);
  },
});
