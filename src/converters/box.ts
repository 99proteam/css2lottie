import type { NodeContext, NodeConverter } from "./types.js";
import type { ShapeItem, StrokeShape } from "../lottie/types.js";
import { parseCssColor, type RGBA } from "../utils/color.js";
import { parseLength } from "../utils/math.js";
import { BORDER_RADIUS_PROPERTIES, CORNERS, LAYOUT_PROPERTIES, SIDES, group } from "./shared.js";
import { flattenShape, roundedRectShape } from "./path-data.js";
import { toScalarProperty, toShapeProperty, toVectorProperty } from "../lottie/properties.js";

type Radii = [number, number, number, number, number, number, number, number];
const SIZE_PROPS = [...LAYOUT_PROPERTIES];
const RADIUS_PROPS = [...BORDER_RADIUS_PROPERTIES, ...LAYOUT_PROPERTIES];
const BORDER_COLOR_PROPS = [
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border",
];

/** Resolve the four corner radii (horizontal, vertical) in px, applying CSS overlap scaling. */
export function resolveRadii(values: string[], w: number, h: number, scale = true): Radii {
  const out: number[] = [];
  for (const v of values) {
    const parts = (v || "0px").trim().split(/\s+/);
    const rx = parseLength(parts[0], w);
    const ry = parseLength(parts[1] ?? parts[0], h);
    out.push(Math.max(0, rx), Math.max(0, ry));
  }
  if (!scale) return out as Radii;
  const [tlx, tly, trx, tr_y, brx, bry, blx, bly] = out as Radii;
  let f = 1;
  const fit = (len: number, sum: number) => {
    if (sum > len && sum > 0) f = Math.min(f, len / sum);
  };
  fit(w, tlx + trx);
  fit(w, blx + brx);
  fit(h, tly + bly);
  fit(h, tr_y + bry);
  return out.map((r) => r * f) as Radii;
}

type GeometryKind = "rect" | "ellipse" | "path";

function geometryKind(radii: Radii[], sizes: Array<[number, number]>): GeometryKind {
  const uniform = radii.every((r) => r.every((v) => Math.abs(v - r[0]) < 0.01));
  if (uniform) return "rect";
  const elliptic = radii.every((r, i) => {
    const [w, h] = sizes[i]!;
    return [0, 2, 4, 6].every(
      (k) => Math.abs(r[k]! - w / 2) < 0.01 && Math.abs(r[k + 1]! - h / 2) < 0.01,
    );
  });
  return elliptic ? "ellipse" : "path";
}

/**
 * Geometry for a box inset by `inset[i]` px on every side (0 for the background, half the border
 * width for a centered border stroke).
 */
function boxGeometry(
  ctx: NodeContext,
  kind: GeometryKind,
  sizes: Array<[number, number]>,
  radii: Radii[],
  inset: number[],
  name: string,
  rawRadius?: number[],
): ShapeItem {
  const tol = 0.05;
  if (kind === "ellipse") {
    return {
      ty: "el",
      nm: name,
      d: 1,
      p: toVectorProperty(
        ctx.track(
          sizes.map(([w, h]) => [w / 2, h / 2]),
          { properties: SIZE_PROPS, tolerance: tol },
        ),
      ),
      s: toVectorProperty(
        ctx.track(
          sizes.map(([w, h], i) => [
            Math.max(0, w - 2 * inset[i]!),
            Math.max(0, h - 2 * inset[i]!),
          ]),
          { properties: SIZE_PROPS, tolerance: tol },
        ),
      ),
    };
  }
  if (kind === "rect") {
    return {
      ty: "rc",
      nm: name,
      d: 1,
      p: toVectorProperty(
        ctx.track(
          sizes.map(([w, h]) => [w / 2, h / 2]),
          { properties: SIZE_PROPS, tolerance: tol },
        ),
      ),
      s: toVectorProperty(
        ctx.track(
          sizes.map(([w, h], i) => [
            Math.max(0, w - 2 * inset[i]!),
            Math.max(0, h - 2 * inset[i]!),
          ]),
          { properties: SIZE_PROPS, tolerance: tol },
        ),
      ),
      r: toScalarProperty(
        ctx.track(
          radii.map((r, i) => [Math.max(0, (rawRadius?.[i] ?? r[0]) - inset[i]!)]),
          { properties: RADIUS_PROPS, tolerance: tol },
        ),
      ),
    };
  }
  const shapes = sizes.map(([w, h], i) => {
    const d = inset[i]!;
    const r = radii[i]!.map((v) => Math.max(0, v - d)) as Radii;
    return flattenShape(roundedRectShape(d, d, Math.max(0, w - 2 * d), Math.max(0, h - 2 * d), r));
  });
  return {
    ty: "sh",
    nm: name,
    d: 1,
    ks: toShapeProperty(ctx.track(shapes, { properties: RADIUS_PROPS, tolerance: tol }), true),
  };
}

/** Replace the RGB of fully transparent samples by the nearest visible color (avoids fades through black). */
export function stabilizeColors(colors: RGBA[]): RGBA[] {
  const out = colors.map((c) => [...c] as RGBA);
  const firstVisible = out.find((c) => c[3] > 0.001);
  if (!firstVisible) return out;
  let last: RGBA = firstVisible;
  for (const c of out) {
    if (c[3] > 0.001) last = c;
    else [c[0], c[1], c[2]] = [last[0], last[1], last[2]];
  }
  return out;
}

function colorTrack(ctx: NodeContext, colors: RGBA[], properties: readonly string[]) {
  const stable = stabilizeColors(colors);
  return {
    c: toVectorProperty(
      ctx.track(
        stable.map((c) => [c[0], c[1], c[2], 1]),
        { properties, tolerance: 0.002 },
      ),
      4,
    ),
    o: toScalarProperty(
      ctx.track(
        stable.map((c) => [c[3] * 100]),
        { properties, tolerance: 0.2 },
      ),
    ),
  };
}

function strokeItem(ctx: NodeContext, colors: RGBA[], widths: number[], name: string): StrokeShape {
  const { c, o } = colorTrack(ctx, colors, BORDER_COLOR_PROPS);
  return {
    ty: "st",
    nm: name,
    c,
    o,
    w: toScalarProperty(
      ctx.track(
        widths.map((w) => [w]),
        { properties: LAYOUT_PROPERTIES, tolerance: 0.05 },
      ),
    ),
    lc: 1,
    lj: 1,
    ml: 4,
  };
}

const TRANSPARENT: RGBA = [0, 0, 0, 0];

/**
 * Element box → shape layer content:
 *  - background-color → fill
 *  - border (width/color per side) → stroke (uniform), trimmed strokes (circles with per-side
 *    colors, e.g. classic CSS spinners) or filled trapezoids (square corners)
 *  - border-radius → rect roundness, ellipse, or a rounded-rect path for per-corner radii
 *  - width/height → rect size
 */
export const boxConverter: NodeConverter = {
  name: "box",
  kinds: ["html", "pseudo", "svg-root"],
  styles: [
    "background-color",
    ...SIDES.flatMap((s) => [`border-${s}-width`, `border-${s}-color`, `border-${s}-style`]),
    ...CORNERS.map((c) => `border-${c}-radius`),
  ],
  animatable: [
    "background-color",
    "background",
    "border-color",
    "border",
    ...SIDES.flatMap((s) => [`border-${s}`, `border-${s}-color`, `border-${s}-width`]),
    ...BORDER_RADIUS_PROPERTIES,
  ],
  convert(ctx) {
    const n = ctx.samples.length;
    const sizes = ctx.localBox.map((b) => [b[2], b[3]] as [number, number]);
    const bg = ctx.style("background-color").map((v) => parseCssColor(v) ?? TRANSPARENT);
    const radii = sizes.map(([w, h], i) =>
      resolveRadii(
        CORNERS.map((c) => ctx.style(`border-${c}-radius`)[i] ?? "0px"),
        w,
        h,
      ),
    );
    const kind = geometryKind(radii, sizes);
    // Lottie clamps rect roundness to half the shorter side, exactly like CSS does for uniform
    // radii, so pass the unclamped radius (keeps e.g. pill shapes static while they resize).
    const raw = sizes.map(([w, h], i) =>
      resolveRadii(
        CORNERS.map((c) => ctx.style(`border-${c}-radius`)[i] ?? "0px"),
        w,
        h,
        false,
      ),
    );
    const rawRadius = raw.every((r) => r.every((v) => Math.abs(v - r[0]) < 0.01))
      ? raw.map((r) => r[0])
      : undefined;

    const widths = SIDES.map((s) =>
      ctx.style(`border-${s}-width`).map((v, i) => {
        const style = ctx.style(`border-${s}-style`)[i];
        return style === "none" || style === "hidden" ? 0 : parseLength(v);
      }),
    );
    const colors = SIDES.map((s) =>
      ctx.style(`border-${s}-color`).map((v) => parseCssColor(v) ?? TRANSPARENT),
    );
    const sideVisible = SIDES.map((_, k) =>
      widths[k]!.some((w, i) => w > 0 && colors[k]![i]![3] > 0),
    );

    if (bg.some((c) => c[3] > 0) && sizes.some(([w, h]) => w > 0 && h > 0)) {
      const geom = boxGeometry(
        ctx,
        kind,
        sizes,
        radii,
        new Array(n).fill(0),
        "background",
        rawRadius,
      );
      const { c, o } = colorTrack(ctx, bg, ["background-color", "background"]);
      ctx.layer.groups.push({
        order: 10,
        group: group("background", [geom, { ty: "fl", nm: "background-color", c, o, r: 1 }]),
      });
    }

    if (!sideVisible.some(Boolean)) return;
    const uniformWidth = widths.every((ws) =>
      ws.every((w, i) => Math.abs(w - widths[0]![i]!) < 0.01),
    );
    const uniformColor = colors.every((cs) =>
      cs.every((c, i) => c.every((v, k) => Math.abs(v - colors[0]![i]![k]!) < 0.002)),
    );
    const borderWidth = widths[0]!;
    const inset = borderWidth.map((w) => w / 2);

    if (uniformWidth && uniformColor) {
      const geom = boxGeometry(ctx, kind, sizes, radii, inset, "border-path", rawRadius);
      ctx.layer.groups.push({
        order: 20,
        group: group("border", [geom, strokeItem(ctx, colors[0]!, borderWidth, "border")]),
      });
      return;
    }

    const circular = radii.every((r, i) => {
      const [w, h] = sizes[i]!;
      return [0, 2, 4, 6].every((k) => r[k]! >= w / 2 - 0.01 && r[k + 1]! >= h / 2 - 0.01);
    });
    if (uniformWidth && circular) {
      // Circle with per-side colors: one trimmed quarter stroke per side.
      const offsets = [-45, 45, 135, 225];
      SIDES.forEach((side, k) => {
        if (!sideVisible[k]) return;
        const geom = boxGeometry(ctx, "ellipse", sizes, radii, inset, `border-${side}-path`);
        ctx.layer.groups.push({
          order: 20 + k,
          group: group(`border-${side}`, [
            geom,
            {
              ty: "tm",
              nm: "side",
              s: { a: 0, k: 0 },
              e: { a: 0, k: 25 },
              o: { a: 0, k: offsets[k]! },
              m: 1,
            },
            strokeItem(ctx, colors[k]!, borderWidth, `border-${side}`),
          ]),
        });
      });
      return;
    }

    const square = radii.every((r) => r.every((v) => v < 0.01));
    if (square) {
      // Square corners: each side is a filled trapezoid, exactly like the browser draws it.
      SIDES.forEach((side, k) => {
        if (!sideVisible[k]) return;
        const shapes = sizes.map(([w, h], i) => {
          const [bt, br, bb, bl] = widths.map((ws) => ws[i]!) as [number, number, number, number];
          const pts: Array<[number, number]> =
            side === "top"
              ? [
                  [0, 0],
                  [w, 0],
                  [w - br, bt],
                  [bl, bt],
                ]
              : side === "right"
                ? [
                    [w, 0],
                    [w, h],
                    [w - br, h - bb],
                    [w - br, bt],
                  ]
                : side === "bottom"
                  ? [
                      [w, h],
                      [0, h],
                      [bl, h - bb],
                      [w - br, h - bb],
                    ]
                  : [
                      [0, h],
                      [0, 0],
                      [bl, bt],
                      [bl, h - bb],
                    ];
          return flattenShape({
            c: true,
            v: pts,
            i: pts.map(() => [0, 0] as [number, number]),
            o: pts.map(() => [0, 0] as [number, number]),
          });
        });
        const { c, o } = colorTrack(ctx, colors[k]!, BORDER_COLOR_PROPS);
        ctx.layer.groups.push({
          order: 20 + k,
          group: group(`border-${side}`, [
            {
              ty: "sh",
              nm: `border-${side}-path`,
              d: 1,
              ks: toShapeProperty(
                ctx.track(shapes, { properties: LAYOUT_PROPERTIES, tolerance: 0.05 }),
                true,
              ),
            },
            { ty: "fl", nm: `border-${side}-color`, c, o, r: 1 },
          ]),
        });
      });
      return;
    }

    // Rounded box with differing sides: approximate with one uniform stroke.
    const maxWidth = Array.from({ length: n }, (_, i) => Math.max(...widths.map((ws) => ws[i]!)));
    const visibleSide = sideVisible.findIndex(Boolean);
    ctx.report.approximated(
      "border",
      ctx.node.selector,
      "rounded box with different border widths/colors per side is drawn with a single uniform border",
    );
    const geom = boxGeometry(
      ctx,
      kind,
      sizes,
      radii,
      maxWidth.map((w) => w / 2),
      "border-path",
    );
    ctx.layer.groups.push({
      order: 20,
      group: group("border", [geom, strokeItem(ctx, colors[visibleSide]!, maxWidth, "border")]),
    });
  },
};
