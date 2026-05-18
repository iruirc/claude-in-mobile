/**
 * UI inspection & interaction tools — thin facade over `./ui/*` handlers.
 *
 * Sub-tools:
 *   - ui_tree:           UI hierarchy dump
 *   - ui_find:           find elements by text/id/className
 *   - ui_find_tap:       fuzzy NL tap (Android)
 *   - ui_tap_text:       tap by text via Accessibility API (Desktop)
 *   - ui_analyze:        structured screen analysis
 *   - ui_wait:           wait for element with timeout
 *   - ui_assert_visible: assert element present
 *   - ui_assert_gone:    assert element absent
 */

import type { ToolDefinition } from "./registry.js";
import {
  uiTree,
  uiFind,
  uiFindTap,
  uiTapText,
  uiAnalyze,
  uiWait,
  uiAssertVisible,
  uiAssertGone,
} from "./ui/index.js";

/**
 * Build the iOS UI-inspection failure text. The Appium/WDA install hint is
 * shown ONLY for a genuine "WebDriverAgent not found" / discovery failure.
 * For any other cause (WDA present but not serving, build/launch failure,
 * ECONNREFUSED → "fetch failed", session error) the REAL error is surfaced
 * verbatim instead of the misleading "requires WebDriverAgent / install
 * appium" boilerplate, which previously masked the actual root cause.
 */
function iosUiErrorText(error: any): string {
  const msg = String(error?.message ?? error);
  const notInstalled =
    error?.code === "WDA_NOT_INSTALLED" ||
    /WebDriverAgent not found|WDA_PATH|appium driver install xcuitest/i.test(msg);
  if (notInstalled) {
    return (
      `iOS UI inspection requires WebDriverAgent.\n\n` +
      `Install: npm install -g appium && appium driver install xcuitest\n` +
      `Or set WDA_PATH.\n\nError: ${msg}`
    );
  }
  return (
    `iOS UI inspection failed (WebDriverAgent is installed but the call ` +
    `did not succeed).\n\nError: ${msg}\n\n` +
    `If this is "fetch failed"/ECONNREFUSED, WDA is not serving on :8100 — ` +
    `start it with \`npm run wda\` (scripts/ensure-wda.sh) or let the ` +
    `server prewarm it.`
  );
}

export const uiTools: ToolDefinition[] = [
  uiTree,
  uiFind,
  uiFindTap,
  uiTapText,
  uiAnalyze,
  uiWait,
  uiAssertVisible,
  uiAssertGone,
];
