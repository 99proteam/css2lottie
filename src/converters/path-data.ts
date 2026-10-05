/**
 * SVG path data → Lottie bezier shapes.
 *
 * Lottie stores a path as vertices `v` plus in/out tangents `i`/`o` that are *relative* to
 * their vertex, and a `c` (closed) flag. Every SVG command is converted to cubic segments.
 */

export type Point = [number, number];

export interface BezierShape {
  /** Closed */
  c: boolean;
  /** Vertices */
  v: Point[];
  /** In tangents (relative to vertex) */
  i: Point[];
  /** Out tangents (relative to vertex) */
  o: Point[];
}

interface CubicSegment {
  c1: Point;
  c2: Point;
  p: Point;
}

interface SubPath {
  start: Point;
  segs: CubicSegment[];
  closed: boolean;
}

const ARG_COUNTS: Record<string, number> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};

/** Tokenize path data into [command, args[]] pairs, handling compact numbers and arc flags. */
export function tokenizePath(d: string): Array<[string, number[]]> {
  const out: Array<[string, number[]]> = [];
  let i = 0;
  const n = d.length;
  let cmd: string | null = null;
  let args: number[] = [];

  const isWs = (ch: string) =>
    ch === " " || ch === "," || ch === "\n" || ch === "\t" || ch === "\r";

  const readNumber = (): number | null => {
    while (i < n && isWs(d[i]!)) i++;
    const start = i;
    if (d[i] === "+" || d[i] === "-") i++;
    let sawDigit = false;
    while (i < n && /[0-9]/.test(d[i]!)) {
      i++;
      sawDigit = true;
    }
    if (d[i] === ".") {
      i++;
      while (i < n && /[0-9]/.test(d[i]!)) {
        i++;
        sawDigit = true;
      }
    }
    if (!sawDigit) {
      i = start;
      return null;
    }
    if (d[i] === "e" || d[i] === "E") {
      const save = i;
      i++;
      if (d[i] === "+" || d[i] === "-") i++;
      if (!/[0-9]/.test(d[i] ?? "")) i = save;
      else while (i < n && /[0-9]/.test(d[i]!)) i++;
    }
    return parseFloat(d.slice(start, i));
  };

  const readFlag = (): number | null => {
    while (i < n && isWs(d[i]!)) i++;
    if (d[i] === "0" || d[i] === "1") return d[i++] === "1" ? 1 : 0;
    return null;
  };

  const flush = () => {
    if (cmd !== null && args.length > 0) throw new Error(`Incomplete arguments for "${cmd}"`);
    args = [];
  };

  while (i < n) {
    const ch = d[i]!;
    if (isWs(ch)) {
      i++;
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      if (!(ch.toLowerCase() in ARG_COUNTS)) throw new Error(`Unsupported path command "${ch}"`);
      flush();
      cmd = ch;
      i++;
      if (ch === "z" || ch === "Z") {
        out.push([ch, []]);
        cmd = null;
      }
      continue;
    }
    if (cmd === null)
      throw new Error(`Path data must start with a command near "${d.slice(i, i + 10)}"`);
    const lower = cmd.toLowerCase();
    const count = ARG_COUNTS[lower]!;
    // Arc flags (args index 3, 4) may be written without separators.
    const idx = args.length % count;
    const value = lower === "a" && (idx === 3 || idx === 4) ? readFlag() : readNumber();
    if (value === null) throw new Error(`Invalid path data near "${d.slice(i, i + 10)}"`);
    args.push(value);
    if (args.length === count) {
      out.push([cmd, args]);
      args = [];
      // Implicit repeat: extra coordinate pairs after M are treated as L.
      if (cmd === "M") cmd = "L";
      else if (cmd === "m") cmd = "l";
    }
  }
  if (cmd !== null && args.length > 0) throw new Error("Incomplete path data");
  return out;
}

function line(from: Point, to: Point): CubicSegment {
  return { c1: [...from] as Point, c2: [...to] as Point, p: [...to] as Point };
}

function quadToCubic(p0: Point, q: Point, p: Point): CubicSegment {
  return {
    c1: [p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])],
    c2: [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])],
    p: [...p] as Point,
  };
}

/** Convert an SVG elliptical arc to cubic segments (SVG implementation notes, F.6). */
export function arcToCubics(
  p0: Point,
  rxIn: number,
  ryIn: number,
  angleDeg: number,
  largeArc: number,
  sweep: number,
  p: Point,
): CubicSegment[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if ((p0[0] === p[0] && p0[1] === p[1]) || rx === 0 || ry === 0) {
    return p0[0] === p[0] && p0[1] === p[1] ? [] : [line(p0, p)];
  }
  const phi = (angleDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (p0[0] - p[0]) / 2;
  const dy = (p0[1] - p[1]) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (p0[0] + p[0]) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (p0[1] + p[1]) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;

  const segCount = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / segCount;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: CubicSegment[] = [];
  const pointAt = (t: number): Point => {
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    return [cosPhi * x - sinPhi * y + cx, sinPhi * x + cosPhi * y + cy];
  };
  const derivAt = (t: number): Point => {
    const x = -rx * Math.sin(t);
    const y = ry * Math.cos(t);
    return [cosPhi * x - sinPhi * y, sinPhi * x + cosPhi * y];
  };
  let t = theta1;
  let from = p0;
  for (let s = 0; s < segCount; s++) {
    const t2 = t + step;
    const d1 = derivAt(t);
    const d2 = derivAt(t2);
    const to = s === segCount - 1 ? ([...p] as Point) : pointAt(t2);
    out.push({
      c1: [from[0] + k * d1[0], from[1] + k * d1[1]],
      c2: [to[0] - k * d2[0], to[1] - k * d2[1]],
      p: to,
    });
    from = to;
    t = t2;
  }
  return out;
}

/** Parse SVG path data into absolute cubic sub-paths. */
export function parsePathToSubpaths(d: string): SubPath[] {
  const tokens = tokenizePath(d);
  const subpaths: SubPath[] = [];
  let current: SubPath | null = null;
  let pos: Point = [0, 0];
  let start: Point = [0, 0];
  let lastCubicCtrl: Point | null = null;
  let lastQuadCtrl: Point | null = null;

  const ensure = (): SubPath => {
    if (!current) {
      current = { start: [...pos] as Point, segs: [], closed: false };
      subpaths.push(current);
    }
    return current;
  };

  for (const [cmd, a] of tokens) {
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? pos[0] : 0;
    const oy = rel ? pos[1] : 0;
    let nextCubic: Point | null = null;
    let nextQuad: Point | null = null;
    switch (C) {
      case "M": {
        pos = [ox + a[0]!, oy + a[1]!];
        start = [...pos] as Point;
        current = { start: [...pos] as Point, segs: [], closed: false };
        subpaths.push(current);
        break;
      }
      case "L":
      case "H":
      case "V": {
        const to: Point =
          C === "L"
            ? [ox + a[0]!, oy + a[1]!]
            : C === "H"
              ? [(rel ? pos[0] : 0) + a[0]!, pos[1]]
              : [pos[0], (rel ? pos[1] : 0) + a[0]!];
        ensure().segs.push(line(pos, to));
        pos = to;
        break;
      }
      case "C": {
        const c1: Point = [ox + a[0]!, oy + a[1]!];
        const c2: Point = [ox + a[2]!, oy + a[3]!];
        const to: Point = [ox + a[4]!, oy + a[5]!];
        ensure().segs.push({ c1, c2, p: to });
        nextCubic = c2;
        pos = to;
        break;
      }
      case "S": {
        const c1: Point = lastCubicCtrl
          ? [2 * pos[0] - lastCubicCtrl[0], 2 * pos[1] - lastCubicCtrl[1]]
          : ([...pos] as Point);
        const c2: Point = [ox + a[0]!, oy + a[1]!];
        const to: Point = [ox + a[2]!, oy + a[3]!];
        ensure().segs.push({ c1, c2, p: to });
        nextCubic = c2;
        pos = to;
        break;
      }
      case "Q": {
        const q: Point = [ox + a[0]!, oy + a[1]!];
        const to: Point = [ox + a[2]!, oy + a[3]!];
        ensure().segs.push(quadToCubic(pos, q, to));
        nextQuad = q;
        pos = to;
        break;
      }
      case "T": {
        const q: Point = lastQuadCtrl
          ? [2 * pos[0] - lastQuadCtrl[0], 2 * pos[1] - lastQuadCtrl[1]]
          : ([...pos] as Point);
        const to: Point = [ox + a[0]!, oy + a[1]!];
        ensure().segs.push(quadToCubic(pos, q, to));
        nextQuad = q;
        pos = to;
        break;
      }
      case "A": {
        const to: Point = [ox + a[5]!, oy + a[6]!];
        ensure().segs.push(...arcToCubics(pos, a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, to));
        pos = to;
        break;
      }
      case "Z": {
        if (current) {
          (current as SubPath).closed = true;
          current = null;
        }
        pos = [...start] as Point;
        break;
      }
    }
    lastCubicCtrl = nextCubic;
    lastQuadCtrl = nextQuad;
  }
  return subpaths.filter((sp) => sp.segs.length > 0 || sp.closed);
}

const EPS = 1e-6;
const same = (a: Point, b: Point) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

function subpathToShape(sp: SubPath): BezierShape {
  const v: Point[] = [[...sp.start] as Point];
  const ii: Point[] = [[0, 0]];
  const oo: Point[] = [];
  for (const seg of sp.segs) {
    const prev = v[v.length - 1]!;
    oo.push([seg.c1[0] - prev[0], seg.c1[1] - prev[1]]);
    v.push([...seg.p] as Point);
    ii.push([seg.c2[0] - seg.p[0], seg.c2[1] - seg.p[1]]);
  }
  oo.push([0, 0]);
  // A closed path whose last vertex coincides with the first: merge them.
  if (sp.closed && v.length > 1 && same(v[0]!, v[v.length - 1]!)) {
    ii[0] = ii[ii.length - 1]!;
    v.pop();
    ii.pop();
    oo.pop();
  }
  return { c: sp.closed, v, i: ii, o: oo };
}

/** Convert SVG path data to one Lottie bezier shape per sub-path. */
export function pathDataToShapes(d: string): BezierShape[] {
  return parsePathToSubpaths(d).map(subpathToShape);
}

/** Polygon / polyline `points` attribute → a single bezier shape. */
export function pointsToShape(points: string, closed: boolean): BezierShape | null {
  const nums = (points.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
  if (nums.length < 4) return null;
  const v: Point[] = [];
  for (let k = 0; k + 1 < nums.length; k += 2) v.push([nums[k]!, nums[k + 1]!]);
  return { c: closed, v, i: v.map(() => [0, 0] as Point), o: v.map(() => [0, 0] as Point) };
}

/** Kappa for approximating a quarter ellipse with a cubic bezier. */
export const KAPPA = 0.5522847498307936;

/**
 * Rounded rectangle path with per-corner elliptical radii. Always emits 8 vertices so the
 * shape can be animated by Lottie (vertex count must stay constant across keyframes).
 * radii: [tlx, tly, trx, try, brx, bry, blx, bly]
 */
export function roundedRectShape(
  x: number,
  y: number,
  w: number,
  h: number,
  radii: [number, number, number, number, number, number, number, number],
): BezierShape {
  const [tlx, tly, trx, tryy, brx, bry, blx, bly] = radii;
  const k = KAPPA;
  const v: Point[] = [
    [x + tlx, y],
    [x + w - trx, y],
    [x + w, y + tryy],
    [x + w, y + h - bry],
    [x + w - brx, y + h],
    [x + blx, y + h],
    [x, y + h - bly],
    [x, y + tly],
  ];
  const i: Point[] = [
    [-tlx * k, 0],
    [0, 0],
    [0, -tryy * k],
    [0, 0],
    [brx * k, 0],
    [0, 0],
    [0, bly * k],
    [0, 0],
  ];
  const o: Point[] = [
    [0, 0],
    [trx * k, 0],
    [0, 0],
    [0, bry * k],
    [0, 0],
    [-blx * k, 0],
    [0, 0],
    [0, -tly * k],
  ];
  return { c: true, v, i, o };
}

/** Flatten a shape into a number vector (for keyframe comparison) and back. */
export function flattenShape(s: BezierShape): number[] {
  const out: number[] = [];
  for (let k = 0; k < s.v.length; k++) {
    out.push(s.v[k]![0], s.v[k]![1], s.i[k]![0], s.i[k]![1], s.o[k]![0], s.o[k]![1]);
  }
  return out;
}

export function unflattenShape(values: number[], closed: boolean): BezierShape {
  const s: BezierShape = { c: closed, v: [], i: [], o: [] };
  for (let k = 0; k + 5 < values.length; k += 6) {
    s.v.push([values[k]!, values[k + 1]!]);
    s.i.push([values[k + 2]!, values[k + 3]!]);
    s.o.push([values[k + 4]!, values[k + 5]!]);
  }
  return s;
}
