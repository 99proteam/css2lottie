import { bezierToLottieHandles } from "../easing/cubic-bezier.js";
import type { TrackResult } from "../easing/keyframes.js";
import type { BezierShape } from "../converters/path-data.js";
import { unflattenShape } from "../converters/path-data.js";
import { round, roundArray } from "../utils/math.js";
import type {
  BezierPath,
  Keyframe,
  ScalarProperty,
  ShapeProperty,
  VectorProperty,
} from "./types.js";

function keyframes<T>(track: Extract<TrackResult, { kind: "animated" }>, pack: (v: number[]) => T) {
  const keys = track.keys;
  return keys.map((k, idx): Keyframe<T> => {
    const kf: Keyframe<T> = { t: round(k.t, 3), s: pack(k.s) };
    if (idx < keys.length - 1) {
      if (k.hold) kf.h = 1;
      else {
        const h = bezierToLottieHandles(k.easing);
        kf.o = h.o;
        kf.i = h.i;
      }
    }
    return kf;
  });
}

export function staticScalar(v: number, decimals = 3): ScalarProperty {
  return { a: 0, k: round(v, decimals) };
}

export function staticVector(v: number[], decimals = 3): VectorProperty {
  return { a: 0, k: roundArray(v, decimals) };
}

export function toScalarProperty(track: TrackResult, decimals = 3): ScalarProperty {
  if (track.kind === "static") return staticScalar(track.value[0]!, decimals);
  return { a: 1, k: keyframes(track, (v) => [round(v[0]!, decimals)]) };
}

export function toVectorProperty(track: TrackResult, decimals = 3): VectorProperty {
  if (track.kind === "static") return staticVector(track.value, decimals);
  return { a: 1, k: keyframes(track, (v) => roundArray(v, decimals)) };
}

export function shapeToLottie(s: BezierShape, decimals = 3): BezierPath {
  return {
    c: s.c,
    v: s.v.map((p) => roundArray(p, decimals)),
    i: s.i.map((p) => roundArray(p, decimals)),
    o: s.o.map((p) => roundArray(p, decimals)),
  };
}

export function toShapeProperty(track: TrackResult, closed: boolean, decimals = 3): ShapeProperty {
  if (track.kind === "static") {
    return { a: 0, k: shapeToLottie(unflattenShape(track.value, closed), decimals) };
  }
  return {
    a: 1,
    k: keyframes(track, (v) => [shapeToLottie(unflattenShape(v, closed), decimals)]),
  };
}
