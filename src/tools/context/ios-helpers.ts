/**
 * iOS-specific tree parsing: convert WDA accessibility tree to UiElement[].
 */

import type { UiElement } from "../../ui-tree/ui-parser.js";

/**
 * Structural shape of a WebDriverAgent accessibility node (`/wda/accessibleSource`).
 *
 * WDA returns a nested tree. Container nodes (the root `XCUIElementTypeApplication`,
 * windows, layout groups) frequently carry a `rect` with zero width/height — or no
 * `rect` at all — while still holding paintable descendants. Leaf/interactive nodes
 * carry a real rect. Every field is optional because WDA omits empties.
 */
export interface WdaNode {
  type?: string;
  label?: string;
  value?: string;
  name?: string;
  identifier?: string;
  enabled?: boolean;
  selected?: boolean;
  rect?: { x?: number; y?: number; width?: number; height?: number };
  children?: WdaNode[];
}

/**
 * WDA HTTP envelope. When the session is healthy the payload lives under `value`;
 * on session degradation WDA still answers 200 but with `value: null`. We must not
 * cast that envelope straight to a tree node — doing so silently yields `[]`.
 */
interface WdaEnvelope {
  value?: WdaNode | null;
  status?: number;
  sessionId?: string;
}

/**
 * Thrown when the WDA response cannot be interpreted as an accessibility tree.
 * Callers (e.g. the hints path) rely on this to distinguish a genuine "empty UI"
 * from a broken/degraded WDA session, instead of poisoning caches with `[]`.
 */
export class WdaTreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WdaTreeError";
  }
}

/** Type guard: does this object structurally look like a WDA tree node? */
function isWdaNode(v: unknown): v is WdaNode {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  // A node is identified by having at least a type, a rect, or children — the
  // three things a real accessibility node always carries. The bare envelope
  // ({status, value:null, sessionId}) has none of these.
  return "type" in o || "rect" in o || "children" in o;
}

/**
 * Runtime schema-guard on the WDA trust boundary.
 *
 * Accepts either a raw tree node or the `{value}` envelope and returns a real
 * tree node, or throws {@link WdaTreeError} when the response is a degraded
 * envelope / null / non-tree. This is the single place where an untrusted
 * external process (WDA on localhost:8100) is validated before being cast to
 * our internal shape — the previous `response.value || response` unwrap let a
 * `value:null` envelope leak through and parse to `[]` with no error.
 */
export function unwrapWdaTree(response: unknown): WdaNode {
  if (isWdaNode(response)) {
    return response;
  }

  if (typeof response === "object" && response !== null && "value" in response) {
    const env = response as WdaEnvelope;
    if (isWdaNode(env.value)) {
      return env.value;
    }
    throw new WdaTreeError(
      "WDA returned an empty accessibility tree (value is null/absent). " +
        "The WebDriverAgent session may have been backgrounded or lost.",
    );
  }

  throw new WdaTreeError(
    `WDA response is not an accessibility tree (got ${response === null ? "null" : typeof response}).`,
  );
}

/**
 * Convert an iOS accessibility tree (from WDA) to UiElement[].
 *
 * Robust against two real-world WDA quirks that previously produced `[]`:
 *   1. The response envelope (`{value, status, sessionId}`) is unwrapped and
 *      validated via {@link unwrapWdaTree} — a degraded `value:null` throws
 *      instead of silently yielding an empty list.
 *   2. Container nodes with a zero-size or missing `rect` are NOT dropped: we
 *      still recurse into their children so paintable descendants survive.
 *      Only nodes that themselves have a real (w>0 && h>0) rect are emitted as
 *      elements, but a zero-rect ancestor no longer discards its subtree.
 */
export function iosTreeToUiElements(
  tree: unknown,
  elements: UiElement[] = [],
  index = { value: 0 },
): UiElement[] {
  // Only validate/unwrap at the top of the recursion; children are already
  // real nodes at that point.
  const root: WdaNode = index.value === 0 && elements.length === 0 ? unwrapWdaTree(tree) : (tree as WdaNode);

  walkWdaNode(root, elements, index);
  return elements;
}

function walkWdaNode(node: WdaNode, elements: UiElement[], index: { value: number }): void {
  if (!node || typeof node !== "object") return;

  const rect = node.rect;
  if (rect) {
    const x = rect.x ?? 0;
    const y = rect.y ?? 0;
    const w = rect.width ?? 0;
    const h = rect.height ?? 0;

    // Emit only nodes with a real, paintable rect. Zero-rect containers fall
    // through to the child recursion below instead of being dropped.
    if (w > 0 && h > 0) {
      elements.push({
        index: index.value++,
        resourceId: node.identifier ?? "",
        className: node.type ?? "",
        packageName: "",
        text: node.label ?? node.value ?? "",
        contentDesc: node.name ?? "",
        checkable: false,
        checked: false,
        clickable:
          node.enabled !== false &&
          Boolean(node.type?.includes("Button") || node.type?.includes("Link") || node.type?.includes("Cell")),
        enabled: node.enabled !== false,
        focusable: node.enabled !== false,
        focused: false,
        scrollable: node.type?.includes("ScrollView") ?? false,
        longClickable: false,
        password: node.type?.includes("SecureTextField") ?? false,
        selected: node.selected ?? false,
        bounds: { x1: x, y1: y, x2: x + w, y2: y + h },
        centerX: Math.floor(x + w / 2),
        centerY: Math.floor(y + h / 2),
        width: w,
        height: h,
      });
    }
  }

  if (node.children) {
    for (const child of node.children) {
      walkWdaNode(child, elements, index);
    }
  }
}

export function formatIOSUITree(tree: any, indent = 0): string {
  const lines: string[] = [];
  const prefix = '  '.repeat(indent);

  if (tree.type) {
    const parts: string[] = [`<${tree.type}>`];
    if (tree.label) parts.push(`label="${tree.label}"`);
    if (tree.value) parts.push(`value="${tree.value}"`);
    if (tree.name) parts.push(`name="${tree.name}"`);
    if (tree.identifier) parts.push(`id="${tree.identifier}"`);
    if (tree.enabled !== undefined) parts.push(`enabled=${tree.enabled}`);
    if (tree.rect) parts.push(`@ (${tree.rect.x}, ${tree.rect.y})`);
    lines.push(`${prefix}${parts.join(' ')}`);
  }

  if (tree.children) {
    for (const child of tree.children) {
      lines.push(formatIOSUITree(child, indent + 1));
    }
  }

  return lines.join('\n');
}
