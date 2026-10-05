import type { NodeKind } from "../sampler/types.js";
import type { NodeConverter } from "./types.js";
import { transformConverter } from "./transform.js";
import { opacityConverter } from "./opacity.js";
import { boxConverter } from "./box.js";
import { svgViewBoxConverter } from "./svg-viewbox.js";
import { svgShapeConverter } from "./svg-shape.js";
import { svgPaintConverter } from "./svg-paint.js";
import { textConverter } from "./text.js";
import { imageConverter } from "./image.js";

/**
 * Converter registry. Order matters: converters may read data produced by earlier ones
 * (e.g. svg-paint uses the geometry from svg-shape; opacity runs first so later channels can
 * ignore invisible frames).
 */
export const converters: readonly NodeConverter[] = [
  opacityConverter,
  transformConverter,
  boxConverter,
  svgViewBoxConverter,
  svgShapeConverter,
  svgPaintConverter,
  textConverter,
  imageConverter,
];

/** Extra styles sampled for paint order / stacking. */
const STACKING_STYLES = ["position", "z-index"];

export function styleListsFor(
  list: readonly NodeConverter[] = converters,
): Record<NodeKind, string[]> {
  const kinds: NodeKind[] = ["html", "pseudo", "img", "svg-root", "svg-group", "svg-shape"];
  const out = {} as Record<NodeKind, string[]>;
  for (const kind of kinds) {
    const set = new Set<string>(STACKING_STYLES);
    for (const c of list) if (c.kinds.includes(kind)) c.styles.forEach((s) => set.add(s));
    // The viewBox converter needs border widths of the <svg> box as well.
    if (kind === "svg-root")
      ["top", "right", "bottom", "left"].forEach((s) => set.add(`border-${s}-width`));
    out[kind] = [...set];
  }
  return out;
}

/** CSS properties whose animation is representable by at least one converter. */
export function supportedAnimatedProperties(
  list: readonly NodeConverter[] = converters,
): Set<string> {
  const set = new Set<string>();
  for (const c of list) c.animatable.forEach((p) => set.add(p));
  return set;
}

export type { NodeConverter, NodeContext, LayerDraft, TrackOptions } from "./types.js";
