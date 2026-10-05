import type { NodeConverter } from "./types.js";
import type { ShapeItem } from "../lottie/types.js";
import { parseCssColor } from "../utils/color.js";
import { pathDataToShapes, flattenShape } from "./path-data.js";
import { toScalarProperty, toShapeProperty, toVectorProperty } from "../lottie/properties.js";
import { group } from "./shared.js";
import { stabilizeColors } from "./box.js";

function applyTextTransform(ch: string, transform: string, first: boolean): string {
  if (transform === "uppercase") return ch.toUpperCase();
  if (transform === "lowercase") return ch.toLowerCase();
  if (transform === "capitalize" && first) return ch.toUpperCase();
  return ch;
}

/**
 * Text → glyph outlines. Character positions come from the browser's layout (so wrapping,
 * alignment and letter-spacing match); glyph shapes come from the font file via opentype.js.
 */
export const textConverter: NodeConverter = {
  name: "text",
  kinds: ["html"],
  styles: ["color"],
  animatable: ["color"],
  async convert(ctx) {
    if (!ctx.text.length) return;
    const items: ShapeItem[] = [];
    for (const run of ctx.text) {
      const font = await ctx.fonts.resolve(run.fontFamily, run.fontWeight, run.fontStyle);
      const sample = run.chars
        .map((c) => c.ch)
        .join("")
        .slice(0, 24);
      if (!font) {
        ctx.report.unsupported(
          "text",
          ctx.node.selector,
          `"${sample}" skipped: no font file found for font-family ${run.fontFamily}. ` +
            "Use an @font-face with a TTF/OTF/WOFF file or pass `fonts: { family: path }`.",
        );
        continue;
      }
      const asc = font.ascender;
      const desc = font.descender;
      let prev = "";
      for (const c of run.chars) {
        const ch = applyTextTransform(c.ch, run.textTransform, !/\S/.test(prev || " "));
        prev = c.ch;
        const baseline = c.y + (c.h * asc) / (asc - desc);
        const d = font.getPath(ch, c.x, baseline, run.fontSize).toPathData(3);
        if (!d) continue;
        for (const shape of pathDataToShapes(d)) {
          items.push({
            ty: "sh",
            nm: ch,
            d: 1,
            ks: toShapeProperty({ kind: "static", value: flattenShape(shape) }, shape.c),
          });
        }
      }
      ctx.report.approximated(
        "text",
        ctx.node.selector,
        `"${sample}" converted to shape outlines (not editable text)`,
      );
    }
    if (!items.length) return;
    const colors = stabilizeColors(ctx.style("color").map((v) => parseCssColor(v) ?? [0, 0, 0, 1]));
    items.push({
      ty: "fl",
      nm: "color",
      c: toVectorProperty(
        ctx.track(
          colors.map((c) => [c[0], c[1], c[2], 1]),
          { properties: ["color"], tolerance: 0.002 },
        ),
        4,
      ),
      o: toScalarProperty(
        ctx.track(
          colors.map((c) => [c[3] * 100]),
          { properties: ["color"], tolerance: 0.2 },
        ),
      ),
      r: 1,
    });
    ctx.layer.groups.push({ order: 30, group: group("text", items) });
  },
};
