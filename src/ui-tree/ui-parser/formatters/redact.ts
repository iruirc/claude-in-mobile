import type { UiElement } from "../types.js";

/** Placeholder shown instead of the value of a password/secure field. */
export const REDACTED = "[REDACTED]";

/**
 * Whether an element's textual value must be hidden from output.
 *
 * Covers both the parser-provided `password` flag (Android `password="true"`,
 * iOS `SecureTextField`/`Password` class) and a class-name fallback so secure
 * fields are never leaked regardless of how they were parsed.
 */
export function isSecureElement(el: UiElement): boolean {
  if (el.password) return true;
  const cls = el.className || "";
  return cls.includes("SecureTextField") || cls.includes("Password");
}

/**
 * Return the label safe to display for an element: the placeholder for secure
 * fields, otherwise the element's own text/contentDesc-derived label.
 */
export function safeLabel(el: UiElement, rawLabel: string): string {
  return isSecureElement(el) ? REDACTED : rawLabel;
}
