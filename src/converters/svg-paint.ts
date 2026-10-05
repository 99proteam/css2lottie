import type { NodeConverter } from "./types.js";
import type { ShapeItem } from "../lottie/types.js";
import { parseCssColor, type RGBA } from "../utils/color.js";
import { parseLength } from "../utils/math.js";
import { toScalarProperty, toVectorProperty } from "../lottie/properties.js";
import { group } from "./shared.js";
import { stabilizeColors } from "./box.js";

const CAPS: Record<string, 1 | 2 | 3> = { butt: 1, round: 2, square: 3 };
const JOINS: Record<string, 1 | 2 | 3> = { miter: 1, "miter-clip": 1, arcs: 1, round: 2, bevel: 3 };

/** SVG fill / stroke paint → Lottie fill and stroke items (grouped with the geometry). */
export const svgPaintConverter: NodeConverter = {
  name: "svg-paint",
  kinds: ["svg-shape"],
  styles: [
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-opacity",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
  ],
  animatable: ["fill", "fill-opacity", "stroke", "stroke-opacity", "stroke-width", "color"],
  convert(ctx) {
    const geometry = ctx.geometry ?? [];
    if (!geometry.length) return;
    const items: ShapeItem[] = [...geometry];

    const paint = (prop: "fill" | "stroke", opacityProp: string): RGBA[] | null => {
      const raw = ctx.style(prop);
      const colors = raw.map((v, i) => {
        const c = parseCssColor(v);
        if (!c) return null;
        const op = parseFloat(ctx.style(opacityProp)[i] ?? "1");
        return [c[0], c[1], c[2], c[3] * (Number.isFinite(op) ? op : 1)] as RGBA;
      });
      if (colors.every((c) => !c || c[3] <= 0)) return null;
      return stabilizeColors(colors.map((c) => c ?? [0, 0, 0, 0]));
    };
    const props = (p: string) => [p, `${p}-opacity`, "color"];

    const stroke = paint("stroke", "stroke-opacity");
    if (stroke) {
      const widths = ctx.style("stroke-width").map((w) => [parseLength(w)]);
      if (widths.some((w) => w[0]! > 0)) {
        items.push({
          ty: "st",
          nm: "stroke",
          c: toVectorProperty(
            ctx.track(
              stroke.map((c) => [c[0], c[1], c[2], 1]),
              { properties: props("stroke"), tolerance: 0.002 },
            ),
            4,
          ),
          o: toScalarProperty(
            ctx.track(
              stroke.map((c) => [c[3] * 100]),
              { properties: props("stroke"), tolerance: 0.2 },
            ),
          ),
          w: toScalarProperty(ctx.track(widths, { properties: ["stroke-width"], tolerance: 0.01 })),
          lc: CAPS[ctx.style("stroke-linecap")[0] ?? "butt"] ?? 1,
          lj: JOINS[ctx.style("stroke-linejoin")[0] ?? "miter"] ?? 1,
          ml: parseFloat(ctx.style("stroke-miterlimit")[0] ?? "4") || 4,
        });
      }
    }
    const fill = paint("fill", "fill-opacity");
    if (fill) {
      items.push({
        ty: "fl",
        nm: "fill",
        c: toVectorProperty(
          ctx.track(
            fill.map((c) => [c[0], c[1], c[2], 1]),
            { properties: props("fill"), tolerance: 0.002 },
          ),
          4,
        ),
        o: toScalarProperty(
          ctx.track(
            fill.map((c) => [c[3] * 100]),
            { properties: props("fill"), tolerance: 0.2 },
          ),
        ),
        r: ctx.style("fill-rule")[0] === "evenodd" ? 2 : 1,
      });
    }
    if (items.length > geometry.length) {
      ctx.layer.groups.push({ order: 10, group: group(ctx.node.tag, items) });
    }
  },
};
