import { describe, expect, it } from "vitest";
import { parseCssColor } from "../../src/utils/color.js";
import { stabilizeColors } from "../../src/converters/box.js";

describe("parseCssColor", () => {
  it("parses computed rgb()/rgba() values", () => {
    expect(parseCssColor("rgb(255, 0, 128)")).toEqual([1, 0, 128 / 255, 1]);
    expect(parseCssColor("rgba(0, 0, 0, 0.5)")).toEqual([0, 0, 0, 0.5]);
    expect(parseCssColor("rgb(10 20 30 / 25%)")).toEqual([10 / 255, 20 / 255, 30 / 255, 0.25]);
  });

  it("parses hex, hsl, named and color(srgb)", () => {
    expect(parseCssColor("#f00")).toEqual([1, 0, 0, 1]);
    expect(parseCssColor("#00ff0080")?.map((v) => +v.toFixed(3))).toEqual([0, 1, 0, 0.502]);
    expect(parseCssColor("hsl(120, 100%, 50%)")?.map((v) => +v.toFixed(3))).toEqual([0, 1, 0, 1]);
    expect(parseCssColor("transparent")).toEqual([0, 0, 0, 0]);
    expect(parseCssColor("white")).toEqual([1, 1, 1, 1]);
    expect(parseCssColor("color(srgb 0.5 0.25 1 / 0.5)")).toEqual([0.5, 0.25, 1, 0.5]);
  });

  it("returns null for paint servers and garbage", () => {
    expect(parseCssColor("none")).toBeNull();
    expect(parseCssColor('url("#grad") none')).toBeNull();
    expect(parseCssColor("not-a-color")).toBeNull();
    expect(parseCssColor("#12")).toBeNull();
    expect(parseCssColor(undefined)).toBeNull();
  });

  it("clamps channels", () => {
    expect(parseCssColor("rgb(300, -5, 0)")).toEqual([1, 0, 0, 1]);
  });
});

describe("stabilizeColors", () => {
  it("keeps the hue of fully transparent samples so fades don't pass through black", () => {
    const out = stabilizeColors([
      [0, 0, 0, 0],
      [1, 0, 0, 0.5],
      [0, 0, 0, 0],
    ]);
    expect(out).toEqual([
      [1, 0, 0, 0],
      [1, 0, 0, 0.5],
      [1, 0, 0, 0],
    ]);
  });
});
