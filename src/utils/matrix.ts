/** 2D affine matrix in CSS order: [a, b, c, d, e, f]  (x' = a*x + c*y + e, y' = b*x + d*y + f). */
export type Matrix2D = [number, number, number, number, number, number];

export const IDENTITY: Matrix2D = [1, 0, 0, 1, 0, 0];

/** Decomposed transform in Lottie terms. Angles in degrees, scales as factors (1 = 100%). */
export interface DecomposedTransform {
  translateX: number;
  translateY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  /** Lottie skew angle (degrees) with skew axis 0. */
  skew: number;
}

const RAD = 180 / Math.PI;

export function multiply(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function determinant(m: Matrix2D): number {
  return m[0] * m[3] - m[1] * m[2];
}

/**
 * Decompose the linear part as  M = R(rotation) · ShearX(k) · Scale(sx, sy),  which matches the
 * order Lottie applies transforms (scale → skew → rotate → translate).
 *
 * Returns two equivalent candidates (rotation, rotation + 180° with both scales negated) so
 * callers can pick the one that is continuous with the previous frame — this keeps
 * `rotateY(180deg)` flips and full turns from popping.
 */
export function decomposeCandidates(m: Matrix2D): DecomposedTransform[] {
  const [a, b, c, d, e, f] = m;
  let sx = Math.hypot(a, b);
  let rotation: number;
  let shear: number;
  let sy: number;
  if (sx < 1e-9) {
    // Degenerate x-axis (e.g. scaleX(0)). Derive rotation from the y column instead.
    sx = 0;
    const syAbs = Math.hypot(c, d);
    rotation = syAbs < 1e-9 ? 0 : Math.atan2(-c, d) * RAD;
    sy = syAbs;
    shear = 0;
  } else {
    rotation = Math.atan2(b, a) * RAD;
    const cos = a / sx;
    const sin = b / sx;
    // R(-θ)·M  →  [[sx, m], [0, sy]]
    const m12 = cos * c + sin * d;
    sy = -sin * c + cos * d;
    shear = Math.abs(sy) < 1e-9 ? 0 : m12 / sy;
  }
  // Lottie skew: skewFromAxis(-sk) yields ShearX(tan(-sk)) ⇒ sk = -atan(k).
  const skew = -Math.atan(shear) * RAD;
  const base: DecomposedTransform = {
    translateX: e,
    translateY: f,
    rotation,
    scaleX: sx,
    scaleY: sy,
    skew,
  };
  const flipped: DecomposedTransform = {
    ...base,
    rotation: rotation + 180,
    scaleX: -sx,
    scaleY: -sy,
  };
  return [base, flipped];
}

function unwrapAngle(angle: number, reference: number): number {
  return angle + 360 * Math.round((reference - angle) / 360);
}

/**
 * Decompose a sequence of matrices into continuous transform channels: rotation is unwrapped
 * (no ±360° jumps) and the representation closest to the previous frame is chosen.
 */
export function decomposeSequence(matrices: Matrix2D[]): DecomposedTransform[] {
  const out: DecomposedTransform[] = [];
  let prev: DecomposedTransform | undefined;
  for (const m of matrices) {
    const candidates = decomposeCandidates(m).map((cand) => ({
      ...cand,
      rotation: prev ? unwrapAngle(cand.rotation, prev.rotation) : cand.rotation,
    }));
    let best: DecomposedTransform;
    if (prev) {
      const p = prev;
      const cost = (t: DecomposedTransform) =>
        Math.abs(t.rotation - p.rotation) / 90 +
        Math.abs(t.scaleX - p.scaleX) +
        Math.abs(t.scaleY - p.scaleY);
      best = candidates.reduce((acc, cand) => (cost(cand) < cost(acc) - 1e-9 ? cand : acc));
    } else {
      // First frame: prefer positive scales and the smallest absolute rotation.
      const score = (t: DecomposedTransform) =>
        (t.scaleX < 0 ? 1 : 0) + (t.scaleY < 0 ? 1 : 0) + Math.abs(t.rotation) / 1000;
      const normalized = candidates.map((cand) => ({
        ...cand,
        rotation: cand.rotation > 180 ? cand.rotation - 360 : cand.rotation,
      }));
      best = normalized.reduce((acc, cand) => (score(cand) < score(acc) ? cand : acc));
    }
    out.push(best);
    prev = best;
  }
  return out;
}

/** Recompose (used by tests): T · R · ShearX · S, with Lottie skew convention. */
export function recompose(t: DecomposedTransform): Matrix2D {
  const r = t.rotation / RAD;
  const k = Math.tan(-t.skew / RAD);
  const rot: Matrix2D = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
  const shear: Matrix2D = [1, 0, k, 1, 0, 0];
  const scale: Matrix2D = [t.scaleX, 0, 0, t.scaleY, 0, 0];
  const lin = multiply(multiply(rot, shear), scale);
  return [lin[0], lin[1], lin[2], lin[3], t.translateX, t.translateY];
}
