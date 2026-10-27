import { deflateRawSync } from "node:zlib";
import type { LottieAnimation } from "./lottie/types.js";
import { VERSION } from "./version.js";

export interface DotLottieOptions {
  /** Animation id inside the archive (file name of `animations/<id>.json`). Default "animation". */
  id?: string;
  /** Player hints written to the manifest. */
  loop?: boolean;
  autoplay?: boolean;
  speed?: number;
  /** Move embedded data-URL images into `images/` (smaller than base64). Default true. */
  extractImages?: boolean;
}

/** True for output paths that should be written as a dotLottie archive. */
export function isDotLottiePath(file: string): boolean {
  return /\.lottie$/i.test(file);
}

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

/**
 * Package a Lottie animation as a `.lottie` file (dotLottie): a zip with `manifest.json`,
 * `animations/<id>.json` and, for embedded images, `images/<asset>.<ext>`.
 * Supported by the LottieFiles players, dotlottie-web, and the Android/iOS/Flutter runtimes.
 */
export function toDotLottie(lottie: LottieAnimation, opts: DotLottieOptions = {}): Uint8Array {
  const id = (opts.id ?? "animation").replace(/[^\w.-]+/g, "_") || "animation";
  const files: Array<[string, Uint8Array]> = [];
  const animation: LottieAnimation = { ...lottie, assets: [...lottie.assets] };

  if (opts.extractImages !== false) {
    animation.assets = animation.assets.map((asset) => {
      if (!("p" in asset) || typeof asset.p !== "string") return asset;
      const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(asset.p);
      const ext = m && EXT[m[1]!];
      if (!m || !ext) return asset;
      const name = `${asset.id.replace(/[^\w.-]+/g, "_")}.${ext}`;
      files.push([`images/${name}`, Buffer.from(m[2]!, "base64")]);
      return { ...asset, u: "/images/", p: name, e: 0 as const };
    });
  }

  const manifest = {
    version: "1",
    generator: `css2lottie ${VERSION}`,
    author: "css2lottie",
    activeAnimationId: id,
    animations: [
      {
        id,
        speed: opts.speed ?? 1,
        loop: opts.loop ?? true,
        autoplay: opts.autoplay ?? true,
        direction: 1,
        playMode: "normal",
      },
    ],
  };
  const utf8 = (s: string) => new TextEncoder().encode(s);
  return zip([
    ["manifest.json", utf8(JSON.stringify(manifest))],
    [`animations/${id}.json`, utf8(JSON.stringify(animation))],
    ...files,
  ]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Minimal zip writer (deflate, no zip64): enough for a handful of small files. */
function zip(entries: Array<[string, Uint8Array]>): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // Fixed DOS timestamp (1980-01-01) keeps the output byte-for-byte reproducible.
  const dosTime = 0;
  const dosDate = (0 << 9) | (1 << 5) | 1;
  for (const [name, data] of entries) {
    const nameBytes = new TextEncoder().encode(name);
    const deflated = deflateRawSync(data);
    // Store tiny or incompressible files as-is.
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    local.set(nameBytes, 30);

    const dir = Buffer.alloc(46 + nameBytes.length);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); // version made by
    dir.writeUInt16LE(20, 6); // version needed
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(useDeflate ? 8 : 0, 10);
    dir.writeUInt16LE(dosTime, 12);
    dir.writeUInt16LE(dosDate, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt32LE(offset, 42);
    dir.set(nameBytes, 46);

    chunks.push(local, body);
    central.push(dir);
    offset += local.length + body.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}
