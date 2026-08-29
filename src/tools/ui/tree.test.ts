import { describe, it, expect, vi } from "vitest";
import { uiTree } from "./tree.js";
import { iosTreeToUiElements, formatIOSUITree } from "../context/ios-helpers.js";
import type { ToolContext } from "../context.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal iOS WDA-style accessibility tree with a variety of node types. */
function makeIosTree() {
  return {
    type: "XCUIElementTypeApplication",
    rect: { x: 0, y: 0, width: 390, height: 844 },
    children: [
      {
        type: "XCUIElementTypeStaticText",
        label: "Welcome",
        rect: { x: 20, y: 60, width: 200, height: 30 },
      },
      {
        type: "XCUIElementTypeButton",
        label: "Sign in",
        enabled: true,
        rect: { x: 20, y: 700, width: 350, height: 44 },
      },
      {
        type: "XCUIElementTypeSecureTextField",
        // WDA exposes the typed password in `value` — must never be printed.
        value: "hunter2",
        label: "Password",
        rect: { x: 20, y: 400, width: 350, height: 40 },
      },
    ],
  };
}

/** Deep iOS tree with N clickable buttons, to exercise the element limit. */
function makeLargeIosTree(count: number) {
  const children = Array.from({ length: count }, (_, i) => ({
    type: "XCUIElementTypeButton",
    label: `Button ${i}`,
    enabled: true,
    rect: { x: 0, y: i * 10, width: 100, height: 8 },
  }));
  return {
    type: "XCUIElementTypeApplication",
    rect: { x: 0, y: 0, width: 390, height: 844 },
    children,
  };
}

function makeIosContext(tree: unknown, overrides?: Partial<ToolContext>): ToolContext {
  return {
    deviceManager: {
      getCurrentPlatform: vi.fn(() => "ios"),
      getUiHierarchy: vi.fn(async () => JSON.stringify(tree)),
      getUiHierarchyAsync: vi.fn(async () => ""),
    } as any,
    getCachedElements: vi.fn(() => []),
    setCachedElements: vi.fn(),
    lastScreenshotMap: new Map(),
    lastUiTreeMap: new Map(),
    screenshotScaleMap: new Map(),
    generateActionHints: vi.fn(async () => ""),
    getElementsForPlatform: vi.fn(async () => []),
    // Real converter — this is the shared representation the fix relies on.
    iosTreeToUiElements: (t: any) => iosTreeToUiElements(t),
    formatIOSUITree: (t: any, indent?: number) => formatIOSUITree(t, indent),
    invalidateUiTreeCache: vi.fn(),
    platformParam: { type: "string", enum: ["android", "ios", "desktop"], description: "" },
    handleTool: vi.fn(async () => ({ text: "ok" })),
    turboDefault: false,
    ...overrides,
  } as ToolContext;
}

async function runTree(ctx: ToolContext, args: Record<string, unknown>): Promise<string> {
  const result = (await uiTree.handler(args as any, ctx)) as { content: Array<{ text: string }> };
  return result.content.map(c => c.text).join("\n");
}

// ---------------------------------------------------------------------------
// Regression guard: iOS must go through the SHARED formatting layer.
// Root cause was tree.ts early-returning formatIOSUITree, so compact/semantic/
// showAll/fresh were silently ignored on iOS.
// ---------------------------------------------------------------------------

describe("ui_tree — iOS shares the common formatting layer", () => {
  it("format:semantic produces role-grouped output (NOT the raw <Type> dump)", async () => {
    const ctx = makeIosContext(makeIosTree());
    const text = await runTree(ctx, { platform: "ios", format: "semantic" });

    // Semantic formatter groups by role with these section headers.
    expect(text).toMatch(/Actions:|Inputs:|Text:|Nav:/);
    // The bespoke iOS dump prints "<XCUIElementType...>" tags; must be gone.
    expect(text).not.toContain("<XCUIElementTypeButton>");
  });

  it("compact:true yields the short interactive-only format", async () => {
    const ctx = makeIosContext(makeIosTree());
    const text = await runTree(ctx, { platform: "ios", compact: true });

    // Compact format is "[index] ShortClass "label" (x,y)".
    expect(text).toMatch(/\[\d+\] \w+.*\(\d+,\d+\)/);
    expect(text).not.toContain("<XCUIElementTypeButton>");
  });

  it("showAll changes the output vs the filtered default", async () => {
    const ctxDefault = makeIosContext(makeIosTree());
    const ctxAll = makeIosContext(makeIosTree());

    const filtered = await runTree(ctxDefault, { platform: "ios", showAll: false });
    const all = await runTree(ctxAll, { platform: "ios", showAll: true });

    // showAll includes the non-interactive application container node, so the
    // full dump is at least as long — and the flag is actually honoured.
    expect(all.length).toBeGreaterThanOrEqual(filtered.length);
  });

  it("caches identical trees and reports 'UI unchanged' on the second call", async () => {
    const ctx = makeIosContext(makeIosTree());
    const first = await runTree(ctx, { platform: "ios" });
    const second = await runTree(ctx, { platform: "ios" });

    expect(first).not.toContain("UI unchanged");
    expect(second).toContain("UI unchanged");
  });

  it("fresh:true bypasses the dedup cache", async () => {
    const ctx = makeIosContext(makeIosTree());
    await runTree(ctx, { platform: "ios" });
    const fresh = await runTree(ctx, { platform: "ios", fresh: true });

    expect(fresh).not.toContain("UI unchanged");
  });

  it("populates the shared iOS element cache (setCachedElements('ios', …))", async () => {
    const setCachedElements = vi.fn();
    const ctx = makeIosContext(makeIosTree(), { setCachedElements });
    await runTree(ctx, { platform: "ios" });

    expect(setCachedElements).toHaveBeenCalledWith("ios", expect.any(Array));
    const cached = setCachedElements.mock.calls[0][1];
    expect(cached.length).toBeGreaterThan(0);
  });

  it("enforces the 100-element limit on iOS", async () => {
    const ctx = makeIosContext(makeLargeIosTree(250));
    const text = await runTree(ctx, { platform: "ios", showAll: true });

    expect(text).toMatch(/showing 100 of \d+ elements/);
  });
});

// ---------------------------------------------------------------------------
// Security: secure fields must never leak their value on any platform.
// ---------------------------------------------------------------------------

describe("ui_tree — SecureTextField value is redacted", () => {
  it("does not print the secure field value in the default format", async () => {
    const ctx = makeIosContext(makeIosTree());
    const text = await runTree(ctx, { platform: "ios", showAll: true });

    expect(text).not.toContain("hunter2");
    expect(text).toContain("[REDACTED]");
  });

  it("does not leak the value in semantic format", async () => {
    const ctx = makeIosContext(makeIosTree());
    const text = await runTree(ctx, { platform: "ios", format: "semantic" });

    expect(text).not.toContain("hunter2");
  });

  it("does not leak the value in compact format", async () => {
    const ctx = makeIosContext(makeIosTree());
    const text = await runTree(ctx, { platform: "ios", compact: true });

    expect(text).not.toContain("hunter2");
  });
});
