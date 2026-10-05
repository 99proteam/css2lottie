import { describe, expect, it } from "vitest";
import { animationSegments, computeTimeline, sampleTimes } from "../../src/timeline.js";
import type { AnimationInfo } from "../../src/sampler/types.js";

function anim(partial: Partial<AnimationInfo>): AnimationInfo {
  return {
    id: 0,
    kind: "css-animation",
    name: "a",
    nodeId: 0,
    selector: "div",
    delay: 0,
    endDelay: 0,
    duration: 1000,
    iterations: 1,
    iterationStart: 0,
    direction: "normal",
    fill: "none",
    easing: "linear",
    playbackRate: 1,
    keyframes: [
      { offset: 0, easing: "ease" },
      { offset: 1, easing: "ease" },
    ],
    properties: ["opacity"],
    ...partial,
  };
}

describe("computeTimeline", () => {
  it("uses the end of the longest finite animation (delay included)", () => {
    const tl = computeTimeline(
      [anim({ duration: 500, delay: 250 }), anim({ duration: 600, iterations: 2 })],
      { fps: 60 },
    );
    expect(tl.duration).toBe(1200);
    expect(tl.frames).toBe(72);
    expect(tl.loop).toBe(false);
  });

  it("loops infinite animations over the LCM of their periods (alternate doubles the period)", () => {
    const tl = computeTimeline(
      [
        anim({ iterations: null, duration: 400 }),
        anim({ iterations: null, duration: 300, direction: "alternate" }),
      ],
      { fps: 60 },
    );
    expect(tl.duration).toBe(1200);
    expect(tl.loop).toBe(true);
  });

  it("starts infinite-only loops in the steady state after the longest delay", () => {
    const tl = computeTimeline(
      [
        anim({ iterations: null, delay: 400, duration: 600 }),
        anim({ iterations: null, duration: 600 }),
      ],
      { fps: 60 },
    );
    expect(tl.startOffset).toBe(400);
    expect(tl.duration).toBe(600);
  });

  it("rounds mixed compositions up to whole loop periods", () => {
    const tl = computeTimeline(
      [anim({ iterations: null, duration: 500 }), anim({ duration: 1200 })],
      { fps: 60 },
    );
    expect(tl.duration).toBe(1500);
  });

  it("honours an explicit duration and handles static pages", () => {
    expect(computeTimeline([anim({})], { fps: 30, duration: 2000 }).frames).toBe(60);
    const empty = computeTimeline([], { fps: 60 });
    expect(empty.duration).toBe(1000);
    expect(empty.notes.length).toBe(1);
  });
});

describe("animationSegments", () => {
  const tl = { startOffset: 0, duration: 3000, fps: 60, frames: 180, loop: false, notes: [] };

  it("expands iterations with delays and keyframe easings", () => {
    const segs = animationSegments(anim({ delay: 100, iterations: 2 }), tl);
    expect(segs.map((s) => [s.start, s.end])).toEqual([
      [100, 1100],
      [1100, 2100],
    ]);
    expect(segs[0]!.easing).toEqual([0.25, 0.1, 0.25, 1]);
  });

  it("reverses timing for alternate iterations", () => {
    const segs = animationSegments(
      anim({
        iterations: 2,
        direction: "alternate",
        keyframes: [
          { offset: 0, easing: "ease-in" },
          { offset: 1, easing: "linear" },
        ],
      }),
      tl,
    );
    expect(segs[0]!.easing).toEqual([0.42, 0, 1, 1]);
    segs[1]!.easing!.forEach((v, i) => expect(v).toBeCloseTo([0, 0, 0.58, 1][i]!, 9));
  });

  it("splits multi-keyframe animations and uses the effect easing for transitions", () => {
    const multi = animationSegments(
      anim({
        keyframes: [
          { offset: 0, easing: "linear" },
          { offset: 0.25, easing: "ease-out" },
          { offset: 1, easing: "linear" },
        ],
      }),
      tl,
    );
    expect(multi.map((s) => [s.start, s.end])).toEqual([
      [0, 250],
      [250, 1000],
    ]);
    const transition = animationSegments(
      anim({
        kind: "css-transition",
        easing: "ease-in-out",
        keyframes: [
          { offset: 0, easing: "linear" },
          { offset: 1, easing: "linear" },
        ],
      }),
      tl,
    );
    expect(transition[0]!.easing).toEqual([0.42, 0, 0.58, 1]);
  });

  it("marks fractional iteration ends", () => {
    const segs = animationSegments(anim({ iterations: 1.5 }), tl);
    expect(segs[1]!.clipEnd).toBe(1500);
  });

  it("produces sample times that bracket every segment edge", () => {
    const segs = animationSegments(anim({ delay: 105 }), tl);
    const times = sampleTimes(tl, segs);
    expect(times).toContain(105);
    expect(times).toContain(104.99);
    expect(times).toContain(0);
    expect(times[times.length - 1]).toBe(3000);
  });
});
