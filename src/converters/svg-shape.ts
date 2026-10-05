import type { NodeContext, NodeConverter } from "./types.js";
import type { ShapeItem } from "../lottie/types.js";
import { parseLength } from "../utils/math.js";
import {
  flattenShape,
  pathDataToShapes,
  pointsToShape,
  roundedRectShape,
  type BezierShape,
} from "./path-data.js";
import { toScalarProperty, toShapeProperty, toVectorProperty } from "../lottie/properties.js";

const GEOMETRY_PROPS = ["x", "y", "width", "height", "rx", "ry", "cx", "cy", "r", "d"];
const TOL = 0.01;

function num(ctx: NodeContext, prop: string, i: number): number {
  return parseLength(ctx.style(prop)[i]);
}

/** Resolve rx/ry with SVG `auto` rules and clamping (unclamped when `clamp` is false). */
function rectRadii(
  ctx: NodeContext,
  i: number,
  w: number,
  h: number,
  clamp = true,
): [number, number] {
  const rxs = ctx.style("rx")[i] ?? "auto";
  const rys = ctx.style("ry")[i] ?? "auto";
  let rx = rxs === "auto" ? NaN : parseLength(rxs, w);
  let ry = rys === "auto" ? NaN : parseLength(rys, h);
  if (Number.isNaN(rx) && Number.isNaN(ry)) rx = ry = 0;
  else if (Number.isNaN(rx)) rx = ry;
  else if (Number.isNaN(ry)) ry = rx;
  if (!clamp) return [Math.max(0, rx), Math.max(0, ry)];
  return [Math.min(Math.max(0, rx), w / 2), Math.min(Math.max(0, ry), h / 2)];
}

function pathShapes(ctx: NodeContext): ShapeItem[] {
  const ds = ctx.style("d");
  const parsed: BezierShape[][] = [];
  for (const raw of ds) {
    const m = /^path\(\s*(['"])(.*)\1\s*\)$/s.exec(raw ?? "");
    const d = m ? m[2]! : "";
    try {
      parsed.push(d ? pathDataToShapes(d) : []);
    } catch (e) {
      ctx.report.warn(
        "SVG path",
        ctx.node.selector,
        `could not parse path data: ${(e as Error).message}`,
      );
      return [];
    }
  }
  const first = parsed[0] ?? [];
  const compatible = parsed.every(
    (p) =>
      p.length === first.length &&
      p.every((s, k) => s.v.length === first[k]!.v.length && s.c === first[k]!.c),
  );
  if (!compatible) {
    ctx.report.unsupported(
      "path morphing",
      ctx.node.selector,
      "animated `d` with a changing number of points cannot be morphed; using the first frame",
    );
  }
  return first.map((shape, k) => {
    const values = compatible
      ? parsed.map((p) => flattenShape(p[k]!))
      : parsed.map(() => flattenShape(shape));
    return {
      ty: "sh",
      nm: `path-${k}`,
      d: 1,
      ks: toShapeProperty(ctx.track(values, { properties: ["d"], tolerance: TOL }), shape.c),
    } satisfies ShapeItem;
  });
}

/** Inline SVG <rect>, <circle>, <ellipse>, <path>, <polygon>, <polyline>, <line> → Lottie shapes. */
export const svgShapeConverter: NodeConverter = {
  name: "svg-shape",
  kinds: ["svg-shape"],
  styles: GEOMETRY_PROPS,
  animatable: GEOMETRY_PROPS,
  convert(ctx) {
    const n = ctx.samples.length;
    const idx = Array.from({ length: n }, (_, i) => i);
    const geom: ShapeItem[] = [];
    const vec = (f: (i: number) => number[], props: string[]) =>
      toVectorProperty(ctx.track(idx.map(f), { properties: props, tolerance: TOL }));
    switch (ctx.node.tag) {
      case "rect": {
        const dims = idx.map((i) => {
          const w = num(ctx, "width", i);
          const h = num(ctx, "height", i);
          return {
            x: num(ctx, "x", i),
            y: num(ctx, "y", i),
            w,
            h,
            r: rectRadii(ctx, i, w, h),
            raw: rectRadii(ctx, i, w, h, false),
          };
        });
        // Equal rx/ry → Lottie rect. Lottie clamps roundness to half the shorter side itself, so the
        // unclamped radius keeps the track static while the size animates.
        if (dims.every((d) => Math.abs(d.raw[0] - d.raw[1]) < 1e-6)) {
          geom.push({
            ty: "rc",
            nm: "rect",
            d: 1,
            p: vec(
              (i) => [dims[i]!.x + dims[i]!.w / 2, dims[i]!.y + dims[i]!.h / 2],
              ["x", "y", "width", "height"],
            ),
            s: vec((i) => [dims[i]!.w, dims[i]!.h], ["width", "height"]),
            r: toScalarProperty(
              ctx.track(
                dims.map((d) => [d.raw[0]]),
                { properties: ["rx", "ry", "width", "height"], tolerance: TOL },
              ),
            ),
          });
        } else {
          const shapes = dims.map((d) =>
            flattenShape(
              roundedRectShape(d.x, d.y, d.w, d.h, [
                d.r[0],
                d.r[1],
                d.r[0],
                d.r[1],
                d.r[0],
                d.r[1],
                d.r[0],
                d.r[1],
              ]),
            ),
          );
          geom.push({
            ty: "sh",
            nm: "rect",
            d: 1,
            ks: toShapeProperty(
              ctx.track(shapes, { properties: GEOMETRY_PROPS, tolerance: TOL }),
              true,
            ),
          });
        }
        break;
      }
      case "circle":
        geom.push({
          ty: "el",
          nm: "circle",
          d: 1,
          p: vec((i) => [num(ctx, "cx", i), num(ctx, "cy", i)], ["cx", "cy"]),
          s: vec((i) => [2 * num(ctx, "r", i), 2 * num(ctx, "r", i)], ["r"]),
        });
        break;
      case "ellipse": {
        const radii = idx.map((i) => {
          const rxs = ctx.style("rx")[i];
          const rys = ctx.style("ry")[i];
          const rx = rxs === "auto" ? parseLength(rys) : parseLength(rxs);
          const ry = rys === "auto" ? rx : parseLength(rys);
          return [rx, ry];
        });
        geom.push({
          ty: "el",
          nm: "ellipse",
          d: 1,
          p: vec((i) => [num(ctx, "cx", i), num(ctx, "cy", i)], ["cx", "cy"]),
          s: vec((i) => [2 * radii[i]![0]!, 2 * radii[i]![1]!], ["rx", "ry"]),
        });
        break;
      }
      case "line": {
        const l = ctx.node.svg?.line ?? [0, 0, 0, 0];
        const shape: BezierShape = {
          c: false,
          v: [
            [l[0], l[1]],
            [l[2], l[3]],
          ],
          i: [
            [0, 0],
            [0, 0],
          ],
          o: [
            [0, 0],
            [0, 0],
          ],
        };
        geom.push({
          ty: "sh",
          nm: "line",
          d: 1,
          ks: toShapeProperty({ kind: "static", value: flattenShape(shape) }, false),
        });
        break;
      }
      case "polygon":
      case "polyline": {
        const shape = pointsToShape(ctx.node.svg?.points ?? "", ctx.node.tag === "polygon");
        if (shape) {
          geom.push({
            ty: "sh",
            nm: ctx.node.tag,
            d: 1,
            ks: toShapeProperty({ kind: "static", value: flattenShape(shape) }, shape.c),
          });
        }
        break;
      }
      case "path":
        geom.push(...pathShapes(ctx));
        break;
    }
    ctx.geometry = geom;
  },
};
