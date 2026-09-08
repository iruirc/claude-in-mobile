/**
 * Platform-dispatched UI element fetching.
 *
 * Consolidates the repeated if/else chains that appear in ui_tree,
 * ui_find, ui_analyze, ui_wait, ui_assert_visible, ui_assert_gone, etc.
 */

import type { ToolContext } from "../context.js";
import type { Platform } from "../../device-manager.js";
import {
  parseUiHierarchy,
  desktopHierarchyToUiElements,
  harmonyHierarchyToUiElements,
  UiElement,
} from "../../ui-tree/ui-parser.js";

export interface GetUiElementsResult {
  elements: UiElement[];
  /** Raw hierarchy string (only for desktop/ios when needed) */
  rawTree?: string;
}

/**
 * Fetch and parse UI elements for the given platform.
 *
 * Side-effect: updates the cached elements via ctx.setCachedElements().
 */
export async function getUiElements(
  ctx: ToolContext,
  platform: Platform | string | undefined,
  deviceId?: string,
): Promise<GetUiElementsResult> {
  const currentPlatform = platform ?? ctx.deviceManager.getCurrentPlatform();

  if (currentPlatform === "ios") {
    const json = await ctx.deviceManager.getUiHierarchy("ios", deviceId);
    const tree = JSON.parse(json);
    const elements = ctx.iosTreeToUiElements(tree);
    ctx.setCachedElements("ios", elements);
    return { elements };
  }

  if (currentPlatform === "harmony") {
    const hierarchyText = await ctx.deviceManager.getUiHierarchyAsync("harmony", deviceId);
    const elements = harmonyHierarchyToUiElements(hierarchyText);
    ctx.setCachedElements("harmony", elements);
    return { elements, rawTree: hierarchyText };
  }

  if (currentPlatform === "desktop") {
    const hierarchyText = await ctx.deviceManager.getUiHierarchyAsync("desktop", deviceId);
    const elements = desktopHierarchyToUiElements(hierarchyText);
    ctx.setCachedElements("desktop", elements);
    return { elements, rawTree: hierarchyText };
  }

  // XML-based fallback (Android and legacy Aurora hierarchy output).
  const fallbackPlatform = currentPlatform as Platform;
  const xml = await ctx.deviceManager.getUiHierarchyAsync(fallbackPlatform, deviceId);
  const elements = parseUiHierarchy(xml);
  ctx.setCachedElements(currentPlatform, elements);
  return { elements, rawTree: xml };
}
