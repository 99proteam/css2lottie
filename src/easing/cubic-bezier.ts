/** A CSS/Lottie cubic-bezier easing curve: control points (x1, y1) and (x2, y2). */
export type Bezier = [number, number, number, number];

export const LINEAR: Bezier = [0, 0, 1, 1];

const NAMED_EASINGS: Record<string, Bezier> = {
  linear: LINEAR,
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

/**
 * Parse a CSS `<easing-function>` into a cubic bezier. Returns `null` for easings that cannot be
 * expressed as one bezier (`steps()`, `linear(...)` with stops, unknown values) — the caller then
 * falls back to per-frame sampling.
 */
export function parseEasing(value: string | null | undefined): Bezier | null {
  if (!value) return LINEAR;
  const v = value.trim().toLowerCase();
  if (v in NAMED_EASINGS) return [...NAMED_EASINGS[v]!] as Bezier;
  const m = /^cubic-bezier\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)$/.exec(v);
  if (m) {
    const nums = m.slice(1, 5).map(Number) as Bezier;
    if (nums.some((n) => !Number.isFinite(n))) return null;
    if (nums[0] < 0 || nums[0] > 1 || nums[2] < 0 || nums[2] > 1) return null;
    return nums;
  }
  // `linear(0, 1)` / `linear(0 0%, 1 100%)` is plain linear.
  const lin = /^linear\((.*)\)$/.exec(v);
  if (lin) {
    const stops = lin[1]!.split(",").map((s) => s.trim());
    if (stops.length === 2 && parseFloat(stops[0]!) === 0 && parseFloat(stops[1]!) === 1) {
      return LINEAR;
    }
  }
  return null;
}

export function isLinear(b: Bezier): boolean {
  return b[0] === b[1] && b[2] === b[3];
}

/** Easing for the same segment played backwards (animation-direction: reverse/alternate). */
export function reverseBezier(b: Bezier): Bezier {
  return [1 - b[2], 1 - b[3], 1 - b[0], 1 - b[1]];
}

/** Evaluate a cubic bezier easing at progress x ∈ [0, 1] (same algorithm family as browsers). */
export function evaluateBezier(b: Bezier, x: number): number {
  const [x1, y1, x2, y2] = b;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x1 === y1 && x2 === y2) return x;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  // Newton-Raphson first, bisection as a fallback.
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = sampleX(t) - x;
    if (Math.abs(err) < 1e-7) return sampleY(t);
    const d = sampleDX(t);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 60; i++) {
    const v = sampleX(t);
    if (Math.abs(v - x) < 1e-7) break;
    if (v < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return sampleY(t);
}

/** Lottie keyframe easing handles for a bezier: out tangent of the start key, in of the end key. */
export function bezierToLottieHandles(b: Bezier): {
  o: { x: number[]; y: number[] };
  i: { x: number[]; y: number[] };
} {
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return {
    o: { x: [r(b[0])], y: [r(b[1])] },
    i: { x: [r(b[2])], y: [r(b[3])] },
  };
}

/** Parameter s where the bezier's x(s) equals x (x monotonic for valid CSS easings). */
function solveParam(b: Bezier, x: number): number {
  const [x1, , x2] = b;
  const bx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (bx(mid) < x) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

type Pt = [number, number];

function splitCubic(
  p: [Pt, Pt, Pt, Pt],
  t: number,
): { left: [Pt, Pt, Pt, Pt]; right: [Pt, Pt, Pt, Pt] } {
  const lerp = (a: Pt, b: Pt): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const [p0, p1, p2, p3] = p;
  const a = lerp(p0, p1);
  const b = lerp(p1, p2);
  const c = lerp(p2, p3);
  const d = lerp(a, b);
  const e = lerp(b, c);
  const f = lerp(d, e);
  return { left: [p0, a, d, f], right: [f, e, c, p3] };
}

/**
 * The part of an easing curve between progress u0 and u1, re-normalized to the unit square.
 * A sub-range of a cubic bezier is itself a cubic bezier, so a keyframe interval that covers only
 * part of a CSS segment (loop windows, overlapping animations) can still use exact easing.
 * Returns null when the value does not change over the sub-range.
 */
export function subBezier(b: Bezier, u0: number, u1: number): Bezier | null {
  if (u0 <= 1e-9 && u1 >= 1 - 1e-9) return b;
  const s0 = u0 <= 0 ? 0 : solveParam(b, u0);
  const s1 = u1 >= 1 ? 1 : solveParam(b, u1);
  let pts: [Pt, Pt, Pt, Pt] = [
    [0, 0],
    [b[0], b[1]],
    [b[2], b[3]],
    [1, 1],
  ];
  // Cut the tail first, then the head (re-parameterized on the remaining curve).
  if (s1 < 1) pts = splitCubic(pts, s1).left;
  if (s0 > 0) pts = splitCubic(pts, s0 / s1).right;
  const [p0, p1, p2, p3] = pts;
  const dx = p3[0] - p0[0];
  const dy = p3[1] - p0[1];
  if (Math.abs(dx) < 1e-12 || Math.abs(dy) < 1e-9) return null;
  const nx = (v: number) => (v - p0[0]) / dx;
  const ny = (v: number) => (v - p0[1]) / dy;
  const out: Bezier = [nx(p1[0]), ny(p1[1]), nx(p2[0]), ny(p2[1])];
  if (out[0] < -1e-9 || out[0] > 1 + 1e-9 || out[2] < -1e-9 || out[2] > 1 + 1e-9) return null;
  return [Math.min(1, Math.max(0, out[0])), out[1], Math.min(1, Math.max(0, out[2])), out[3]];
}
