/**
 * The subset of the Lottie (Bodymovin 5.7+) JSON format that css2lottie emits.
 * Field names follow the format; see https://lottie.github.io/lottie-spec/
 */

export interface EasingHandle {
  x: number[];
  y: number[];
}

export interface Keyframe<T> {
  /** Time in frames */
  t: number;
  /** Start value */
  s: T;
  /** In tangent (easing into the *next* keyframe is defined by this key's `o` and next key's... see spec) */
  i?: EasingHandle;
  o?: EasingHandle;
  /** Hold keyframe */
  h?: 0 | 1;
}

export interface StaticValue<T> {
  a: 0;
  k: T;
}

export interface AnimatedValue<T> {
  a: 1;
  k: Keyframe<T>[];
}

export type Value<T> = StaticValue<T> | AnimatedValue<T>;

/** Scalars are stored as arrays inside keyframes. */
export type ScalarProperty = StaticValue<number> | AnimatedValue<number[]>;
export type VectorProperty = Value<number[]>;

export interface BezierPath {
  c: boolean;
  v: number[][];
  i: number[][];
  o: number[][];
}

export type ShapeProperty = StaticValue<BezierPath> | AnimatedValue<BezierPath[]>;

export interface Transform {
  a: VectorProperty;
  p: VectorProperty;
  s: VectorProperty;
  r: ScalarProperty;
  o: ScalarProperty;
  sk?: ScalarProperty;
  sa?: ScalarProperty;
}

interface ShapeBase {
  nm?: string;
  hd?: boolean;
}

export interface GroupShape extends ShapeBase {
  ty: "gr";
  it: ShapeItem[];
  np?: number;
}

export interface RectShape extends ShapeBase {
  ty: "rc";
  d?: number;
  p: VectorProperty;
  s: VectorProperty;
  r: ScalarProperty;
}

export interface EllipseShape extends ShapeBase {
  ty: "el";
  d?: number;
  p: VectorProperty;
  s: VectorProperty;
}

export interface PathShape extends ShapeBase {
  ty: "sh";
  d?: number;
  ks: ShapeProperty;
}

export interface FillShape extends ShapeBase {
  ty: "fl";
  c: VectorProperty;
  o: ScalarProperty;
  /** Fill rule: 1 = non-zero, 2 = even-odd */
  r?: 1 | 2;
}

export interface StrokeShape extends ShapeBase {
  ty: "st";
  c: VectorProperty;
  o: ScalarProperty;
  w: ScalarProperty;
  /** Line cap: 1 butt, 2 round, 3 square */
  lc: 1 | 2 | 3;
  /** Line join: 1 miter, 2 round, 3 bevel */
  lj: 1 | 2 | 3;
  ml?: number;
}

export interface TrimShape extends ShapeBase {
  ty: "tm";
  s: ScalarProperty;
  e: ScalarProperty;
  o: ScalarProperty;
  m: 1 | 2;
}

export interface TransformShape extends ShapeBase {
  ty: "tr";
  a: VectorProperty;
  p: VectorProperty;
  s: VectorProperty;
  r: ScalarProperty;
  o: ScalarProperty;
  sk?: ScalarProperty;
  sa?: ScalarProperty;
}

export type ShapeItem =
  | GroupShape
  | RectShape
  | EllipseShape
  | PathShape
  | FillShape
  | StrokeShape
  | TrimShape
  | TransformShape;

interface LayerBase {
  ddd: 0;
  ind: number;
  ty: number;
  nm: string;
  sr: number;
  ks: Transform;
  ao: 0;
  ip: number;
  op: number;
  st: number;
  bm: 0;
  parent?: number;
  hd?: boolean;
}

export interface NullLayer extends LayerBase {
  ty: 3;
}

export interface ShapeLayer extends LayerBase {
  ty: 4;
  shapes: ShapeItem[];
}

export interface ImageLayer extends LayerBase {
  ty: 2;
  refId: string;
}

export type Layer = NullLayer | ShapeLayer | ImageLayer;

export interface ImageAsset {
  id: string;
  w: number;
  h: number;
  /** Path prefix (empty for embedded) */
  u: string;
  /** File name or data URL */
  p: string;
  /** Embedded */
  e: 0 | 1;
  nm?: string;
}

export interface LottieAnimation {
  v: string;
  fr: number;
  ip: number;
  op: number;
  w: number;
  h: number;
  nm: string;
  ddd: 0;
  assets: ImageAsset[];
  layers: Layer[];
  markers: unknown[];
  meta?: { g: string; [key: string]: unknown };
}
