import { describe, expect, it } from "vitest";
import { buildTrack, simplifyLinear, type TrackResult } from "../../src/easing/keyframes.js";
import { evaluateBezier, type Bezier } from "../../src/easing/cubic-bezier.js";
import type { Segment } from "../../src/timeline.js";

const fps = 60;
const frameMs = 1000 / fps;

function sample(fn: (t: number) => number, endMs: number, extra: number[] = []) {
  const set = new Set<number>();
  for (let f = 0; f * frameMs <= endMs + 1e-9; f++) set.add(Math.round(f * frameMs * 1e6) / 1e6);
  for (const e of extra) {
    set.add(e);
    if (e > 0) set.add(Math.round((e - 0.01) * 1e6) / 1e6);
  }
  const times = [...set].sort((a, b) => a - b);
  return { times, values: times.map((t) => [fn(t)]) };
}

function seg(start: number, end: number, easing: Bezier | null): Segment {
  return { animationId: 0, nodeId: 0, start, end, easing, properties: ["opacity"] };
}

function animated(r: TrackResult) {
  if (r.kind !== "animated") throw new Error("expected animated track");
  return r.keys;
}

describe("buildTrack", () => {
  it("returns a static value for constant samples", () => {
    const { times, values } = sample(() => 5, 1000);
    expect(buildTrack({ times, values, fps, end: 1000, segments: [], tolerance: 0.01 })).toEqual({
      kind: "static",
      value: [5],
    });
  });

  it("emits a single eased keyframe when the CSS timing function matches the samples", () => {
    const ease: Bezier = [0.42, 0, 0.58, 1];
    const { times, values } = sample((t) => 100 * evaluateBezier(ease, t / 1000), 1000);
    const keys = animated(
      buildTrack({
        times,
        values,
        fps,
        end: 1000,
        segments: [seg(0, 1000, ease)],
        tolerance: 0.05,
      }),
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatchObject({ t: 0, s: [0], easing: ease });
    expect(keys[1]).toMatchObject({ t: 60, s: [100] });
  });

  it("detects linear motion without any segment info", () => {
    const { times, values } = sample((t) => t / 10, 1000);
    const keys = animated(
      buildTrack({ times, values, fps, end: 1000, segments: [], tolerance: 0.05 }),
    );
    expect(keys).toHaveLength(2);
  });

  it("falls back to simplified per-frame keys when the curve isn't a bezier", () => {
    const { times, values } = sample((t) => Math.sin((t / 1000) * Math.PI * 2) * 50, 1000);
    const stats = { easedIntervals: 0, sampledIntervals: 0 };
    const keys = animated(
      buildTrack(
        {
          times,
          values,
          fps,
          end: 1000,
          segments: [seg(0, 1000, [0.42, 0, 0.58, 1])],
          tolerance: 0.1,
        },
        stats,
      ),
    );
    expect(stats.sampledIntervals).toBe(1);
    expect(keys.length).toBeGreaterThan(4);
    expect(keys.length).toBeLessThan(61);
    // Every original frame is reproduced within tolerance by linear interpolation of the keys.
    for (let f = 0; f <= 60; f++) {
      const k = keys.findIndex((key, i) => key.t <= f && (keys[i + 1]?.t ?? Infinity) >= f);
      const a = keys[k]!;
      const b = keys[k + 1] ?? a;
      const u = b.t === a.t ? 0 : (f - a.t) / (b.t - a.t);
      const v = a.s[0]! + (b.s[0]! - a.s[0]!) * u;
      expect(Math.abs(v - Math.sin((f / 60) * Math.PI * 2) * 50)).toBeLessThan(0.11);
    }
  });

  it("uses hold keyframes for discontinuities (e.g. fill-mode: none)", () => {
    // Value ramps 0→1 during [0, 500) then snaps back to 0.
    const { times, values } = sample((t) => (t < 500 ? t / 500 : 0), 1000, [500]);
    const keys = animated(
      buildTrack({
        times,
        values,
        fps,
        end: 1000,
        segments: [seg(0, 500, [0, 0, 1, 1])],
        tolerance: 0.001,
      }),
    );
    const hold = keys.find((k) => k.hold);
    expect(hold).toBeDefined();
    expect(hold!.s[0]).toBeCloseTo(1, 2);
    expect(keys[keys.length - 1]!.s).toEqual([0]);
  });

  it("ignores don't-care samples and solves the hidden endpoint from the easing", () => {
    // Rotation from -90 to 0 with ease-out; frame 0 is invisible (scale 0) and reads 0.
    const ease: Bezier = [0, 0, 0.58, 1];
    const { times, values } = sample(
      (t) => (t === 0 ? 0 : -90 + 90 * evaluateBezier(ease, t / 1000)),
      1000,
    );
    const dontCare = times.map((t) => t === 0);
    const keys = animated(
      buildTrack({
        times,
        values,
        fps,
        end: 1000,
        segments: [seg(0, 1000, ease)],
        tolerance: 0.05,
        dontCare,
      }),
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]!.s[0]).toBeCloseTo(-90, 1);
  });

  it("uses the sub-curve of a segment that starts before the composition", () => {
    const ease: Bezier = [0.25, 0.1, 0.25, 1];
    // Segment from -200ms to 800ms; composition starts at 0.
    const f = (t: number) => 100 * evaluateBezier(ease, (t + 200) / 1000);
    const { times, values } = sample(f, 800);
    const keys = animated(
      buildTrack({
        times,
        values,
        fps,
        end: 800,
        segments: [seg(-200, 800, ease)],
        tolerance: 0.05,
      }),
    );
    expect(keys).toHaveLength(2);
  });

  it("can be told not to optimize", () => {
    const { times, values } = sample((t) => t / 10, 1000);
    const stats = { easedIntervals: 0, sampledIntervals: 0 };
    buildTrack(
      { times, values, fps, end: 1000, segments: [], tolerance: 0.05, noEasing: true },
      stats,
    );
    expect(stats.easedIntervals).toBe(1); // linear is still detected as the trivial "easing"
  });
});

describe("simplifyLinear", () => {
  it("drops collinear points", () => {
    const pts = [0, 1, 2, 3, 4].map((t) => ({ t, v: [t * 2] }));
    expect(simplifyLinear(pts, 0.01)).toEqual([pts[0], pts[4]]);
  });

  it("keeps corners", () => {
    const pts = [0, 1, 2, 3, 4].map((t) => ({ t, v: [t < 2 ? t : 4 - t] }));
    expect(simplifyLinear(pts, 0.01).map((p) => p.t)).toEqual([0, 2, 4]);
  });
});
