import { describe, it, expect } from "vitest";
import { createMetaTool } from "./create-meta-tool.js";
import { defineTool, z } from "../define-tool.js";
import { uiMeta } from "./ui-meta.js";
import { ValidationError } from "../../errors.js";
import type { ToolContext } from "../context.js";

// ---------------------------------------------------------------------------
// Regression guard for the meta-tool "silent parameter strip" class (#60.3).
//
// Root cause (see fix/meta-tool-param-strip): createMetaTool advertises a flat
// merged schema (global extraSchema ∪ every sub-tool's props) to the model, but
// each action is validated only against its own narrow Zod schema in Zod's
// default STRIP mode. Any advertised key not present in the resolved action's
// schema was silently dropped BEFORE the handler ran, surfacing later as a
// misleading error about an unrelated field — or a bogus "provide X or Y" guard
// that never named the param the caller actually sent.
//
// The pre-existing ui test (ui/tree.test.ts) calls the sub-handler directly and
// therefore never exercised the meta dispatch + defineTool.safeParse path where
// the drop happens. These tests go through the real meta handler.
// ---------------------------------------------------------------------------

/** Minimal context — the guard rejects before any handler/device access. */
function ctx(): ToolContext {
  return {} as ToolContext;
}

describe("createMetaTool — fail-closed on advertised-but-unsupported params", () => {
  // Two sub-tools with DISJOINT narrow schemas, plus a global extraSchema that
  // advertises keys neither sub-tool accepts for every action. This mirrors the
  // exact ui/accessibility/app/... shape.
  function makeMeta() {
    const alpha = defineTool({
      name: "x_alpha",
      description: "alpha",
      schema: z.object({ description: z.string() }),
      handler: async (args) => ({ content: [{ type: "text", text: `alpha:${args.description}` }] }) as any,
    });
    const beta = defineTool({
      name: "x_beta",
      description: "beta",
      schema: z.object({ text: z.string().optional(), resourceId: z.string().optional() }),
      handler: async () => ({ content: [{ type: "text", text: "beta" }] }) as any,
    });
    return createMetaTool({
      name: "x",
      description: "meta",
      tools: [alpha, beta],
      prefix: "x_",
      // Global schema advertises `label`/`className` — accepted by NEITHER action.
      extraSchema: {
        label: { type: "string", description: "iOS label" },
        className: { type: "string", description: "class name" },
      },
    });
  }

  it("rejects an advertised param the action does not accept, naming the param and the action", async () => {
    const { meta } = makeMeta();
    // `label` is advertised globally but `alpha` only accepts `description`.
    const err = await meta.handler({ action: "alpha", description: "hi", label: "Submit" }, ctx()).catch((e) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("x(action:'alpha')");
    expect(err.message).toContain("'label'"); // names the offending param
    expect(err.message).toContain("'description'"); // lists what IS valid
  });

  it("does NOT surface as a misleading error about an unrelated required field", async () => {
    const { meta } = makeMeta();
    // Pre-fix: `label` was stripped, leaving `description` empty →
    // "description: Invalid input: expected string". That must NOT happen.
    const err = await meta.handler({ action: "alpha", label: "Submit" }, ctx()).catch((e) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("'label'");
    expect(err.message).not.toMatch(/description.*expected string/i);
  });

  it("reports multiple rejected params at once", async () => {
    const { meta } = makeMeta();
    const err = await meta.handler({ action: "beta", label: "L", className: "C" }, ctx()).catch((e) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("parameters"); // plural
    expect(err.message).toContain("'label'");
    expect(err.message).toContain("'className'");
  });

  it("allows params the resolved action DOES accept", async () => {
    const { meta } = makeMeta();
    const res = (await meta.handler({ action: "beta", text: "hello" }, ctx())) as {
      content: Array<{ text: string }>;
    };
    expect(res.content[0].text).toBe("beta");
  });

  it("ignores keys not advertised by the meta schema at all (out of scope)", async () => {
    const { meta } = makeMeta();
    // `totallyUnknown` is not in the merged schema; the guard must not claim it.
    // beta accepts text; the extra unknown key is left to the sub-schema (strip).
    const res = (await meta.handler({ action: "beta", text: "hi", totallyUnknown: 1 }, ctx())) as {
      content: Array<{ text: string }>;
    };
    expect(res.content[0].text).toBe("beta");
  });
});

// ---------------------------------------------------------------------------
// The real `ui` meta tool — the exact symptoms from #60.3.
// ---------------------------------------------------------------------------

describe("ui meta — #60.3 symptom cluster is now fail-closed", () => {
  it("find_tap + label: clear error naming label, NOT 'description expected string'", async () => {
    const err = await uiMeta.handler({ action: "find_tap", label: "Submit" }, ctx()).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("find_tap");
    expect(err.message).toContain("'label'");
    expect(err.message).not.toMatch(/description.*expected string/i);
  });

  it("find_tap + resourceId: rejected loudly (find_tap only accepts description)", async () => {
    const err = await uiMeta.handler({ action: "find_tap", description: "x", resourceId: "id/foo" }, ctx()).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("'resourceId'");
  });

  it("wait + label: names label instead of the bogus 'provide search criteria' guard", async () => {
    const err = await uiMeta.handler({ action: "wait", label: "Submit" }, ctx()).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("'label'");
    expect(err.message).not.toContain("Provide at least one search criteria");
  });

  it("tap_text + label/resourceId/className: all rejected (tap_text takes text/pid/exactMatch)", async () => {
    const err = await uiMeta.handler({ action: "tap_text", text: "OK", label: "L" }, ctx()).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("'label'");
  });

  it("assert_visible now ACCEPTS className (widened sub-schema, no strip)", async () => {
    // className is a legitimate findElements criterion — must reach the handler,
    // not be rejected and not be silently dropped. We only assert it passes the
    // meta guard (handler will then need a device; a thrown non-ValidationError
    // is fine — the point is it is NOT a param-rejection ValidationError).
    const err = await uiMeta.handler({ action: "assert_visible", className: "Button" }, ctx()).catch((e) => e);
    if (err instanceof ValidationError) {
      expect(err.message).not.toContain("does not support parameter");
    }
  });
});
