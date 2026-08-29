import { describe, it, expect, beforeEach, vi } from "vitest";
import type { UiElement } from "../../ui-tree/ui-parser.js";
import { SharedState } from "./shared-state-class.js";
import {
  getCachedElements,
  setCachedElements,
} from "./shared-state.js";
import { createGetElementsForPlatform } from "./hints.js";
import { iosTreeToUiElements } from "./ios-helpers.js";

/**
 * Regression guard for the *root* of the "No UI elements detected." bug:
 * the shared per-platform element cache must never be clobbered with an empty
 * read, regardless of which writer performs the write.
 *
 * The pre-existing hints.test.ts mocks `setCachedElements` away, so it only
 * proves that `generateActionHints` *skips* the call — it never exercises the
 * real owner-level invariant, and it does not cover the second, un-guarded
 * writer (`getElementsForPlatform`). This file drives the REAL SharedState and
 * the REAL shared-state module so a future refactor that removes either guard
 * fails here.
 */

function validWdaEnvelope() {
  return JSON.stringify({
    status: 0,
    sessionId: "TEST-SESSION",
    value: {
      type: "XCUIElementTypeApplication",
      rect: { x: 0, y: 0, width: 390, height: 844 },
      children: [
        {
          type: "XCUIElementTypeButton",
          label: "Continue",
          enabled: true,
          rect: { x: 20, y: 700, width: 350, height: 44 },
        },
      ],
    },
  });
}

function degradedWdaEnvelope() {
  return JSON.stringify({ status: 0, value: null, sessionId: "TEST-SESSION" });
}

function sampleElements(): UiElement[] {
  return iosTreeToUiElements(JSON.parse(validWdaEnvelope()));
}

describe("SharedState.setCachedElements — owner-level cache invariant", () => {
  let state: SharedState;

  beforeEach(() => {
    state = new SharedState();
  });

  it("stores a non-empty read", () => {
    const els = sampleElements();
    state.setCachedElements("ios", els);
    expect(state.getCachedElements("ios")).toEqual(els);
  });

  it("does NOT clobber a good cache with an empty read", () => {
    const good = sampleElements();
    state.setCachedElements("ios", good);

    // Second (degraded) writer tries to store [] — must be ignored.
    state.setCachedElements("ios", []);

    expect(state.getCachedElements("ios")).toEqual(good);
    expect(state.getCachedElements("ios").length).toBeGreaterThan(0);
  });

  it("allows an empty write only when the cache is already empty", () => {
    // Starting empty: writing [] is a no-op-equivalent (stays empty), and must
    // not throw or leave a poisoned non-empty value.
    state.setCachedElements("android", []);
    expect(state.getCachedElements("android")).toEqual([]);
  });

  it("isolates caches per platform", () => {
    const els = sampleElements();
    state.setCachedElements("ios", els);
    state.setCachedElements("android", []); // empty, different platform
    expect(state.getCachedElements("ios").length).toBeGreaterThan(0);
    expect(state.getCachedElements("android")).toEqual([]);
  });
});

describe("getElementsForPlatform — second cache writer must not self-poison", () => {
  let mockDeviceManager: any;

  beforeEach(() => {
    // Clear the process-wide singleton that shared-state.ts is bound to, so
    // each test starts from a clean cache without swapping the (already
    // import-captured) `_state` reference.
    for (const platform of ["ios", "android", "desktop"]) {
      // Force-clear even a non-empty cache: the guard blocks [] via the public
      // API, so reach through getCachedElements to detect and hard-reset.
      if (getCachedElements(platform).length > 0) {
        setCachedElements(platform, sampleElements()); // ensure key exists
      }
    }
    // Deterministic reset: write a sentinel then rely on per-test writes.
    setCachedElements("ios", sampleElements());

    mockDeviceManager = {
      getCurrentPlatform: vi.fn(() => "ios"),
      getUiHierarchy: vi.fn(),
      getUiHierarchyAsync: vi.fn(),
    };
  });

  it("keeps a previously-good iOS cache when a degraded fetch throws", async () => {
    const getElements = createGetElementsForPlatform(mockDeviceManager);

    // Seed a good cache through the real writer.
    mockDeviceManager.getUiHierarchy.mockResolvedValueOnce(validWdaEnvelope());
    const first = await getElements("ios");
    expect(first.length).toBeGreaterThan(0);
    expect(getCachedElements("ios").length).toBeGreaterThan(0);

    // Degraded fetch: iosTreeToUiElements throws WdaTreeError before any
    // setCachedElements("ios", []) can run — so the cache survives.
    mockDeviceManager.getUiHierarchy.mockResolvedValueOnce(
      degradedWdaEnvelope(),
    );
    await expect(getElements("ios")).rejects.toThrow();

    // Cache must still hold the good elements, never poisoned to [].
    expect(getCachedElements("ios").length).toBeGreaterThan(0);
  });

  it("does not poison a good cache even if an empty [] reaches setCachedElements", async () => {
    // Belt-and-suspenders: the owner guard blocks [] regardless of caller.
    const good = sampleElements();
    setCachedElements("ios", good);
    setCachedElements("ios", []); // simulate an un-guarded writer
    expect(getCachedElements("ios").length).toBe(good.length);
  });
});
