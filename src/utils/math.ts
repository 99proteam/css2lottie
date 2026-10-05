export function round(value: number, decimals = 3): number {
  const f = 10 ** decimals;
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export function roundArray(values: number[], decimals = 3): number[] {
  return values.map((v) => round(v, decimals));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x;
}

export function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return Math.abs(a * b) / gcd(a, b);
}

/** Parse a CSS length in px (computed values are px or %). Percentages resolve against `basis`. */
export function parseLength(value: string | undefined | null, basis = 0): number {
  if (!value) return 0;
  const v = value.trim();
  if (v === "" || v === "auto" || v === "none" || v === "normal") return 0;
  if (v.endsWith("%")) return (parseFloat(v) / 100) * basis;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
