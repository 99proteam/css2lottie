import { evaluateBezier, LINEAR, subBezier, type Bezier } from "./cubic-bezier.js";
import type { Segment } from "../timeline.js";

/** Intermediate keyframe representation (times in frames). */
export interface Key {
  t: number;
  s: number[];
  /** Easing toward the next key (ignored on the last key) */
  easing: Bezier;
  hold?: boolean;
}

export type TrackResult = { kind: "static"; value: number[] } | { kind: "animated"; keys: Key[] };

export interface TrackInput {
  /** Sample times in composition ms, ascending */
  times: number[];
  /** One value vector per sample time */
  values: number[][];
  fps: number;
  /** Composition end (ms) */
  end: number;
  /** Segments of the animations that can drive this channel */
  segments: Segment[];
  /** Max absolute deviation tolerated per component */
  tolerance: number;
  /** Disable easing detection (always per-frame + simplification) */
  noEasing?: boolean;
  /** Samples whose value is invisible and need not be matched (e.g. rotation at scale 0) */
  dontCare?: boolean[];
}

/** Statistics exposed for tests/debugging */
export interface TrackStats {
  easedIntervals: number;
  sampledIntervals: number;
}

const timeKey = (t: number) => Math.round(t * 1e6) / 1e6;
const HOLD_EPS_FRAMES = 0.01;

function maxDiff(a: number[], b: number[]): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
}

function lerpVec(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => v + (b[i]! - v) * t);
}

function sameBezier(a: Bezier, b: Bezier): boolean {
  return a.every((v, i) => Math.abs(v - b[i]!) < 1e-9);
}

/** Ramer–Douglas–Peucker on (time, vector) samples with linear interpolation. */
export function simplifyLinear(
  points: Array<{ t: number; v: number[] }>,
  tolerance: number,
): Array<{ t: number; v: number[] }> {
  if (points.length <= 2) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    const a = points[lo]!;
    const b = points[hi]!;
    let worst = -1;
    let worstErr = tolerance;
    for (let k = lo + 1; k < hi; k++) {
      const p = points[k]!;
      const u = (p.t - a.t) / (b.t - a.t);
      const err = maxDiff(p.v, lerpVec(a.v, b.v, u));
      if (err > worstErr) {
        worstErr = err;
        worst = k;
      }
    }
    if (worst >= 0) {
      keep[worst] = true;
      stack.push([lo, worst], [worst, hi]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Turn dense samples of one channel into Lottie-style keyframes.
 *
 * For every interval between animation segment edges it first tries to reproduce the sampled
 * curve with a single bezier-eased keyframe (the CSS timing function of the segment, or linear).
 * The candidate is accepted only if it matches every sampled frame within `tolerance`, so the
 * optimization can never change the look of the animation. Otherwise the interval falls back to
 * per-frame keys, simplified with RDP.
 */
export function buildTrack(input: TrackInput, stats?: TrackStats): TrackResult {
  const { times, fps, tolerance } = input;
  const dontCare = input.dontCare;
  const valid = (i: number) => !dontCare?.[i];
  // Don't-care samples take the value of the nearest valid neighbour (used for fallbacks).
  const values = fillDontCare(input.values, dontCare);
  const firstValid = values.find((_, i) => valid(i)) ?? values[0]!;
  if (values.every((v, i) => !valid(i) || maxDiff(v, firstValid) <= tolerance)) {
    return { kind: "static", value: [...firstValid] };
  }
  const index = new Map<number, number>();
  times.forEach((t, i) => index.set(timeKey(t), i));
  const frameMs = 1000 / fps;
  const isFrame = (t: number) => Math.abs(t / frameMs - Math.round(t / frameMs)) < 1e-6;
  const toFrame = (t: number) => {
    const f = (t * fps) / 1000;
    const r = Math.round(f);
    return Math.abs(f - r) < 1e-3 ? r : Math.round(f * 1000) / 1000;
  };
  const end = input.end;

  const edgeSet = new Set<number>([0, timeKey(end)]);
  if (!input.noEasing) {
    for (const s of input.segments) {
      for (const e of [s.start, s.clipEnd ?? s.end]) {
        if (e > 0 && e < end && index.has(timeKey(e))) edgeSet.add(timeKey(e));
      }
    }
  }
  const edges = [...edgeSet].sort((a, b) => a - b);
  const indexAt = (t: number) => index.get(timeKey(t));
  /** Index of the left limit at t (sample just before t when present). */
  const leftIndexAt = (t: number): number => indexAt(t - 0.01) ?? indexAt(t)!;
  /** Right-limit value at t, preferring the exact sample when continuous. */
  const leftValueAt = (t: number): number[] => {
    const l = values[leftIndexAt(t)]!;
    const exact = indexAt(t);
    return exact !== undefined && maxDiff(values[exact]!, l) <= tolerance ? values[exact]! : l;
  };

  const keys: Key[] = [];
  for (let e = 0; e + 1 < edges.length; e++) {
    const b0 = edges[e]!;
    const b1 = edges[e + 1]!;
    const i0 = indexAt(b0)!;
    const i1 = leftIndexAt(b1);
    const known0 = valid(i0);
    const known1 = valid(i1);
    const f0 = values[i0]!;
    const f1 = leftValueAt(b1);
    const interior: Array<{ t: number; v: number[] }> = [];
    for (let i = 0; i < times.length; i++) {
      const t = times[i]!;
      if (t > b0 + 1e-9 && t < b1 - 0.011 && isFrame(t) && valid(i))
        interior.push({ t, v: values[i]! });
    }
    // Candidate easings: the part of every segment covering this interval, then linear.
    const candidates: Bezier[] = [];
    for (const s of input.noEasing ? [] : input.segments) {
      if (!s.easing || s.start > b0 + 1e-6 || s.end < b1 - 1e-6) continue;
      const span = s.end - s.start;
      const c = subBezier(s.easing, (b0 - s.start) / span, (b1 - s.start) / span);
      if (c && !candidates.some((x) => sameBezier(x, c))) candidates.push(c);
    }
    if (!candidates.some((c) => sameBezier(c, LINEAR))) candidates.push(LINEAR);

    let chosen: { easing: Bezier; v0: number[] } | null = null;
    const constant =
      (!known0 || !known1 || maxDiff(f0, f1) <= tolerance) &&
      interior.every((p) => maxDiff(p.v, known0 ? f0 : (interior[0]?.v ?? f0)) <= tolerance);
    if (constant && (known0 || known1 || interior.length)) {
      chosen = { easing: LINEAR, v0: known0 ? f0 : known1 ? f1 : interior[0]!.v };
    } else {
      for (const c of candidates) {
        const ends = solveEnds(c, b0, b1, known0 ? f0 : null, known1 ? f1 : null, interior);
        if (!ends) continue;
        const [v0, v1] = ends;
        const ok = interior.every((p) => {
          const u = (p.t - b0) / (b1 - b0);
          return maxDiff(p.v, lerpVec(v0, v1, evaluateBezier(c, u))) <= tolerance;
        });
        if (ok) {
          chosen = { easing: c, v0 };
          break;
        }
      }
    }
    if (chosen) {
      keys.push({ t: toFrame(b0), s: [...chosen.v0], easing: chosen.easing });
      if (stats) stats.easedIntervals++;
    } else {
      const pts = simplifyLinear(
        [{ t: b0, v: f0 }, ...interior, { t: b1 - (b1 - b0 > 0.02 ? 0.01 : 0), v: f1 }],
        tolerance,
      );
      for (let k = 0; k < pts.length - 1; k++) {
        keys.push({ t: toFrame(pts[k]!.t), s: [...pts[k]!.v], easing: LINEAR });
      }
      if (stats) stats.sampledIntervals++;
    }
    // Discontinuity at b1 (fill-mode, delays, steps): hold the left value until just before b1.
    const ri = indexAt(b1);
    if (ri !== undefined && valid(ri) && known1 && e + 1 < edges.length - 1) {
      if (maxDiff(values[ri]!, f1) > tolerance) {
        keys.push({ t: toFrame(b1) - HOLD_EPS_FRAMES, s: [...f1], easing: LINEAR, hold: true });
      }
    }
  }
  keys.push({ t: toFrame(end), s: [...leftValueAt(end)], easing: LINEAR });

  return { kind: "animated", keys: mergeKeys(keys, tolerance) };
}

function fillDontCare(values: number[][], dontCare?: boolean[]): number[][] {
  if (!dontCare || !dontCare.some(Boolean)) return values;
  const out = values.slice();
  let last = -1;
  const firstValid = dontCare.findIndex((d) => !d);
  if (firstValid < 0) return values;
  for (let i = 0; i < out.length; i++) {
    if (!dontCare[i]) last = i;
    else out[i] = values[last >= 0 ? last : firstValid]!;
  }
  return out;
}

/**
 * Endpoint values for an eased interval. Unknown endpoints (don't-care samples, e.g. rotation
 * while scale is 0) are solved from the valid interior samples and the candidate easing.
 */
function solveEnds(
  c: Bezier,
  b0: number,
  b1: number,
  v0: number[] | null,
  v1: number[] | null,
  interior: Array<{ t: number; v: number[] }>,
): [number[], number[]] | null {
  if (v0 && v1) return [v0, v1];
  const E = (p: { t: number }) => evaluateBezier(c, (p.t - b0) / (b1 - b0));
  if (!v0 && v1) {
    const p = interior.find((q) => E(q) < 1 - 1e-3);
    if (!p) return null;
    const e = E(p);
    return [p.v.map((x, k) => (x - v1[k]! * e) / (1 - e)), v1];
  }
  if (v0 && !v1) {
    const p = [...interior].reverse().find((q) => E(q) > 1e-3);
    if (!p) return null;
    const e = E(p);
    return [v0, p.v.map((x, k) => v0[k]! + (x - v0[k]!) / e)];
  }
  const a = interior[0];
  const b = interior[interior.length - 1];
  if (!a || !b || Math.abs(E(b) - E(a)) < 1e-3) return null;
  const delta = b.v.map((x, k) => (x - a.v[k]!) / (E(b) - E(a)));
  const s0 = a.v.map((x, k) => x - delta[k]! * E(a));
  return [s0, s0.map((x, k) => x + delta[k]!)];
}

/** Remove keys that lie on a straight (linear) line between their neighbours. */
function mergeKeys(keys: Key[], tolerance: number): Key[] {
  const out: Key[] = [];
  for (const k of keys) {
    // Drop keys at identical times (keep the later one, which carries the right-hand value).
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.t - k.t) < 1e-6) {
      out[out.length - 1] = k;
      continue;
    }
    out.push(k);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i - 1]!;
      const b = out[i]!;
      const c = out[i + 1]!;
      if (a.hold || b.hold) continue;
      const constAB = maxDiff(a.s, b.s) <= tolerance / 2;
      const constBC = maxDiff(b.s, c.s) <= tolerance / 2;
      const linA = sameBezier(a.easing, LINEAR) || constAB;
      const linB = sameBezier(b.easing, LINEAR) || constBC;
      if (!linA || !linB) continue;
      const u = (b.t - a.t) / (c.t - a.t);
      if (maxDiff(b.s, lerpVec(a.s, c.s, u)) <= tolerance / 2) {
        a.easing = LINEAR;
        out.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return out;
}
