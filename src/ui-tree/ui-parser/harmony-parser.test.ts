import { describe, expect, it } from "vitest";

import { harmonyHierarchyToUiElements } from "./harmony-parser.js";

describe("harmonyHierarchyToUiElements", () => {
  it("flattens ArkXTest attributes and children", () => {
    const elements = harmonyHierarchyToUiElements(JSON.stringify({
      attributes: {
        type: "Column",
        bundleName: "com.example.demo",
        bounds: "[0,0][1260,2720]",
        enabled: "true",
      },
      children: [
        {
          attributes: {
            id: "confirm",
            accessibilityId: "42",
            type: "Button",
            text: "Continue",
            description: "Continue setup",
            bounds: "[440,1100][640,1200]",
            clickable: "true",
            focused: false,
          },
          children: [],
        },
      ],
    }));

    expect(elements).toHaveLength(2);
    expect(elements[1]).toMatchObject({
      index: 1,
      resourceId: "confirm",
      className: "Button",
      text: "Continue",
      contentDesc: "Continue setup",
      clickable: true,
      enabled: true,
      bounds: { x1: 440, y1: 1100, x2: 640, y2: 1200 },
      centerX: 540,
      centerY: 1150,
      width: 200,
      height: 100,
    });
  });

  it("accepts object bounds and nested window roots", () => {
    const elements = harmonyHierarchyToUiElements({
      windows: [{
        attributes: {
          type: "Text",
          text: "Status",
          bounds: { left: 10, top: 20, width: 80, height: 30 },
        },
      }],
    });

    expect(elements[0]).toMatchObject({
      text: "Status",
      bounds: { x1: 10, y1: 20, x2: 90, y2: 50 },
    });
  });
});
