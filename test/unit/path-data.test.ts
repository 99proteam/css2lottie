import { describe, expect, it } from "vitest";
import {
  arcToCubics,
  flattenShape,
  pathDataToShapes,
  pointsToShape,
  roundedRectShape,
  tokenizePath,
  unflattenShape,
} from "../../src/converters/path-data.js";

describe("tokenizePath", () => {
  it("handles compact numbers, implicit commands and arc flags", () => {
    expect(tokenizePath("M1.5.5L-2-3")).toEqual([
      ["M", [1.5, 0.5]],
      ["L", [-2, -3]],
    ]);
    expect(tokenizePath("m0 0 10 0 0 10z")).toEqual([
      ["m", [0, 0]],
      ["l", [10, 0]],
      ["l", [0, 10]],
      ["z", []],
    ]);
    expect(tokenizePath("M0 0a5 5 0 1010 0")).toEqual([
      ["M", [0, 0]],
      ["a", [5, 5, 0, 1, 0, 10, 0]],
    ]);
    expect(tokenizePath("M1e2 2E-1")).toEqual([["M", [100, 0.2]]]);
  });

  it("rejects invalid data", () => {
    expect(() => tokenizePath("10 10")).toThrow();
    expect(() => tokenizePath("M 10")).toThrow();
    expect(() => tokenizePath("M 0 0 X 1")).toThrow();
  });
});

describe("pathDataToShapes", () => {
  it("converts lines to vertices with zero tangents", () => {
    const [s] = pathDataToShapes("M0 0 H10 V10 L0 10 Z");
    expect(s).toEqual({
      c: true,
      v: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      i: [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      o: [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
    });
  });

  it("stores cubic control points as tangents relative to their vertex", () => {
    const [s] = pathDataToShapes("M0 0 C 0 10 20 10 20 0");
    expect(s!.v).toEqual([
      [0, 0],
      [20, 0],
    ]);
    expect(s!.o[0]).toEqual([0, 10]);
    expect(s!.i[1]).toEqual([0, 10]);
    expect(s!.c).toBe(false);
  });

  it("supports relative commands, smooth curves and quadratics", () => {
    const [s] = pathDataToShapes("m10 10 c0 5 5 5 5 0 s5 -5 5 0 q5 5 10 0 t10 0");
    expect(s!.v.map((p) => p.map((n) => +n.toFixed(4)))).toEqual([
      [10, 10],
      [15, 10],
      [20, 10],
      [30, 10],
      [40, 10],
    ]);
    // S reflects the previous control point: (15,15) mirrored around (15,10) → (15,5)
    expect(s!.o[1]).toEqual([0, -5]);
    // Q is elevated to a cubic: control at 2/3 towards (25,15)
    expect(s!.o[2]!.map((n) => +n.toFixed(4))).toEqual([3.3333, 3.3333]);
  });

  it("merges the closing vertex of closed paths and splits sub-paths", () => {
    const shapes = pathDataToShapes("M0 0 L10 0 L10 10 L0 0 Z M20 20 L30 20");
    expect(shapes).toHaveLength(2);
    expect(shapes[0]!.v).toHaveLength(3);
    expect(shapes[0]!.c).toBe(true);
    expect(shapes[1]!.c).toBe(false);
  });

  it("converts arcs to cubic segments that stay on the ellipse", () => {
    const segs = arcToCubics([0, 0], 10, 10, 0, 0, 1, [20, 0]);
    expect(segs.length).toBe(2);
    const end = segs[segs.length - 1]!.p;
    expect(end[0]).toBeCloseTo(20);
    expect(end[1]).toBeCloseTo(0);
    // Mid-point of a semicircle above or below the chord is 10 away from the centre (10, 0).
    const mid = segs[0]!.p;
    expect(Math.hypot(mid[0] - 10, mid[1])).toBeCloseTo(10, 5);
  });

  it("scales up radii that are too small (SVG arc rules)", () => {
    const segs = arcToCubics([0, 0], 1, 1, 0, 0, 1, [20, 0]);
    expect(segs[segs.length - 1]!.p[0]).toBeCloseTo(20);
  });
});

describe("shape helpers", () => {
  it("parses polygon points", () => {
    expect(pointsToShape("0,0 10,0 5 10", true)!.v).toEqual([
      [0, 0],
      [10, 0],
      [5, 10],
    ]);
    expect(pointsToShape("1", true)).toBeNull();
  });

  it("builds an 8-vertex rounded rect and round-trips flattening", () => {
    const s = roundedRectShape(0, 0, 100, 50, [10, 10, 10, 10, 10, 10, 10, 10]);
    expect(s.v).toHaveLength(8);
    expect(s.v[0]).toEqual([10, 0]);
    expect(unflattenShape(flattenShape(s), true)).toEqual(s);
  });
});
