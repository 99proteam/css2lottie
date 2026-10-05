import { expect } from "vitest";
import type { Layer, LottieAnimation, ShapeItem } from "../../src/lottie/types.js";
import { validateLottie } from "./schema.js";

const SHAPE_TYPES = new Set(["gr", "rc", "el", "sh", "fl", "st", "tm", "tr"]);

/** Schema validation plus structural invariants the schema doesn't check. */
export function expectValidLottie(lottie: LottieAnimation): void {
  expect(validateLottie(lottie)).toEqual([]);
  const inds = new Set(lottie.layers.map((l) => l.ind));
  expect(inds.size).toBe(lottie.layers.length);
  for (const layer of lottie.layers) {
    if (layer.parent !== undefined) expect(inds.has(layer.parent)).toBe(true);
    if (layer.ty === 2) expect(lottie.assets.some((a) => a.id === layer.refId)).toBe(true);
    if (layer.ty === 4) checkShapes(layer.shapes);
    checkKeyframes(layer, lottie.op);
  }
}

function checkShapes(items: ShapeItem[]): void {
  for (const it of items) {
    expect(SHAPE_TYPES.has(it.ty)).toBe(true);
    if (it.ty === "gr") {
      expect(it.it[it.it.length - 1]!.ty).toBe("tr");
      checkShapes(it.it);
    }
  }
}

function checkKeyframes(value: unknown, op: number): void {
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  if (obj.a === 1 && Array.isArray(obj.k)) {
    const keys = obj.k as Array<{ t: number }>;
    for (let i = 1; i < keys.length; i++) expect(keys[i]!.t).toBeGreaterThan(keys[i - 1]!.t);
    expect(keys[0]!.t).toBeGreaterThanOrEqual(0);
    expect(keys[keys.length - 1]!.t).toBeLessThanOrEqual(op);
    return;
  }
  for (const v of Object.values(obj)) checkKeyframes(v, op);
}

export function layerByName(lottie: LottieAnimation, name: string): Layer {
  const l = lottie.layers.find((x) => x.nm === name);
  if (!l)
    throw new Error(`layer ${name} not found in ${lottie.layers.map((x) => x.nm).join(", ")}`);
  return l;
}
