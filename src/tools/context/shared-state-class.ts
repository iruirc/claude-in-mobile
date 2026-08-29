import type { UiElement } from "../../ui-tree/ui-parser.js";

/**
 * SharedState — encapsulates the per-platform caches that used to live as
 * module-level `Map`s in `shared-state.ts`. The legacy module re-exports
 * the singleton instance's Maps directly so existing consumers
 * (`ctx.lastScreenshotMap`, etc.) keep working.
 */
export class SharedState {
  readonly cachedElementsMap = new Map<string, UiElement[]>();
  readonly lastScreenshotMap = new Map<string, Buffer>();
  readonly lastUiTreeMap = new Map<string, { text: string; timestamp: number }>();
  readonly screenshotScaleMap = new Map<string, { scaleX: number; scaleY: number }>();

  getCachedElements(platform: string): UiElement[] {
    return this.cachedElementsMap.get(platform) ?? [];
  }

  /**
   * Cache invariant (owned here, not by callers): an empty read must never
   * clobber a previously-good cache.
   *
   * The `cachedElementsMap` is a single per-platform cache shared by several
   * writers (ui_tree, hints, flow element checks). A single degraded WDA fetch
   * on iOS returns `[]`; if that `[]` were stored it would poison
   * `beforeElements` for every subsequent input and make hints permanently
   * report "No UI elements detected." (cache self-poisoning). Previously each
   * caller had to remember to guard the write, and one of them
   * (`getElementsForPlatform`) did not. The rule now lives with the owner of
   * the cache so it cannot be forgotten again.
   */
  setCachedElements(platform: string, elements: UiElement[]): void {
    if (elements.length === 0 && this.getCachedElements(platform).length > 0) {
      return;
    }
    this.cachedElementsMap.set(platform, elements);
  }

  invalidateUiTreeCache(platform?: string): void {
    if (platform) {
      for (const key of this.lastUiTreeMap.keys()) {
        if (key.startsWith(platform)) this.lastUiTreeMap.delete(key);
      }
    } else {
      this.lastUiTreeMap.clear();
    }
  }
}
