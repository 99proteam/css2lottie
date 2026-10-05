import type { AnimationInfo } from "./sampler/types.js";
import { parseEasing, reverseBezier, type Bezier } from "./easing/cubic-bezier.js";
import { lcm } from "./utils/math.js";

export interface Timeline {
  /** Timeline time (ms) that maps to composition frame 0 */
  startOffset: number;
  /** Composition duration (ms) */
  duration: number;
  fps: number;
  /** Last frame (Lottie `op`) */
  frames: number;
  /** True when the source contains infinite animations (composition should loop) */
  loop: boolean;
  /** Notes about how the duration was chosen */
  notes: string[];
}

export interface TimelineOptions {
  fps: number;
  /** Override duration in ms */
  duration?: number;
  /** Maximum auto-detected duration in ms (guards against huge LCMs) */
  maxDuration?: number;
}

const DEFAULT_STATIC_DURATION = 1000;

function activeDuration(a: AnimationInfo): number {
  if (a.iterations === null) return Infinity;
  return (a.duration * a.iterations) / Math.abs(a.playbackRate || 1);
}

/** Period after which an infinite animation repeats exactly. */
function period(a: AnimationInfo): number {
  const alt = a.direction === "alternate" || a.direction === "alternate-reverse";
  return (a.duration * (alt ? 2 : 1)) / Math.abs(a.playbackRate || 1);
}

/**
 * Decide composition length and start offset:
 * - only finite animations → play from 0 until the last one ends;
 * - only infinite animations → one seamless loop (LCM of periods) taken from the steady state
 *   (after the longest positive delay);
 * - mixed → from 0, long enough for finite ones, rounded up to a whole number of loop periods.
 */
export function computeTimeline(animations: AnimationInfo[], opts: TimelineOptions): Timeline {
  const fps = opts.fps;
  const maxDuration = opts.maxDuration ?? 30_000;
  const notes: string[] = [];
  const anims = animations.filter((a) => a.duration > 0 && a.nodeId !== null);
  const infinite = anims.filter((a) => a.iterations === null);
  const finite = anims.filter((a) => a.iterations !== null);

  let loopPeriod = 0;
  if (infinite.length) {
    loopPeriod = infinite.reduce((acc, a) => lcm(acc, Math.max(1, Math.round(period(a)))), 1);
    const maxPeriod = Math.max(...infinite.map(period));
    if (loopPeriod > maxDuration) {
      notes.push(
        `Infinite animations have periods whose least common multiple (${loopPeriod}ms) exceeds ${maxDuration}ms; using ${Math.round(maxPeriod)}ms, so the loop may not be seamless.`,
      );
      loopPeriod = maxPeriod;
    }
  }
  const finiteEnd = finite.reduce(
    (acc, a) => Math.max(acc, a.delay + activeDuration(a) + Math.max(0, a.endDelay)),
    0,
  );

  let startOffset = 0;
  let duration: number;
  if (infinite.length && !finite.length) {
    startOffset = Math.max(0, ...infinite.map((a) => a.delay));
    duration = loopPeriod;
  } else if (infinite.length) {
    duration = Math.ceil(finiteEnd / loopPeriod - 1e-9) * loopPeriod || loopPeriod;
    if (duration > maxDuration) duration = Math.max(finiteEnd, loopPeriod);
  } else {
    duration = finiteEnd;
  }
  if (!(duration > 0)) {
    duration = DEFAULT_STATIC_DURATION;
    notes.push("No CSS animations or transitions were found; produced a static 1s composition.");
  }
  if (opts.duration !== undefined && opts.duration > 0) duration = opts.duration;
  const frames = Math.max(1, Math.round((duration / 1000) * fps));
  return { startOffset, duration, fps, frames, loop: infinite.length > 0, notes };
}

/** One keyframe-to-keyframe segment of an animation, in composition time (ms). */
export interface Segment {
  animationId: number;
  nodeId: number;
  start: number;
  end: number;
  /** Easing as a bezier, or null when not representable (steps(), ...) */
  easing: Bezier | null;
  /** Where the segment is cut short (fractional iteration count); `end` stays the full end */
  clipEnd?: number;
  properties: string[];
}

/**
 * Expand an animation into its keyframe segments over the composition window, honouring delay,
 * iteration count, direction (reverse / alternate) and playback rate.
 */
export function animationSegments(a: AnimationInfo, tl: Timeline): Segment[] {
  if (a.nodeId === null || a.duration <= 0) return [];
  const rate = Math.abs(a.playbackRate || 1);
  const dur = a.duration / rate;
  const delay = a.delay / rate;
  const iterations = a.iterations === null ? Infinity : a.iterations;
  const out: Segment[] = [];
  const winStart = tl.startOffset;
  const winEnd = tl.startOffset + tl.duration;
  const effectEasing = parseEasing(a.easing);
  const effectLinear = a.easing === "linear";
  const kfs = [...a.keyframes].sort((x, y) => x.offset - y.offset);
  if (kfs.length < 2) return [];
  const pairs = kfs.length - 1;
  const firstIter = Math.max(0, Math.floor((winStart - delay) / dur));
  const iterationEnd = delay + dur * iterations;
  for (let k = firstIter; k < iterations && delay + k * dur < winEnd; k++) {
    const iterStart = delay + k * dur;
    const reversed =
      a.direction === "reverse" ||
      (a.direction === "alternate" && k % 2 === 1) ||
      (a.direction === "alternate-reverse" && k % 2 === 0);
    for (let j = 0; j < pairs; j++) {
      const o0 = kfs[j]!.offset;
      const o1 = kfs[j + 1]!.offset;
      if (o1 - o0 <= 0) continue;
      let easing: Bezier | null;
      const kfEasing = parseEasing(kfs[j]!.easing);
      if (effectLinear) easing = kfEasing;
      else if (
        pairs === 1 &&
        kfEasing &&
        kfEasing[0] === 0 &&
        kfEasing[1] === 0 &&
        kfEasing[2] === 1 &&
        kfEasing[3] === 1
      ) {
        easing = effectEasing;
      } else easing = null;
      let s: number;
      let e: number;
      if (!reversed) {
        s = iterStart + o0 * dur;
        e = iterStart + o1 * dur;
      } else {
        s = iterStart + (1 - o1) * dur;
        e = iterStart + (1 - o0) * dur;
        if (easing) easing = reverseBezier(easing);
      }
      if (s >= iterationEnd - 1e-6) continue;
      // A fractional iteration count cuts the last segment short.
      const clip = e > iterationEnd + 1e-6 ? iterationEnd : undefined;
      const visibleEnd = clip ?? e;
      if (visibleEnd <= winStart || s >= winEnd || visibleEnd <= s) continue;
      out.push({
        animationId: a.id,
        nodeId: a.nodeId,
        start: s - winStart,
        end: e - winStart,
        easing,
        properties: a.properties,
        ...(clip !== undefined ? { clipEnd: clip - winStart } : {}),
      });
    }
  }
  return out;
}

/** All composition times (ms) to sample: every frame plus both sides of every segment edge. */
export function sampleTimes(tl: Timeline, segments: Segment[], epsilon = 0.01): number[] {
  const set = new Set<number>();
  const key = (t: number) => Math.round(t * 1e6) / 1e6;
  for (let f = 0; f <= tl.frames; f++) set.add(key((f * 1000) / tl.fps));
  const end = (tl.frames * 1000) / tl.fps;
  for (const s of segments) {
    for (const edge of [s.start, s.clipEnd ?? s.end]) {
      if (edge > 0 && edge <= end) {
        set.add(key(edge));
        if (edge - epsilon > 0) set.add(key(edge - epsilon));
      } else if (edge === 0) set.add(0);
    }
  }
  return [...set].sort((a, b) => a - b);
}
