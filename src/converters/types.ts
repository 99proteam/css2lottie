import type { TrackResult } from "../easing/keyframes.js";
import type { GroupShape, ImageAsset, ShapeItem, Transform } from "../lottie/types.js";
import type { NodeInfo, NodeKind, NodeSample, TextRun } from "../sampler/types.js";
import type { Timeline } from "../timeline.js";
import type { Reporter } from "../report.js";
import type { ResolvedOptions } from "../options.js";
import type { FontResolver } from "./fonts.js";

export interface TrackOptions {
  /**
   * CSS properties that can drive this channel. Animations touching any of them provide the
   * segment boundaries/easings used for keyframe optimization. `"*"` = any animation on the node.
   */
  properties: readonly string[] | "*";
  /** Absolute tolerance per component */
  tolerance: number;
  /** Also consider animations on ancestor nodes (e.g. inherited opacity) */
  includeAncestors?: boolean;
  /** Per-sample flags: the value is not visible and does not need to be matched */
  dontCare?: boolean[];
  /**
   * The channel also moves child layers (layer transforms). Zero-opacity samples are then only
   * "don't care" when the node has no children.
   */
  affectsChildren?: boolean;
  /** Never treat invisible samples as don't-care (e.g. the opacity channel itself) */
  exact?: boolean;
}

/** Layer being assembled for one DOM node. */
export interface LayerDraft {
  kind: "null" | "shape" | "image";
  /** Layer transform (filled by the transform + opacity converters) */
  transform: Partial<Transform>;
  /** Shape groups; higher `order` paints on top */
  groups: Array<{ order: number; group: GroupShape }>;
  /** Image asset reference (image layers) */
  refId?: string;
  /**
   * Extra transform applied between this layer and its children (an intermediate null layer),
   * e.g. the viewBox mapping of an <svg>.
   */
  childTransform?: Partial<Transform>;
}

export interface NodeContext {
  node: NodeInfo;
  /** Parent node context (null for top-level nodes) */
  parent: NodeContext | null;
  /** Composition times (ms) of each sample */
  times: number[];
  timeline: Timeline;
  /** Raw samples of this node, aligned with `times` */
  samples: NodeSample[];
  /** Sampled values of a computed style property (must be listed in a converter's `styles`) */
  style(prop: string): string[];
  /** Text runs measured for this node (html nodes only) */
  text: TextRun[];
  /** Layout box per sample, in the parent layer's coordinate space: [x, y, w, h] */
  localBox: Array<[number, number, number, number]>;
  /** Build an optimized keyframe track for a channel */
  track(values: number[][], opts: TrackOptions): TrackResult;
  layer: LayerDraft;
  /** Geometry items produced by an earlier converter (svg-shape → svg-paint) */
  geometry?: ShapeItem[];
  /** Opacity factor (0..1) per sample, including ancestors — filled by the opacity converter */
  opacity?: number[];
  /** True when other nodes are parented to this one */
  hasChildren: boolean;
  addAsset(asset: ImageAsset): void;
  report: Reporter;
  options: ResolvedOptions;
  fonts: FontResolver;
}

/**
 * A converter turns one aspect of a DOM node (a CSS property family) into Lottie data.
 * See CONTRIBUTING.md — "Adding support for a new CSS property".
 */
export interface NodeConverter {
  name: string;
  /** Node kinds this converter applies to */
  kinds: readonly NodeKind[];
  /** Computed style properties the sampler must record every frame for these kinds */
  styles: readonly string[];
  /** CSS properties whose *animation* this converter can represent (used by the report) */
  animatable: readonly string[];
  convert(ctx: NodeContext): void | Promise<void>;
}
