import { describe, expect, it } from "vitest";
import zlib from "node:zlib";
import { crc32, isDotLottiePath, toDotLottie } from "../../src/dotlottie.js";
import type { LottieAnimation } from "../../src/lottie/types.js";

/** Tiny zip reader for the test: central directory → { name: bytes }, checking CRCs. */
function unzip(buf: Uint8Array): Record<string, Buffer> {
  const b = Buffer.from(buf);
  const end = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = b.readUInt16LE(end + 10);
  let p = b.readUInt32LE(end + 16);
  const files: Record<string, Buffer> = {};
  for (let i = 0; i < count; i++) {
    expect(b.readUInt32LE(p)).toBe(0x02014b50);
    const method = b.readUInt16LE(p + 10);
    const crc = b.readUInt32LE(p + 16);
    const size = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const offset = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const localNameLen = b.readUInt16LE(offset + 26);
    const body = b.subarray(offset + 30 + localNameLen, offset + 30 + localNameLen + size);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    expect(crc32(data)).toBe(crc);
    if (typeof zlib.crc32 === "function") expect(zlib.crc32(data)).toBe(crc);
    files[name] = data;
    p += 46 + nameLen;
  }
  return files;
}

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function animation(assets: LottieAnimation["assets"] = []): LottieAnimation {
  return {
    v: "5.7.4",
    fr: 60,
    ip: 0,
    op: 60,
    w: 100,
    h: 100,
    nm: "test",
    ddd: 0,
    assets,
    layers: [],
    markers: [],
  };
}

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("isDotLottiePath", () => {
  it("recognizes .lottie outputs", () => {
    expect(isDotLottiePath("spinner.lottie")).toBe(true);
    expect(isDotLottiePath("SPINNER.LOTTIE")).toBe(true);
    expect(isDotLottiePath("spinner.json")).toBe(false);
  });
});

describe("toDotLottie", () => {
  it("writes a manifest and the animation", () => {
    const files = unzip(toDotLottie(animation(), { id: "my spinner" }));
    expect(Object.keys(files).sort()).toEqual(["animations/my_spinner.json", "manifest.json"]);
    const manifest = JSON.parse(files["manifest.json"]!.toString());
    expect(manifest).toMatchObject({
      version: "1",
      activeAnimationId: "my_spinner",
      animations: [{ id: "my_spinner", loop: true, autoplay: true, speed: 1 }],
    });
    expect(manifest.generator).toMatch(/^css2lottie /);
    expect(JSON.parse(files["animations/my_spinner.json"]!.toString()).nm).toBe("test");
  });

  it("moves embedded images into images/", () => {
    const lottie = animation([
      { id: "image_1", w: 1, h: 1, u: "", p: `data:image/png;base64,${PNG_1PX}`, e: 1 },
      { id: "remote", w: 1, h: 1, u: "", p: "https://example.com/a.png", e: 0 },
    ]);
    const files = unzip(toDotLottie(lottie));
    expect(files["images/image_1.png"]!.equals(Buffer.from(PNG_1PX, "base64"))).toBe(true);
    const assets = JSON.parse(files["animations/animation.json"]!.toString()).assets;
    expect(assets[0]).toMatchObject({ id: "image_1", u: "/images/", p: "image_1.png", e: 0 });
    expect(assets[1].p).toBe("https://example.com/a.png");
    // The input animation is not modified.
    expect((lottie.assets[0] as { p: string }).p).toMatch(/^data:/);
  });

  it("can keep images embedded", () => {
    const lottie = animation([
      { id: "i", w: 1, h: 1, u: "", p: `data:image/png;base64,${PNG_1PX}`, e: 1 },
    ]);
    const files = unzip(toDotLottie(lottie, { extractImages: false }));
    expect(Object.keys(files)).not.toContain("images/i.png");
  });

  it("is reproducible", () => {
    expect(
      Buffer.from(toDotLottie(animation())).equals(Buffer.from(toDotLottie(animation()))),
    ).toBe(true);
  });
});
