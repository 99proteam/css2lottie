import type { NodeConverter } from "./types.js";
import { parseLength } from "../utils/math.js";
import { toVectorProperty } from "../lottie/properties.js";
import { LAYOUT_PROPERTIES } from "./shared.js";

/** Map an <svg> viewBox + preserveAspectRatio to a translate/scale (SVG 2, §8.2). */
export function viewBoxTransform(
  viewBox: [number, number, number, number] | null,
  par: string,
  content: [number, number, number, number],
): { tx: number; ty: number; sx: number; sy: number; vx: number; vy: number } {
  const [cx, cy, cw, ch] = content;
  if (!viewBox) return { tx: cx, ty: cy, sx: 1, sy: 1, vx: 0, vy: 0 };
  const [vx, vy, vw, vh] = viewBox;
  let sx = cw / vw;
  let sy = ch / vh;
  const [align = "xMidYMid", mode = "meet"] = par.trim().split(/\s+/);
  if (align === "none") return { tx: cx, ty: cy, sx, sy, vx, vy };
  const s = mode === "slice" ? Math.max(sx, sy) : Math.min(sx, sy);
  sx = sy = s;
  const ax = align.slice(0, 4);
  const ay = align.slice(4);
  const tx = cx + (ax === "xMid" ? (cw - vw * s) / 2 : ax === "xMax" ? cw - vw * s : 0);
  const ty = cy + (ay === "YMid" ? (ch - vh * s) / 2 : ay === "YMax" ? ch - vh * s : 0);
  return { tx, ty, sx, sy, vx, vy };
}

/** <svg> viewBox → intermediate null layer between the <svg> box and its children. */
export const svgViewBoxConverter: NodeConverter = {
  name: "svg-viewbox",
  kinds: ["svg-root"],
  styles: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  animatable: [],
  convert(ctx) {
    const svg = ctx.node.svg;
    const maps = ctx.localBox.map((b, i) => {
      const num = (p: string) => parseLength(ctx.style(p)[i]);
      const left = num("border-left-width") + num("padding-left");
      const top = num("border-top-width") + num("padding-top");
      const right = num("border-right-width") + num("padding-right");
      const bottom = num("border-bottom-width") + num("padding-bottom");
      return viewBoxTransform(svg?.viewBox ?? null, svg?.preserveAspectRatio ?? "xMidYMid meet", [
        left,
        top,
        b[2] - left - right,
        b[3] - top - bottom,
      ]);
    });
    const opts = { properties: LAYOUT_PROPERTIES, tolerance: 0.001 };
    ctx.layer.childTransform = {
      a: toVectorProperty(
        ctx.track(
          maps.map((m) => [m.vx, m.vy, 0]),
          opts,
        ),
        4,
      ),
      p: toVectorProperty(
        ctx.track(
          maps.map((m) => [m.tx, m.ty, 0]),
          opts,
        ),
        4,
      ),
      s: toVectorProperty(
        ctx.track(
          maps.map((m) => [m.sx * 100, m.sy * 100, 100]),
          opts,
        ),
        4,
      ),
    };
  },
};
