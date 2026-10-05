import type {
  DiscoveryResult,
  NodeInfo,
  NodeSample,
  SampleResult,
  TextRun,
} from "./sampler/types.js";
import type { Layer, LottieAnimation, ImageAsset, Transform } from "./lottie/types.js";
import type { LayerDraft, NodeContext, NodeConverter, TrackOptions } from "./converters/types.js";
import {
  converters as defaultConverters,
  supportedAnimatedProperties,
} from "./converters/index.js";
import { buildTrack, type TrackStats } from "./easing/keyframes.js";
import { animationSegments, type Segment, type Timeline } from "./timeline.js";
import { Reporter, type ConversionReport } from "./report.js";
import type { ResolvedOptions } from "./options.js";
import { FontResolver } from "./converters/fonts.js";
import { parseCssColor } from "./utils/color.js";
import { group } from "./converters/shared.js";
import { staticScalar, staticVector } from "./lottie/properties.js";

export const GENERATOR = "css2lottie";

export interface BuildInput {
  discovery: DiscoveryResult;
  sampled: SampleResult;
  timeline: Timeline;
  options: ResolvedOptions;
  /** <html>/<body> background color (when options.background) */
  pageBackground?: string;
  version: string;
  viewport: { width: number; height: number };
  converters?: readonly NodeConverter[];
}

const BOX_KINDS = new Set(["html", "img", "svg-root"]);

function defaultTransform(): Transform {
  return {
    a: staticVector([0, 0, 0]),
    p: staticVector([0, 0, 0]),
    s: staticVector([100, 100, 100]),
    r: staticScalar(0),
    o: staticScalar(100),
  };
}

function fullTransform(t: Partial<Transform>): Transform {
  return { ...defaultTransform(), ...t };
}

function countKeyframes(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + countKeyframes(v), 0);
  const obj = value as Record<string, unknown>;
  let n = 0;
  if (obj.a === 1 && Array.isArray(obj.k)) n += obj.k.length;
  for (const [k, v] of Object.entries(obj)) if (k !== "k") n += countKeyframes(v);
  return n;
}

/** Assemble a Lottie animation from sampled node data. */
export async function buildLottie(
  input: BuildInput,
): Promise<{ lottie: LottieAnimation; report: ConversionReport }> {
  const { discovery, sampled, timeline, options } = input;
  const converters = input.converters ?? defaultConverters;
  const reporter = new Reporter();
  const stats: TrackStats = { easedIntervals: 0, sampledIntervals: 0 };
  const nodes = discovery.nodes;
  const times = sampled.times;
  const end = (timeline.frames * 1000) / timeline.fps;

  for (const note of timeline.notes) reporter.note(note);
  for (const issue of [...discovery.issues, ...sampled.issues]) {
    const severity =
      issue.feature === "in-flow pseudo-element" || issue.feature === "border-style"
        ? "approximated"
        : "unsupported";
    reporter.add(severity, issue.feature, issue.selector, issue.detail);
  }

  // Unsupported animated properties.
  const supported = supportedAnimatedProperties(converters);
  for (const a of discovery.animations) {
    if (a.nodeId === null) continue;
    for (const p of a.properties) {
      if (!supported.has(p)) {
        reporter.unsupported(
          `animated ${p}`,
          a.selector,
          `${a.kind === "css-transition" ? "transition" : `animation "${a.name}"`} animates "${p}", which is not supported yet; it was ignored`,
        );
      }
    }
  }

  // Segments per node.
  const segmentsByNode = new Map<number, Segment[]>();
  for (const a of discovery.animations) {
    for (const seg of animationSegments(a, timeline)) {
      const list = segmentsByNode.get(seg.nodeId) ?? [];
      list.push(seg);
      segmentsByNode.set(seg.nodeId, list);
    }
  }

  // Composition origin in viewport coordinates.
  let origin: [number, number] = [0, 0];
  if (!discovery.rootIsBody) {
    const rb = sampled.samples[0]?.[0]?.b ?? discovery.rootBox;
    origin = [rb[0] - (options.width - rb[2]) / 2, rb[1] - (options.height - rb[3]) / 2];
  }

  const fonts = new FontResolver(discovery.fontFaces, options.fonts, options.baseDir);
  const assets: ImageAsset[] = [];
  const contexts: NodeContext[] = [];

  const nodeSamples = (idx: number): NodeSample[] => sampled.samples.map((frame) => frame[idx]!);

  const nearestBoxAncestor = (node: NodeInfo): NodeInfo | null => {
    let p = node.parentId === null ? null : nodes[node.parentId]!;
    while (p && !BOX_KINDS.has(p.kind)) p = p.parentId === null ? null : nodes[p.parentId]!;
    return p;
  };

  for (const node of nodes) {
    const samples = nodeSamples(node.id);
    const styleIndex = new Map(node.styleNames.map((n, i) => [n, i]));
    const styleCache = new Map<string, string[]>();
    const parentCtx = node.parentId === null ? null : contexts[node.parentId]!;
    let localBox: Array<[number, number, number, number]>;
    if (node.kind === "pseudo") {
      localBox = samples.map((s) => s.b ?? [0, 0, 0, 0]);
    } else if (BOX_KINDS.has(node.kind)) {
      const anc = nearestBoxAncestor(node);
      const ancSamples = anc ? nodeSamples(anc.id) : null;
      localBox = samples.map((s, i) => {
        const b = s.b ?? [0, 0, 0, 0];
        const base = ancSamples ? (ancSamples[i]!.b ?? [0, 0, 0, 0]) : [origin[0], origin[1]];
        return [b[0] - base[0]!, b[1] - base[1]!, b[2], b[3]];
      });
    } else {
      localBox = samples.map(() => [0, 0, 0, 0]);
    }

    const nodeSegments = (opts: TrackOptions): Segment[] => {
      const ids = [node.id];
      if (opts.includeAncestors) for (let p = parentCtx; p; p = p.parent) ids.push(p.node.id);
      const segs = ids.flatMap((id) => segmentsByNode.get(id) ?? []);
      if (opts.properties === "*") return segs;
      const props = new Set(opts.properties);
      return segs.filter((s) => s.properties.some((p) => props.has(p)));
    };

    const layer: LayerDraft = { kind: "null", transform: {}, groups: [] };
    const ctx: NodeContext = {
      node,
      parent: parentCtx,
      times,
      timeline,
      samples,
      style(prop: string) {
        let v = styleCache.get(prop);
        if (!v) {
          const i = styleIndex.get(prop);
          v = i === undefined ? samples.map(() => "") : samples.map((s) => s.s[i] ?? "");
          styleCache.set(prop, v);
        }
        return v;
      },
      text: (sampled.text[node.id] ?? []) as TextRun[],
      localBox,
      hasChildren: nodes.some((n) => n.parentId === node.id),
      track(values, opts) {
        let dontCare = opts.dontCare;
        const hidden = ctx.opacity;
        if (!opts.exact && hidden && (!opts.affectsChildren || !ctx.hasChildren)) {
          dontCare = hidden.map((o, i) => o <= 1e-4 || !!opts.dontCare?.[i]);
        }
        return buildTrack(
          {
            times,
            values,
            fps: timeline.fps,
            end,
            segments: nodeSegments(opts),
            tolerance: opts.tolerance,
            noEasing: !options.optimizeKeyframes,
            dontCare,
          },
          stats,
        );
      },
      layer,
      addAsset(asset) {
        assets.push(asset);
      },
      report: reporter,
      options,
      fonts,
    };
    contexts.push(ctx);
    for (const conv of converters) {
      if (conv.kinds.includes(node.kind)) await conv.convert(ctx);
    }
    if (layer.groups.length && layer.kind === "null") layer.kind = "shape";
  }

  for (const f of new Set(fonts.failures)) reporter.warn("font", "(fonts)", f);

  // Keep nodes that draw something or have drawing descendants.
  const visible = new Array<boolean>(nodes.length).fill(false);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const l = contexts[i]!.layer;
    if (l.kind !== "null") visible[i] = true;
    const pid = nodes[i]!.parentId;
    if (visible[i] && pid !== null) visible[pid] = true;
  }

  // Paint order: DOM pre-order, siblings stably sorted by z-index (positioned elements).
  const children = new Map<number | null, number[]>();
  for (const n of nodes) {
    if (!visible[n.id]) continue;
    const list = children.get(n.parentId) ?? [];
    list.push(n.id);
    children.set(n.parentId, list);
  }
  const zIndex = (id: number) => {
    const ctx = contexts[id]!;
    const pos = ctx.style("position")[0];
    const z = parseInt(ctx.style("z-index")[0] ?? "auto", 10);
    return pos && pos !== "static" && Number.isFinite(z) ? z : 0;
  };
  const paintOrder: number[] = [];
  const visit = (parent: number | null) => {
    const list = [...(children.get(parent) ?? [])].sort((a, b) => zIndex(a) - zIndex(b));
    for (const id of list) {
      paintOrder.push(id);
      visit(id);
    }
  };
  visit(null);

  // Layer indices: assign in paint order; svg roots get an extra viewBox null layer.
  const op = timeline.frames;
  let nextInd = 1;
  const indOf = new Map<number, number>();
  const childParentInd = new Map<number, number>();
  const layersBackToFront: Layer[] = [];
  const base = (name: string) => ({
    ddd: 0 as const,
    sr: 1,
    ao: 0 as const,
    ip: 0,
    op,
    st: 0,
    bm: 0 as const,
    nm: name,
  });

  for (const id of paintOrder) {
    const node = nodes[id]!;
    const ctx = contexts[id]!;
    const draft = ctx.layer;
    const ind = nextInd++;
    indOf.set(id, ind);
    const parentInd = node.parentId === null ? undefined : childParentInd.get(node.parentId);
    const ks = fullTransform(draft.transform);
    const common = {
      ...base(node.selector),
      ind,
      ks,
      ...(parentInd !== undefined ? { parent: parentInd } : {}),
    };
    let layer: Layer;
    if (draft.kind === "shape") {
      const shapes = [...draft.groups].sort((a, b) => b.order - a.order).map((g) => g.group);
      layer = { ...common, ty: 4, shapes };
    } else if (draft.kind === "image" && draft.refId) {
      layer = { ...common, ty: 2, refId: draft.refId };
    } else {
      layer = { ...common, ty: 3 };
    }
    layersBackToFront.push(layer);
    childParentInd.set(id, ind);
    if (draft.childTransform) {
      const vbInd = nextInd++;
      layersBackToFront.push({
        ...base(`${node.selector} viewBox`),
        ind: vbInd,
        ty: 3,
        parent: ind,
        ks: { ...defaultTransform(), ...draft.childTransform },
      });
      childParentInd.set(id, vbInd);
    }
  }

  // Optional page background.
  if (options.background && input.pageBackground) {
    const c = parseCssColor(input.pageBackground);
    if (c && c[3] > 0) {
      layersBackToFront.unshift({
        ...base("background"),
        ind: nextInd,
        ty: 4,
        ks: defaultTransform(),
        shapes: [
          group("background", [
            {
              ty: "rc",
              nm: "rect",
              d: 1,
              p: staticVector([options.width / 2, options.height / 2]),
              s: staticVector([options.width, options.height]),
              r: staticScalar(0),
            },
            {
              ty: "fl",
              nm: "fill",
              c: staticVector([c[0], c[1], c[2], 1], 4),
              o: staticScalar(c[3] * 100),
              r: 1,
            },
          ]),
        ],
      });
    }
  }

  const layers = layersBackToFront.reverse();
  const lottie: LottieAnimation = {
    v: "5.7.4",
    fr: timeline.fps,
    ip: 0,
    op,
    w: Math.round(options.width),
    h: Math.round(options.height),
    nm: options.name,
    ddd: 0,
    assets,
    layers,
    markers: [],
    meta: { g: `${GENERATOR} ${input.version}` },
  };

  const report: ConversionReport = {
    issues: reporter.issues,
    notes: reporter.notes,
    stats: {
      fps: timeline.fps,
      frames: op,
      durationMs: (op * 1000) / timeline.fps,
      loop: timeline.loop,
      startOffsetMs: timeline.startOffset,
      viewport: input.viewport,
      width: lottie.w,
      height: lottie.h,
      layers: layers.length,
      animations: discovery.animations.filter((a) => a.nodeId !== null).length,
      keyframes: countKeyframes(layers),
      easedIntervals: stats.easedIntervals,
      sampledIntervals: stats.sampledIntervals,
    },
  };
  return { lottie, report };
}
