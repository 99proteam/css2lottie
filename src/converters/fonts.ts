import path from "node:path";
import opentype from "opentype.js";
import type { FontFaceInfo } from "../sampler/types.js";
import { loadResource } from "../utils/resources.js";

export type Font = opentype.Font;

function familyList(cssFamily: string): string[] {
  return cssFamily
    .split(",")
    .map((f) => f.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function weightNumber(w: string): number {
  if (w === "normal") return 400;
  if (w === "bold") return 700;
  const n = parseInt(w, 10);
  return Number.isFinite(n) ? n : 400;
}

/**
 * Finds a font *file* for a CSS font-family so text can be converted to outlines.
 * Sources: the `fonts` option (family → file), then @font-face rules in the page.
 * System fonts have no accessible file and cannot be outlined.
 */
export class FontResolver {
  private cache = new Map<string, Promise<Font | null>>();
  readonly failures: string[] = [];

  constructor(
    private readonly faces: FontFaceInfo[],
    private readonly userFonts: Record<string, string | Uint8Array>,
    private readonly baseDir: string,
  ) {}

  async resolve(cssFamily: string, weight: string, style: string): Promise<Font | null> {
    const key = `${cssFamily}|${weight}|${style}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.lookup(cssFamily, weight, style);
      this.cache.set(key, p);
    }
    return p;
  }

  private async lookup(cssFamily: string, weight: string, style: string): Promise<Font | null> {
    const wanted = weightNumber(weight);
    for (const family of familyList(cssFamily)) {
      const userKey = Object.keys(this.userFonts).find(
        (k) => k.toLowerCase() === family.toLowerCase(),
      );
      if (userKey) {
        const src = this.userFonts[userKey]!;
        try {
          const bytes =
            typeof src === "string"
              ? (await loadResource(path.resolve(this.baseDir, src))).bytes
              : src;
          return opentype.parse(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          );
        } catch (e) {
          this.failures.push(`${family}: ${(e as Error).message}`);
        }
      }
      const candidates = this.faces
        .filter((f) => f.family.toLowerCase() === family.toLowerCase())
        .sort((a, b) => {
          const sa = (a.style === style ? 0 : 1000) + Math.abs(weightNumber(a.weight) - wanted);
          const sb = (b.style === style ? 0 : 1000) + Math.abs(weightNumber(b.weight) - wanted);
          return sa - sb;
        });
      for (const face of candidates) {
        for (const url of face.urls) {
          if (/\.woff2(\?|#|$)/i.test(url) || url.startsWith("data:font/woff2")) {
            this.failures.push(
              `${family}: WOFF2 fonts are not supported for outlines (use TTF/OTF/WOFF)`,
            );
            continue;
          }
          try {
            const { bytes } = await loadResource(url);
            return opentype.parse(
              bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            );
          } catch (e) {
            this.failures.push(`${family}: ${(e as Error).message}`);
          }
        }
      }
    }
    return null;
  }
}
