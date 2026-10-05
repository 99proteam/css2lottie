import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { convert, convertWithReport, type ConvertOptions } from "../src/index.js";
import type { LottieAnimation, ShapeLayer } from "../src/lottie/types.js";
import { useBrowser } from "./helpers/browser.js";
import { expectValidLottie, layerByName } from "./helpers/lottie.js";
import { pixelDiff, renderCss, renderLottie } from "./helpers/render.js";

const page = (css: string, body: string, script = "") =>
  `<!doctype html><html><head><style>body{margin:0}${css}</style></head><body>${body}${script ? `<script>${script}</script>` : ""}</body></html>`;

function keyCount(prop: unknown): number {
  const p = prop as { a: number; k: unknown[] };
  return p.a === 1 ? p.k.length : 0;
}

describe("convert()", () => {
  const browser = useBrowser();
  const run = (opts: ConvertOptions) =>
    convertWithReport({ width: 200, height: 200, browser: browser(), ...opts });

  async function expectFidelity(
    html: string,
    lottie: LottieAnimation,
    startOffsetMs: number,
    max = 0.005,
  ) {
    for (const frac of [0, 0.3, 0.6, 0.95]) {
      const frame = Math.round(frac * lottie.op);
      const css = await renderCss(
        browser(),
        { html, width: lottie.w, height: lottie.h, startOffsetMs },
        (frame * 1000) / lottie.fr,
      );
      const lot = await renderLottie(browser(), lottie, frame);
      expect(pixelDiff(css, lot), `frame ${frame}`).toBeLessThanOrEqual(max);
    }
  }

  it("matches the documented API shape", async () => {
    const html = page(
      ".b{width:50px;height:50px;background:red;animation:a 1s}@keyframes a{to{opacity:0}}",
      '<div class="b"></div>',
    );
    const lottie = await convert({ html, width: 400, height: 400, fps: 60, browser: browser() });
    expect(lottie).toMatchObject({ v: "5.7.4", fr: 60, ip: 0, op: 60, w: 400, h: 400, ddd: 0 });
    expectValidLottie(lottie);
  });

  it("converts keyframes into a few eased Lottie keyframes", async () => {
    const html = page(
      ".b{position:absolute;left:20px;top:20px;width:40px;height:40px;background:#09f;animation:m 1s cubic-bezier(.2,.8,.2,1) both}" +
        "@keyframes m{to{transform:translate(100px,50px) rotate(90deg) scale(1.5);opacity:.5;background:#f90}}",
      '<div class="b"></div>',
    );
    const { lottie, report } = await run({ html });
    const layer = layerByName(lottie, "div.b") as ShapeLayer;
    expect(keyCount(layer.ks.p)).toBe(2);
    expect(keyCount(layer.ks.r)).toBe(2);
    expect(keyCount(layer.ks.s)).toBe(2);
    expect(keyCount(layer.ks.o)).toBe(2);
    expect((layer.ks.p as { k: Array<{ o: { x: number[] } }> }).k[0]!.o.x).toEqual([0.2]);
    expect(report.stats.sampledIntervals).toBe(0);
    await expectFidelity(html, lottie, 0);
  });

  it("supports transitions triggered on load (width + color)", async () => {
    const html = page(
      ".bar{width:10px;height:20px;background:#00f;transition:width 1s ease-out,background-color 1s}.go .bar{width:180px;background:#0f0}",
      '<div class="w"><div class="bar"></div></div>',
      'addEventListener("load",()=>{document.body.offsetWidth;document.querySelector(".w").classList.add("go")})',
    );
    const { lottie, report } = await run({ html });
    expect(report.stats.animations).toBe(2);
    expect(report.stats.durationMs).toBe(1000);
    await expectFidelity(html, lottie, 0);
  });

  it("respects delay, iteration count, alternate direction and fill-mode", async () => {
    const html = page(
      ".b{position:absolute;left:10px;top:80px;width:30px;height:30px;background:#333;animation:m .5s ease-in .25s 3 alternate backwards}" +
        "@keyframes m{from{transform:translateX(0)}to{transform:translateX(150px)}}",
      '<div class="b"></div>',
    );
    const auto = await run({ html });
    expect(auto.report.stats.durationMs).toBe(1750);
    expect(auto.report.stats.loop).toBe(false);
    await expectFidelity(html, auto.lottie, 0);
    const { lottie } = await run({ html, duration: 2000 });
    await expectFidelity(html, lottie, 0);
    // fill-mode backwards (not forwards): the element jumps back after the last iteration
    const p = (layerByName(lottie, "div.b").ks.p as { k: Array<{ h?: number }> }).k;
    expect(p.some((k) => k.h === 1)).toBe(true);
  });

  it("loops infinite animations seamlessly", async () => {
    const html = page(
      ".a,.b{position:absolute;top:50px;width:20px;height:20px;background:#000}.a{left:20px;animation:s .4s linear infinite}.b{left:100px;animation:s .6s ease infinite}" +
        "@keyframes s{to{transform:rotate(180deg)}}",
      '<div class="a"></div><div class="b"></div>',
    );
    const { report } = await run({ html });
    expect(report.stats.loop).toBe(true);
    expect(report.stats.durationMs).toBe(1200);
  });

  it("falls back to sampled keyframes for steps()", async () => {
    const html = page(
      ".b{position:absolute;left:0;top:90px;width:20px;height:20px;background:#000;animation:m 1s steps(4,end) both}@keyframes m{to{transform:translateX(160px)}}",
      '<div class="b"></div>',
    );
    const { lottie, report } = await run({ html });
    expect(report.stats.sampledIntervals).toBeGreaterThan(0);
    await expectFidelity(html, lottie, 0);
  });

  it("parents nested elements and multiplies opacity", async () => {
    const html = page(
      ".p{position:absolute;left:50px;top:50px;width:100px;height:100px;background:#eee;opacity:.5;animation:r 1s linear}" +
        ".c{position:absolute;left:10px;top:10px;width:30px;height:30px;background:#f00}@keyframes r{to{transform:rotate(90deg)}}",
      '<div class="p"><div class="c"></div></div>',
    );
    const { lottie } = await run({ html });
    const parent = layerByName(lottie, "div.p");
    const child = layerByName(lottie, "div.c");
    expect(child.parent).toBe(parent.ind);
    expect(child.ks.o).toEqual({ a: 0, k: 50 });
    expect(child.ks.p).toEqual({ a: 0, k: [25, 25, 0] });
    // children are drawn on top of their parent: earlier in the layers array
    expect(lottie.layers.indexOf(child)).toBeLessThan(lottie.layers.indexOf(parent));
  });

  it("converts inline SVG shapes with viewBox, strokes and transforms", async () => {
    const html = page(
      "svg *{transform-box:fill-box;transform-origin:center}.r{animation:r 1s ease-in-out both}@keyframes r{to{transform:rotate(45deg)}}",
      `<svg width="200" height="200" viewBox="0 0 100 100">
        <g opacity="0.8"><rect class="r" x="10" y="10" width="30" height="20" rx="4" fill="#e11d48"/>
        <circle cx="70" cy="30" r="15" fill="none" stroke="#2563eb" stroke-width="4"/>
        <ellipse cx="30" cy="75" rx="20" ry="10" fill="#16a34a"/>
        <polygon points="60,60 90,60 75,90" fill="#f59e0b"/>
        <line x1="5" y1="95" x2="95" y2="95" stroke="#000" stroke-width="2" stroke-linecap="round"/>
        <path d="M50 40 Q 60 50 50 60 T 50 80" fill="none" stroke="#7c3aed" stroke-width="3"/></g>
      </svg>`,
    );
    const { lottie } = await run({ html });
    expectValidLottie(lottie);
    expect(lottie.layers.some((l) => l.nm.endsWith("viewBox") && l.ty === 3)).toBe(true);
    await expectFidelity(html, lottie, 0);
  });

  it("embeds <img> as a base64 image asset", async () => {
    const png = new PNG({ width: 4, height: 4 });
    for (let i = 0; i < png.data.length; i += 4) png.data.set([255, 0, 0, 255], i);
    const src = `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
    const html = page(
      "img{position:absolute;left:50px;top:50px;width:100px;height:100px;animation:f 1s}@keyframes f{from{opacity:0}}",
      `<img src="${src}">`,
    );
    const { lottie } = await run({ html });
    expect(lottie.assets).toHaveLength(1);
    expect(lottie.assets[0]).toMatchObject({ w: 100, h: 100, e: 1 });
    expect(lottie.assets[0]!.p.startsWith("data:image/png;base64,")).toBe(true);
    expect(lottie.layers.find((l) => l.ty === 2)).toBeDefined();
    expectValidLottie(lottie);
  });

  it("converts absolutely positioned pseudo-elements", async () => {
    const html = page(
      ".h{position:absolute;left:60px;top:60px;width:80px;height:80px;background:#ddd}.h::after{content:'';position:absolute;left:20px;top:20px;width:40px;height:40px;background:#f00;animation:s 1s both}@keyframes s{from{transform:scale(0)}}",
      '<div class="h"></div>',
    );
    const { lottie } = await run({ html });
    expect(layerByName(lottie, "div.h::after").parent).toBe(layerByName(lottie, "div.h").ind);
    await expectFidelity(html, lottie, 0);
  });

  it("supports Web Animations created with element.animate()", async () => {
    const html = page(
      ".b{position:absolute;left:10px;top:10px;width:30px;height:30px;background:#000}",
      '<div class="b"></div>',
      'document.querySelector(".b").animate([{transform:"none"},{transform:"translate(100px,100px)"}],{duration:800,easing:"ease-in",fill:"forwards"})',
    );
    const { lottie, report } = await run({ html });
    expect(report.stats.animations).toBe(1);
    expect(keyCount(layerByName(lottie, "div.b").ks.p)).toBe(2);
  });

  it("converts a single root with --selector (size from the element, centred)", async () => {
    const html = page(
      ".other{width:300px;height:300px;background:blue}.logo{margin:40px;width:120px;height:80px;background:#f00;animation:a 1s}@keyframes a{to{opacity:0}}",
      '<div class="other"></div><div class="logo"></div>',
    );
    const { lottie } = await convertWithReport({ html, selector: ".logo", browser: browser() });
    expect([lottie.w, lottie.h]).toEqual([120, 80]);
    expect(lottie.layers).toHaveLength(1);
    expect(lottie.layers[0]!.ks.p).toEqual({ a: 0, k: [60, 40, 0] });
    const wide = await convertWithReport({
      html,
      selector: ".logo",
      width: 200,
      height: 200,
      browser: browser(),
    });
    expect(wide.lottie.layers[0]!.ks.p).toEqual({ a: 0, k: [100, 100, 0] });
  });

  it("reports unsupported features", async () => {
    const html = page(
      ".b{width:50px;height:50px;background:linear-gradient(red,blue);box-shadow:0 2px 4px #000;animation:a 1s}@keyframes a{to{filter:blur(4px);opacity:.5}}" +
        "p{font-family:NoSuchFont}",
      '<div class="b"></div><p>Hello</p>',
    );
    const { report } = await run({ html });
    const features = report.issues.map((i) => i.feature);
    expect(features).toContain("box-shadow");
    expect(features).toContain("background-image (gradients/images)");
    expect(features).toContain("animated filter");
    expect(report.issues.find((i) => i.feature === "text")?.detail).toMatch(/no font file/);
  });

  it("converts text to outlines when a font file is provided", async () => {
    const html = page("p{margin:0;padding:20px;font:700 40px Brand;color:#123}", "<p>Hi</p>");
    const { lottie, report } = await run({
      html,
      fonts: { Brand: "examples/fonts/InstrumentSans-Bold.ttf" },
    });
    const layer = layerByName(lottie, "p:nth-child(1)") as ShapeLayer;
    expect(layer.shapes.some((g) => g.nm === "text")).toBe(true);
    expect(report.issues.find((i) => i.feature === "text")?.severity).toBe("approximated");
  });

  it("can disable keyframe optimization", async () => {
    const html = page(
      ".b{width:50px;height:50px;background:red;animation:a 1s ease}@keyframes a{to{opacity:0}}",
      '<div class="b"></div>',
    );
    const opt = await run({ html });
    const raw = await run({ html, optimizeKeyframes: false });
    expect(keyCount(layerByName(raw.lottie, "div.b").ks.o)).toBeGreaterThan(
      keyCount(layerByName(opt.lottie, "div.b").ks.o),
    );
  });

  it("honours fps, duration and background options", async () => {
    const html = page(
      "body{background:#fafafa}.b{width:50px;height:50px;background:red;animation:a 3s}@keyframes a{to{opacity:0}}",
      '<div class="b"></div>',
    );
    const { lottie } = await run({ html, fps: 30, duration: 2000, background: true });
    expect(lottie.op).toBe(60);
    expect(lottie.fr).toBe(30);
    expect(lottie.layers[lottie.layers.length - 1]!.nm).toBe("background");
  });

  it("fails clearly for a selector that matches nothing and invalid options", async () => {
    await expect(run({ html: page("", "<div></div>"), selector: ".missing" })).rejects.toThrow(
      /matched no element/,
    );
    await expect(run({ html: "<p>x</p>", fps: 0 })).rejects.toThrow(/fps/);
    await expect(convert({ browser: browser() })).rejects.toThrow(/html/);
  });
});
