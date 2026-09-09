import {
  WDASession,
  WDAElement,
  WDARect,
  UITreeNode,
  LocatorStrategy,
  TouchAction,
  unwrapWdaValue,
} from "./wda-types.js";

export class WDAClient {
  private baseUrl: string;
  private sessionId: string | null = null;
  private readonly operationTimeout = 10000;

  constructor(port: number) {
    this.baseUrl = `http://localhost:${port}`;
  }

  async ensureSession(deviceId: string): Promise<void> {
    if (this.sessionId) {
      try {
        // Verify session is still valid
        await this.request("GET", `/session/${this.sessionId}`);
        return;
      } catch (error: unknown) {
        // Session is invalid, clear it
        const msg = error instanceof Error ? error.message : String(error);
        console.error("WDA session invalid, recreating:", msg);
        this.sessionId = null;
      }
    }

    await this.createSession(deviceId);
  }

  private async createSession(deviceId: string): Promise<void> {
    const response = await this.request("POST", "/session", {
      capabilities: {
        alwaysMatch: {
          platformName: "iOS",
          "appium:automationName": "XCUITest",
          "appium:udid": deviceId,
        },
      },
    });

    this.sessionId = response.sessionId || response.value?.sessionId;
    if (!this.sessionId) {
      throw new Error(
        "Failed to create WebDriverAgent session.\n\n" +
          "Possible causes:\n" +
          "- Simulator is not running (boot with: xcrun simctl boot <UDID>)\n" +
          "- Port in use (check: lsof -i :8100)\n" +
          "- Code signing issues\n\n" +
          "Try restarting the simulator."
      );
    }
  }

  async deleteSession(): Promise<void> {
    if (this.sessionId) {
      try {
        await this.request("DELETE", `/session/${this.sessionId}`);
      } catch {
        // Ignore errors on cleanup
      }
      this.sessionId = null;
    }
  }

  async getSourceTree(): Promise<UITreeNode> {
    if (!this.sessionId) {
      throw new Error("No active WDA session");
    }

    // Page source, not /wda/accessibleSource: the accessibility tree carries no
    // rects, and every consumer downstream drops nodes that have no geometry.
    const response = await this.request(
      "GET",
      `/session/${this.sessionId}/source?format=json`
    );
    // Trust boundary: a degraded session returns 200 with {value:null}. Reject
    // it here instead of casting the envelope to a tree (which yields an empty
    // parse and poisons downstream caches). See WdaTreeError.
    return unwrapWdaValue<UITreeNode>(response, "source");
  }

  async findElement(
    strategy: LocatorStrategy,
    selector: string
  ): Promise<WDAElement> {
    if (!this.sessionId) {
      throw new Error("No active WDA session");
    }

    const response = await this.request(
      "POST",
      `/session/${this.sessionId}/element`,
      {
        using: strategy,
        value: selector,
      }
    );

    return unwrapWdaValue<WDAElement>(response, "findElement");
  }

  async findElements(
    strategy: LocatorStrategy,
    selector: string
  ): Promise<WDAElement[]> {
    if (!this.sessionId) {
      throw new Error("No active WDA session");
    }

    const response = await this.request(
      "POST",
      `/session/${this.sessionId}/elements`,
      {
        using: strategy,
        value: selector,
      }
    );

    // A genuine "no matches" answer is `{value: []}` (a non-null object) and
    // passes validation as an empty array. Only a degraded `{value:null}`
    // envelope throws WdaTreeError — never silently returns the envelope.
    return unwrapWdaValue<WDAElement[]>(response, "findElements");
  }

  async clickElement(elementId: string): Promise<void> {
    if (!this.sessionId) {
      throw new Error("No active WDA session");
    }

    await this.request(
      "POST",
      `/session/${this.sessionId}/element/${elementId}/click`
    );
  }

  async tapByCoordinates(x: number, y: number): Promise<void> {
    if (!this.sessionId) {
      throw new Error("No active WDA session");
    }

    // Use W3C WebDriver Actions API for tapping
    await this.request("POST", `/session/${this.sessionId}/actions`, {
      actions: [
        {
          type: "pointer",
          id: "finger1",
          parameters: { pointerType: "touch" },
          actions: [
            { type: "pointerMove", duration: 0, x, y },
            { type: "pointerDown", button: 0 },
            { type: "pause", duration: 100 },
            { type: "pointerUp", button: 0 },
          ],
        },
      ],
    });
  }

  async longPress(x: number, y: number, durationMs: number = 1000): Promise<void> {
    if (!this.sessionId) {
      throw new Error("No active WDA session");
    }

    // Use W3C WebDriver Actions API: pointerDown + pause(duration) + pointerUp
    await this.request("POST", `/session/${this.sessionId}/actions`, {
      actions: [
        {
          type: "pointer",
          id: "finger1",
          parameters: { pointerType: "touch" },
          actions: [
            { type: "pointerMove", duration: 0, x, y },
            { type: "pointerDown", button: 0 },
            { type: "pause", duration: durationMs },
            { type: "pointerUp", button: 0 },
          ],
        },
      ],
    });
  }

  async typeText(text: string): Promise<void> {
    if (!this.sessionId) {
      throw new Error("No active WDA session");
    }

    // Try WDA-specific /wda/keys first (works on some WDA builds)
    try {
      await this.request("POST", `/session/${this.sessionId}/wda/keys`, {
        value: text.split(""),
      });
      return;
    } catch {
      // Fall through to W3C active element setValue
    }

    // Fallback: W3C standard — find active/focused element and setValue
    const activeEl = await this.request("GET", `/session/${this.sessionId}/element/active`);
    const elementId = activeEl?.value?.ELEMENT ?? activeEl?.value?.element ?? activeEl?.ELEMENT;
    if (!elementId) {
      throw new Error("No focused element found for text input. Tap a text field first.");
    }
    await this.request("POST", `/session/${this.sessionId}/element/${elementId}/value`, {
      text,
      value: text.split(""),
    });
  }

  async getWindowSize(): Promise<{ width: number; height: number }> {
    if (!this.sessionId) {
      throw new Error("No active WDA session");
    }

    const response = await this.request(
      "GET",
      `/session/${this.sessionId}/window/size`
    );
    return unwrapWdaValue<{ width: number; height: number }>(
      response,
      "window/size"
    );
  }

  async swipe(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    duration: number = 300
  ): Promise<void> {
    if (!this.sessionId) {
      throw new Error("No active WDA session");
    }

    // Use W3C WebDriver Actions API for swiping
    await this.request("POST", `/session/${this.sessionId}/actions`, {
      actions: [
        {
          type: "pointer",
          id: "finger1",
          parameters: { pointerType: "touch" },
          actions: [
            { type: "pointerMove", duration: 0, x: x1, y: y1 },
            { type: "pointerDown", button: 0 },
            { type: "pause", duration: 50 },
            { type: "pointerMove", duration, x: x2, y: y2, origin: "viewport" },
            { type: "pointerUp", button: 0 },
          ],
        },
      ],
    });
  }

  async getElementRect(elementId: string): Promise<WDARect> {
    if (!this.sessionId) {
      throw new Error("No active WDA session");
    }

    const response = await this.request(
      "GET",
      `/session/${this.sessionId}/element/${elementId}/rect`
    );

    return unwrapWdaValue<WDARect>(response, "element/rect");
  }

  async getElementText(elementId: string): Promise<string> {
    if (!this.sessionId) {
      throw new Error("No active WDA session");
    }

    const response = await this.request(
      "GET",
      `/session/${this.sessionId}/element/${elementId}/text`
    );

    return response.value || response || "";
  }

  async isElementDisplayed(elementId: string): Promise<boolean> {
    if (!this.sessionId) {
      throw new Error("No active WDA session");
    }

    const response = await this.request(
      "GET",
      `/session/${this.sessionId}/element/${elementId}/displayed`
    );

    return response.value || response || false;
  }

  /**
   * Capture a screenshot via WDA (`GET /screenshot`). Works for both
   * simulators and physical devices — the only screenshot path that does NOT
   * depend on simctl. Returns a PNG buffer.
   */
  async screenshot(): Promise<Buffer> {
    const data = await this.request("GET", "/screenshot");
    const b64 = typeof data?.value === "string" ? data.value : "";
    if (!b64) {
      throw new Error("WebDriverAgent returned an empty screenshot");
    }
    return Buffer.from(b64, "base64");
  }

  private async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.operationTimeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `WebDriverAgent request failed: ${response.status} ${response.statusText}\n${text}`
        );
      }

      const data = await response.json() as { status?: number; value?: { message?: string; sessionId?: string }; sessionId?: string };

      if (data.status !== undefined && data.status !== 0) {
        throw new Error(
          `WebDriverAgent error: ${data.value?.message || JSON.stringify(data)}`
        );
      }

      return data;
    } catch (error: unknown) {
      clearTimeout(timeout);

      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `WebDriverAgent request timed out after ${this.operationTimeout}ms`
        );
      }

      throw error;
    }
  }
}
