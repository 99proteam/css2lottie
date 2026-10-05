/** Data exchanged between the in-page sampler and Node. Must stay JSON-serializable. */

export type NodeKind = "html" | "pseudo" | "img" | "svg-root" | "svg-group" | "svg-shape";

export interface TextChar {
  ch: string;
  /** Box relative to the owning element's border box (untransformed layout) */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextRun {
  chars: TextChar[];
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  textTransform: string;
}

export interface NodeInfo {
  id: number;
  parentId: number | null;
  kind: NodeKind;
  tag: string;
  /** Human-readable selector, e.g. `div#logo.spin` */
  selector: string;
  /** `::before` / `::after` for pseudo-elements */
  pseudo?: string;
  /** SVG specific static data */
  svg?: {
    viewBox: [number, number, number, number] | null;
    preserveAspectRatio: string;
    /** polygon / polyline points */
    points?: string;
    /** line endpoints */
    line?: [number, number, number, number];
  };
  img?: { src: string; naturalWidth: number; naturalHeight: number };
  text?: TextRun[];
  /** Names of sampled styles, aligned with `NodeSample.s` */
  styleNames: string[];
}

export interface NodeSample {
  /** Sampled computed styles (aligned with NodeInfo.styleNames) */
  s: string[];
  /** Composed transform (translate · rotate · scale · transform), 2D projection */
  m: [number, number, number, number, number, number];
  /** Transform origin in the node's local coordinates (SVG: user space) */
  o: [number, number];
  /** Untransformed layout box. html/img/svg-root: viewport coords; pseudo: relative to host. */
  b: [number, number, number, number] | null;
  /** True when the composed transform is 3D */
  d3?: boolean;
}

export interface KeyframeInfo {
  offset: number;
  easing: string;
}

export interface AnimationInfo {
  id: number;
  kind: "css-animation" | "css-transition" | "web-animation";
  name: string;
  nodeId: number | null;
  selector: string;
  delay: number;
  endDelay: number;
  duration: number;
  /** null = infinite */
  iterations: number | null;
  iterationStart: number;
  direction: string;
  fill: string;
  easing: string;
  playbackRate: number;
  keyframes: KeyframeInfo[];
  /** Animated CSS properties (kebab-case) */
  properties: string[];
}

export interface FontFaceInfo {
  family: string;
  weight: string;
  style: string;
  /** Absolute URLs from the src descriptor */
  urls: string[];
}

export interface StaticIssue {
  nodeId: number | null;
  selector: string;
  feature: string;
  detail: string;
}

export interface DiscoveryResult {
  nodes: NodeInfo[];
  animations: AnimationInfo[];
  fontFaces: FontFaceInfo[];
  issues: StaticIssue[];
  /** Viewport point that maps to composition (0, 0) */
  rootBox: [number, number, number, number];
  rootIsBody: boolean;
}

export interface SampleResult {
  /** Composition times (ms) that were sampled, ascending */
  times: number[];
  /** samples[timeIndex][nodeIndex] */
  samples: NodeSample[][];
  /** Text measurement filled during the first sample (keyed by node id) */
  text: Record<number, TextRun[]>;
  issues: StaticIssue[];
}
