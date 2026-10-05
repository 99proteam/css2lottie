import type { NodeConverter } from "./types.js";
import { decomposeSequence, type Matrix2D } from "../utils/matrix.js";
import { toScalarProperty, toVectorProperty } from "../lottie/properties.js";
import { LAYOUT_PROPERTIES, TRANSFORM_PROPERTIES } from "./shared.js";

const POSITION_PROPS = [...TRANSFORM_PROPERTIES, ...LAYOUT_PROPERTIES, "x", "y", "cx", "cy", "r"];

/**
 * transform / translate / rotate / scale + layout position → layer transform.
 *
 * CSS maps a local point x to the parent as  L + o + M·(x − o)  (L = layout offset,
 * o = transform-origin, M = composed transform). Lottie computes  p + R·Sk·S·(x − a),  so the
 * anchor is the transform origin and position is L + o + translation(M).
 */
export const transformConverter: NodeConverter = {
  name: "transform",
  kinds: ["html", "pseudo", "img", "svg-root", "svg-group", "svg-shape"],
  styles: [],
  animatable: [...POSITION_PROPS],
  convert(ctx) {
    const { samples, localBox } = ctx;
    const decomposed = decomposeSequence(samples.map((s) => s.m as Matrix2D));
    const anchor = samples.map((s) => [s.o[0], s.o[1], 0]);
    const position = samples.map((s, i) => [
      localBox[i]![0] + s.o[0] + decomposed[i]!.translateX,
      localBox[i]![1] + s.o[1] + decomposed[i]!.translateY,
      0,
    ]);
    const scale = decomposed.map((d) => [d.scaleX * 100, d.scaleY * 100, 100]);
    const rotation = decomposed.map((d) => [d.rotation]);
    const skew = decomposed.map((d) => [d.skew]);

    // Rotation/skew are undefined while an axis is scaled to zero.
    const degenerate = decomposed.map(
      (d) => Math.abs(d.scaleX) < 1e-6 || Math.abs(d.scaleY) < 1e-6,
    );
    const common = { tolerance: 0.05, affectsChildren: true };
    ctx.layer.transform.a = toVectorProperty(
      ctx.track(anchor, { ...common, properties: ["transform-origin", ...LAYOUT_PROPERTIES] }),
    );
    ctx.layer.transform.p = toVectorProperty(
      ctx.track(position, { ...common, properties: POSITION_PROPS }),
    );
    ctx.layer.transform.s = toVectorProperty(
      ctx.track(scale, { ...common, properties: TRANSFORM_PROPERTIES }),
    );
    ctx.layer.transform.r = toScalarProperty(
      ctx.track(rotation, { ...common, properties: TRANSFORM_PROPERTIES, dontCare: degenerate }),
    );
    if (skew.some((s) => Math.abs(s[0]!) > 1e-3)) {
      ctx.layer.transform.sk = toScalarProperty(
        ctx.track(skew, { ...common, properties: TRANSFORM_PROPERTIES, dontCare: degenerate }),
      );
      ctx.layer.transform.sa = { a: 0, k: 0 };
    }
    if (samples.some((s) => s.d3)) {
      ctx.report.approximated(
        "3D transform",
        ctx.node.selector,
        "3D transforms are flattened to 2D (no perspective); backface-visibility is respected",
      );
    }
  },
};
