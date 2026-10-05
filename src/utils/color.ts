/** RGBA color with all channels in 0..1 (Lottie convention). */
export type RGBA = [number, number, number, number];

const NAMED: Record<string, RGBA> = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [1, 1, 1, 1],
  red: [1, 0, 0, 1],
  green: [0, 128 / 255, 0, 1],
  lime: [0, 1, 0, 1],
  blue: [0, 0, 1, 1],
  yellow: [1, 1, 0, 1],
  cyan: [0, 1, 1, 1],
  aqua: [0, 1, 1, 1],
  magenta: [1, 0, 1, 1],
  fuchsia: [1, 0, 1, 1],
  gray: [128 / 255, 128 / 255, 128 / 255, 1],
  grey: [128 / 255, 128 / 255, 128 / 255, 1],
  orange: [1, 165 / 255, 0, 1],
  purple: [128 / 255, 0, 128 / 255, 1],
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function parseChannel(token: string, scale: number): number {
  const t = token.trim();
  if (t === "none") return 0;
  if (t.endsWith("%")) return parseFloat(t) / 100;
  return parseFloat(t) / scale;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number): number => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [f(hue + 1 / 3), f(hue), f(hue - 1 / 3)];
}

/**
 * Parse a CSS color as produced by `getComputedStyle` (rgb/rgba/color(srgb ...)), plus hex,
 * hsl() and a handful of named colors. Returns `null` for `none`, `url(...)` paints and
 * anything unparseable. The in-page sampler normalizes exotic color spaces (oklch, lab, ...)
 * to rgb() before they reach this function.
 */
export function parseCssColor(input: string | null | undefined): RGBA | null {
  if (!input) return null;
  const str = input.trim().toLowerCase();
  if (str === "" || str === "none" || str.startsWith("url(")) return null;
  if (str in NAMED) return [...NAMED[str]!] as RGBA;

  if (str.startsWith("#")) {
    let hex = str.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    }
    if (hex.length !== 6 && hex.length !== 8) return null;
    const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
    const rgba: RGBA = [n(0), n(2), n(4), hex.length === 8 ? n(6) : 1];
    return rgba.some((v) => Number.isNaN(v)) ? null : rgba;
  }

  const fn = /^([a-z-]+)\((.*)\)$/.exec(str);
  if (!fn) return null;
  const name = fn[1]!;
  const body = fn[2]!;
  // Split "r g b / a" or "r, g, b, a"
  const [main, alphaPart] = body.includes("/") ? body.split("/") : [body, undefined];
  const parts = main!
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (name === "rgb" || name === "rgba") {
    if (parts.length < 3) return null;
    const a = alphaPart ?? parts[3];
    return [
      clamp01(parseChannel(parts[0]!, 255)),
      clamp01(parseChannel(parts[1]!, 255)),
      clamp01(parseChannel(parts[2]!, 255)),
      a === undefined ? 1 : clamp01(parseChannel(a, 1)),
    ];
  }
  if (name === "color" && parts[0] === "srgb") {
    if (parts.length < 4) return null;
    return [
      clamp01(parseChannel(parts[1]!, 1)),
      clamp01(parseChannel(parts[2]!, 1)),
      clamp01(parseChannel(parts[3]!, 1)),
      alphaPart === undefined ? 1 : clamp01(parseChannel(alphaPart, 1)),
    ];
  }
  if (name === "hsl" || name === "hsla") {
    if (parts.length < 3) return null;
    const h = parseFloat(parts[0]!);
    const s = clamp01(parseFloat(parts[1]!) / 100);
    const l = clamp01(parseFloat(parts[2]!) / 100);
    const a = alphaPart ?? parts[3];
    const [r, g, b] = hslToRgb(h, s, l);
    return [r, g, b, a === undefined ? 1 : clamp01(parseChannel(a, 1))];
  }
  return null;
}

/** Round color channels to 4 decimals to keep JSON compact. */
export function roundColor(c: RGBA): RGBA {
  return c.map((v) => Math.round(v * 10000) / 10000) as RGBA;
}
