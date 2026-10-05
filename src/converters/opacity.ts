import type { NodeContext, NodeConverter } from "./types.js";
import { toScalarProperty } from "../lottie/properties.js";
import { determinant, type Matrix2D } from "../utils/matrix.js";
import { TRANSFORM_PROPERTIES } from "./shared.js";

/** Own opacity × visibility for one sample, without ancestors. */
function ownOpacity(ctx: NodeContext, i: number): number {
  const op = parseFloat(ctx.style("opacity")[i] ?? "1");
  const vis = ctx.style("visibility")[i];
  if (vis === "hidden" || vis === "collapse") return 0;
  return Number.isFinite(op) ? op : 1;
}

/**
 * opacity / visibility / backface-visibility → layer opacity.
 *
 * Lottie parenting does not propagate opacity, so each layer gets the product of its own
 * opacity and all ancestors' (a close match to CSS group opacity for non-overlapping children).
 */
export const opacityConverter: NodeConverter = {
  name: "opacity",
  kinds: ["html", "pseudo", "img", "svg-root", "svg-group", "svg-shape"],
  styles: ["opacity", "visibility", "backface-visibility"],
  animatable: ["opacity", "visibility"],
  convert(ctx) {
    const n = ctx.samples.length;
    const values: number[] = [];
    let flips = false;
    for (let i = 0; i < n; i++) {
      let o = ownOpacity(ctx, i);
      let det = determinant(ctx.samples[i]!.m as Matrix2D);
      for (let p = ctx.parent; p; p = p.parent) {
        o *= parseFloat(p.style("opacity")[i] ?? "1") || 0;
        det *= determinant(p.samples[i]!.m as Matrix2D);
      }
      if (ctx.style("backface-visibility")[i] === "hidden" && det < -1e-9) {
        o = 0;
        flips = true;
      }
      values.push(o);
    }
    ctx.opacity = values;
    const usesBackface = flips;
    ctx.layer.transform.o = toScalarProperty(
      ctx.track(
        values.map((v) => [v * 100]),
        {
          properties: usesBackface
            ? ["opacity", "visibility", ...TRANSFORM_PROPERTIES]
            : ["opacity", "visibility"],
          tolerance: 0.2,
          includeAncestors: true,
          exact: true,
        },
      ),
    );
  },
};
