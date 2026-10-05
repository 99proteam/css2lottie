import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};

export interface LoadedResource {
  bytes: Uint8Array;
  mime: string;
}

export function mimeFromUrl(url: string): string {
  const clean = url.split(/[?#]/)[0] ?? "";
  const ext = clean.slice(clean.lastIndexOf(".") + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** Load bytes for a data:, file: or http(s): URL. */
export async function loadResource(url: string): Promise<LoadedResource> {
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    const meta = url.slice(5, comma);
    const data = url.slice(comma + 1);
    const isBase64 = meta.endsWith(";base64");
    const mime = (isBase64 ? meta.slice(0, -7) : meta).split(";")[0] || "text/plain";
    const bytes = isBase64
      ? new Uint8Array(Buffer.from(data, "base64"))
      : new Uint8Array(Buffer.from(decodeURIComponent(data), "utf8"));
    return { bytes, mime };
  }
  if (url.startsWith("file:")) {
    return { bytes: new Uint8Array(await readFile(fileURLToPath(url))), mime: mimeFromUrl(url) };
  }
  if (/^https?:/i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const mime = res.headers.get("content-type")?.split(";")[0] ?? mimeFromUrl(url);
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime };
  }
  return { bytes: new Uint8Array(await readFile(url)), mime: mimeFromUrl(url) };
}

export function toDataUrl(r: LoadedResource): string {
  return `data:${r.mime};base64,${Buffer.from(r.bytes).toString("base64")}`;
}
