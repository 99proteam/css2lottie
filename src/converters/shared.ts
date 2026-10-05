import type { GroupShape, ShapeItem, TransformShape } from "../lottie/types.js";

/** CSS properties that change an element's layout box (position/size). */
export const LAYOUT_PROPERTIES = [
  "left",
  "top",
  "right",
  "bottom",
  "inset",
  "inset-inline",
  "inset-block",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "flex-basis",
  "flex-grow",
  "border-width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
] as const;

export const TRANSFORM_PROPERTIES = [
  "transform",
  "translate",
  "rotate",
  "scale",
  "transform-origin",
] as const;

export const BORDER_RADIUS_PROPERTIES = [
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
] as const;

export const SIDES = ["top", "right", "bottom", "left"] as const;
export const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"] as const;

export function identityTransformShape(): TransformShape {
  return {
    ty: "tr",
    a: { a: 0, k: [0, 0] },
    p: { a: 0, k: [0, 0] },
    s: { a: 0, k: [100, 100] },
    r: { a: 0, k: 0 },
    o: { a: 0, k: 100 },
    sk: { a: 0, k: 0 },
    sa: { a: 0, k: 0 },
  };
}

export function group(name: string, items: ShapeItem[]): GroupShape {
  return { ty: "gr", nm: name, it: [...items, identityTransformShape()], np: items.length };
}

/** Values per sample → true when the vector never changes. */
export function isConstant(values: number[][], tolerance = 1e-6): boolean {
  const f = values[0];
  if (!f) return true;
  return values.every((v) => v.every((x, i) => Math.abs(x - f[i]!) <= tolerance));
}
