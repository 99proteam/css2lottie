import { describe, expect, it } from "vitest";
import { resolveRadii } from "../../src/converters/box.js";
import { viewBoxTransform } from "../../src/converters/svg-viewbox.js";

describe("resolveRadii (border-radius)", () => {
  it("resolves px and percentages per axis", () => {
    expect(resolveRadii(["10px", "10px", "10px", "10px"], 100, 50)).toEqual([
      10, 10, 10, 10, 10, 10, 10, 10,
    ]);
    expect(resolveRadii(["50%", "50%", "50%", "50%"], 100, 50)).toEqual([
      50, 25, 50, 25, 50, 25, 50, 25,
    ]);
    expect(resolveRadii(["10px 20px", "0px", "0px", "0px"], 100, 100).slice(0, 2)).toEqual([
      10, 20,
    ]);
  });

  it("scales overlapping radii down like CSS", () => {
    // 9999px pill on a 100x40 box → radius 20 everywhere
    expect(
      resolveRadii(["9999px", "9999px", "9999px", "9999px"], 100, 40).map((v) => +v.toFixed(6)),
    ).toEqual([20, 20, 20, 20, 20, 20, 20, 20]);
  });
});

describe("viewBoxTransform", () => {
  it("defaults to xMidYMid meet", () => {
    expect(viewBoxTransform([0, 0, 24, 24], "xMidYMid meet", [0, 0, 200, 100])).toEqual({
      tx: 50,
      ty: 0,
      sx: 100 / 24,
      sy: 100 / 24,
      vx: 0,
      vy: 0,
    });
  });

  it("supports slice, none and alignment", () => {
    expect(viewBoxTransform([0, 0, 10, 10], "xMinYMin slice", [0, 0, 200, 100]).sx).toBe(20);
    expect(viewBoxTransform([0, 0, 10, 10], "xMaxYMax meet", [0, 0, 200, 100]).tx).toBe(100);
    expect(viewBoxTransform([0, 0, 10, 20], "none", [5, 5, 100, 100])).toMatchObject({
      tx: 5,
      ty: 5,
      sx: 10,
      sy: 5,
    });
  });

  it("is a plain offset without a viewBox", () => {
    expect(viewBoxTransform(null, "xMidYMid meet", [3, 4, 50, 50])).toEqual({
      tx: 3,
      ty: 4,
      sx: 1,
      sy: 1,
      vx: 0,
      vy: 0,
    });
  });
});
