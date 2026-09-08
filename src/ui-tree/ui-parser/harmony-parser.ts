import type { Bounds, UiElement } from "./types.js";

interface JsonObject {
  [key: string]: unknown;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parseBounds(value: unknown): Bounds {
  if (typeof value === "string") {
    const match = value.match(
      /^\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]$/,
    );
    if (match) {
      return {
        x1: Number(match[1]),
        y1: Number(match[2]),
        x2: Number(match[3]),
        y2: Number(match[4]),
      };
    }
  }
  if (isObject(value)) {
    const x1 = numberValue(value.left ?? value.x1 ?? value.x);
    const y1 = numberValue(value.top ?? value.y1 ?? value.y);
    const width = numberValue(value.width);
    const height = numberValue(value.height);
    const x2 = numberValue(value.right ?? value.x2) ?? (x1 !== undefined && width !== undefined ? x1 + width : undefined);
    const y2 = numberValue(value.bottom ?? value.y2) ?? (y1 !== undefined && height !== undefined ? y1 + height : undefined);
    if (x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined) {
      return { x1, y1, x2, y2 };
    }
  }
  return { x1: 0, y1: 0, x2: 0, y2: 0 };
}

function firstString(source: JsonObject, keys: readonly string[]): string {
  for (const key of keys) {
    const value = stringValue(source[key]);
    if (value) return value;
  }
  return "";
}

/** Convert ArkXTest `uitest dumpLayout` JSON into the shared UiElement model. */
export function harmonyHierarchyToUiElements(raw: string | unknown): UiElement[] {
  const root = typeof raw === "string" ? JSON.parse(raw) : raw;
  const elements: UiElement[] = [];
  const seen = new Set<JsonObject>();

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (!isObject(value) || seen.has(value)) return;
    seen.add(value);

    const attributes = isObject(value.attributes) ? value.attributes : value;
    const isNode = isObject(value.attributes)
      || "bounds" in attributes
      || "type" in attributes
      || "id" in attributes;
    if (isNode) {
      const bounds = parseBounds(attributes.bounds ?? value.bounds);
      const width = Math.max(0, bounds.x2 - bounds.x1);
      const height = Math.max(0, bounds.y2 - bounds.y1);
      elements.push({
        index: elements.length,
        resourceId: firstString(attributes, ["id", "resourceId", "accessibilityId"]),
        className: firstString(attributes, ["type", "className", "role"]),
        packageName: firstString(attributes, ["bundleName", "packageName"]),
        text: firstString(attributes, ["text", "content", "value"]),
        contentDesc: firstString(attributes, ["description", "hint", "accessibilityText"]),
        checkable: booleanValue(attributes.checkable),
        checked: booleanValue(attributes.checked),
        clickable: booleanValue(attributes.clickable),
        enabled: attributes.enabled === undefined || booleanValue(attributes.enabled),
        focusable: booleanValue(attributes.focusable),
        focused: booleanValue(attributes.focused),
        scrollable: booleanValue(attributes.scrollable),
        longClickable: booleanValue(attributes.longClickable),
        password: booleanValue(attributes.password),
        selected: booleanValue(attributes.selected),
        bounds,
        centerX: Math.round((bounds.x1 + bounds.x2) / 2),
        centerY: Math.round((bounds.y1 + bounds.y2) / 2),
        width,
        height,
      });
    }

    const childKeys = ["children", "child", "nodes", "windows"] as const;
    let foundChildren = false;
    for (const key of childKeys) {
      if (value[key] !== undefined) {
        foundChildren = true;
        visit(value[key]);
      }
    }
    if (!isNode && !foundChildren) {
      for (const child of Object.values(value)) visit(child);
    }
  };

  visit(root);
  return elements;
}
