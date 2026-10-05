import { describe, expect, it } from "vitest";
import {
  decomposeCandidates,
  decomposeSequence,
  recompose,
  multiply,
  type Matrix2D,
} from "../../src/utils/matrix.js";

const rad = (d: number) => (d * Math.PI) / 180;
const rotate = (d: number): Matrix2D => [
  Math.cos(rad(d)),
  Math.sin(rad(d)),
  -Math.sin(rad(d)),
  Math.cos(rad(d)),
  0,
  0,
];
const scale = (x: number, y = x): Matrix2D => [x, 0, 0, y, 0, 0];
const translate = (x: number, y: number): Matrix2D => [1, 0, 0, 1, x, y];
const skewX = (d: number): Matrix2D => [1, 0, Math.tan(rad(d)), 1, 0, 0];

function expectMatrixClose(a: Matrix2D, b: Matrix2D) {
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));
}

describe("transform decomposition", () => {
  it("round-trips translate · rotate · skew · scale", () => {
    const cases: Matrix2D[] = [
      translate(10, -4),
      rotate(30),
      multiply(translate(5, 6), multiply(rotate(-120), scale(2, 0.5))),
      multiply(rotate(45), multiply(skewX(20), scale(1.5, 3))),
      scale(-1, 1),
      scale(0, 2),
    ];
    for (const m of cases) {
      for (const cand of decomposeCandidates(m)) expectMatrixClose(recompose(cand), m);
    }
  });

  it("extracts CSS rotation in degrees (clockwise, like Lottie)", () => {
    const [d] = decomposeCandidates(multiply(translate(3, 4), multiply(rotate(30), scale(2))));
    expect(d!.rotation).toBeCloseTo(30);
    expect(d!.scaleX).toBeCloseTo(2);
    expect(d!.scaleY).toBeCloseTo(2);
    expect(d!.translateX).toBe(3);
    expect(d!.translateY).toBe(4);
    expect(d!.skew).toBeCloseTo(0);
  });

  it("maps skewX to the Lottie skew convention (sk = -angle)", () => {
    const [d] = decomposeCandidates(skewX(20));
    expect(d!.skew).toBeCloseTo(-20);
  });

  it("unwraps rotation across frames (full turns don't pop back to 0)", () => {
    const frames = [0, 90, 180, 270, 360, 450].map((a) => rotate(a));
    expect(decomposeSequence(frames).map((d) => Math.round(d.rotation))).toEqual([
      0, 90, 180, 270, 360, 450,
    ]);
  });

  it("keeps rotateY-style flips continuous (scaleX passes through 0 instead of rotating)", () => {
    const frames = [1, 0.5, 0, -0.5, -1].map((c) => scale(c, 1));
    const seq = decomposeSequence(frames);
    expect(seq.map((d) => Math.round(d.rotation))).toEqual([0, 0, 0, 0, 0]);
    expect(seq.map((d) => +d.scaleX.toFixed(2))).toEqual([1, 0.5, 0, -0.5, -1]);
  });
});
