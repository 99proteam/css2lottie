import { describe, expect, it } from "vitest";
import {
  bezierToLottieHandles,
  evaluateBezier,
  parseEasing,
  reverseBezier,
  subBezier,
  type Bezier,
} from "../../src/easing/cubic-bezier.js";

describe("parseEasing", () => {
  it("maps CSS keywords to their cubic-bezier definitions", () => {
    expect(parseEasing("ease")).toEqual([0.25, 0.1, 0.25, 1]);
    expect(parseEasing("ease-in")).toEqual([0.42, 0, 1, 1]);
    expect(parseEasing("ease-out")).toEqual([0, 0, 0.58, 1]);
    expect(parseEasing("ease-in-out")).toEqual([0.42, 0, 0.58, 1]);
    expect(parseEasing("linear")).toEqual([0, 0, 1, 1]);
    expect(parseEasing("linear(0, 1)")).toEqual([0, 0, 1, 1]);
  });

  it("parses cubic-bezier() including overshoot", () => {
    expect(parseEasing("cubic-bezier(0.34, 1.56, 0.64, 1)")).toEqual([0.34, 1.56, 0.64, 1]);
  });

  it("returns null for easings that need per-frame sampling", () => {
    expect(parseEasing("steps(4, end)")).toBeNull();
    expect(parseEasing("linear(0, 0.25 75%, 1)")).toBeNull();
    expect(parseEasing("cubic-bezier(2, 0, 1, 1)")).toBeNull();
  });
});

describe("evaluateBezier", () => {
  it("is the identity for linear and hits the endpoints", () => {
    expect(evaluateBezier([0, 0, 1, 1], 0.3)).toBeCloseTo(0.3);
    expect(evaluateBezier([0.25, 0.1, 0.25, 1], 0)).toBe(0);
    expect(evaluateBezier([0.25, 0.1, 0.25, 1], 1)).toBe(1);
  });

  it("matches known values of `ease` (as computed by browsers)", () => {
    expect(evaluateBezier([0.25, 0.1, 0.25, 1], 0.5)).toBeCloseTo(0.8024, 3);
    expect(evaluateBezier([0.42, 0, 0.58, 1], 0.5)).toBeCloseTo(0.5, 6);
  });

  it("supports overshooting curves", () => {
    expect(evaluateBezier([0.34, 1.56, 0.64, 1], 0.6)).toBeGreaterThan(1);
  });
});

describe("reverseBezier", () => {
  it("mirrors the curve for reversed playback", () => {
    const b: Bezier = [0.42, 0, 1, 1];
    const r = reverseBezier(b);
    for (const x of [0.1, 0.4, 0.8])
      expect(evaluateBezier(r, x)).toBeCloseTo(1 - evaluateBezier(b, 1 - x), 6);
  });
});

describe("subBezier", () => {
  it("returns an easing that reproduces part of the original curve", () => {
    const b: Bezier = [0.25, 0.1, 0.25, 1];
    const [u0, u1] = [0.2, 0.7];
    const sub = subBezier(b, u0, u1)!;
    const y0 = evaluateBezier(b, u0);
    const y1 = evaluateBezier(b, u1);
    for (const x of [0.1, 0.3, 0.5, 0.9]) {
      const expected = (evaluateBezier(b, u0 + x * (u1 - u0)) - y0) / (y1 - y0);
      expect(evaluateBezier(sub, x)).toBeCloseTo(expected, 5);
    }
  });

  it("returns the curve itself for the full range", () => {
    expect(subBezier([0.1, 0.2, 0.3, 0.4], 0, 1)).toEqual([0.1, 0.2, 0.3, 0.4]);
  });
});

describe("bezierToLottieHandles", () => {
  it("puts (x1, y1) on the out tangent and (x2, y2) on the in tangent", () => {
    expect(bezierToLottieHandles([0.42, 0, 0.58, 1])).toEqual({
      o: { x: [0.42], y: [0] },
      i: { x: [0.58], y: [1] },
    });
  });
});
