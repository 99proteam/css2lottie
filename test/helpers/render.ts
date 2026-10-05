import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import type { Browser } from "playwright-core";
import type { LottieAnimation } from "../../src/lottie/types.js";

const require = createRequire(import.meta.url);
const LOTTIE_JS = readFileSync(
  require.resolve("lottie-web/build/player/lottie_svg.min.js"),
  "utf8",
);

export interface RenderSource {
  /** HTML string or a URL (file://...) */
  html?: string;
  url?: string;
  width: number;
  height: number;
  /** Timeline offset of frame 0 (report.stats.startOffsetMs) */
  startOffsetMs: number;
  selector?: string;
}

/** Screenshot the CSS source at composition time `ms`. */
export async function renderCss(browser: Browser, src: RenderSource, ms: number): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: src.width, height: src.height } });
  try {
    if (src.url) await page.goto(src.url, { waitUntil: "load" });
    else await page.setContent(src.html ?? "", { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    await page.evaluate((t) => {
      // Seek. Paused composited SVG animations may not repaint before the screenshot, so bake
      // their values into inline styles (commitStyles) and cancel them.
      const anims = document.getAnimations();
      for (const a of anims) {
        a.pause();
        a.currentTime = t * a.playbackRate;
      }
      const isSvg = (a: Animation) => {
        const eff = a.effect as KeyframeEffect | null;
        return !!eff?.target && !eff.pseudoElement && eff.target instanceof SVGElement;
      };
      for (const a of anims.filter(isSvg)) a.commitStyles();
      for (const a of anims.filter(isSvg)) a.cancel();
    }, src.startOffsetMs + ms);
    // Let the compositor repaint after seeking (SVG transforms can otherwise show a stale frame).
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    return await page.screenshot({ type: "png" });
  } finally {
    await page.close();
  }
}

/** Screenshot the Lottie rendered by lottie-web (SVG renderer) at frame `frame`. */
export async function renderLottie(
  browser: Browser,
  lottie: LottieAnimation,
  frame: number,
): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: lottie.w, height: lottie.h } });
  try {
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:#fff"><div id="c" style="width:${lottie.w}px;height:${lottie.h}px"></div></body></html>`,
    );
    await page.addScriptTag({ content: LOTTIE_JS });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluate(
      ({ data, frame }) =>
        new Promise<void>((resolve) => {
          const w = window as unknown as {
            lottie: {
              loadAnimation(o: unknown): {
                addEventListener(e: string, f: () => void): void;
                goToAndStop(f: number, isFrame: boolean): void;
              };
            };
          };
          const anim = w.lottie.loadAnimation({
            container: document.getElementById("c"),
            renderer: "svg",
            loop: false,
            autoplay: false,
            animationData: data,
          });
          anim.addEventListener("DOMLoaded", () => {
            anim.goToAndStop(frame, true);
            requestAnimationFrame(() => resolve());
          });
        }),
      { data: lottie, frame },
    );
    if (errors.length) throw new Error(`lottie-web error: ${errors.join("; ")}`);
    return await page.screenshot({ type: "png" });
  } finally {
    await page.close();
  }
}

/** Fraction of pixels whose max channel difference exceeds `threshold` (0..255). */
export function pixelDiff(a: Buffer, b: Buffer, threshold = 48): number {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  if (pa.width !== pb.width || pa.height !== pb.height) {
    throw new Error(`size mismatch ${pa.width}x${pa.height} vs ${pb.width}x${pb.height}`);
  }
  let bad = 0;
  const n = pa.width * pa.height;
  for (let i = 0; i < n * 4; i += 4) {
    const d = Math.max(
      Math.abs(pa.data[i]! - pb.data[i]!),
      Math.abs(pa.data[i + 1]! - pb.data[i + 1]!),
      Math.abs(pa.data[i + 2]! - pb.data[i + 2]!),
    );
    if (d > threshold) bad++;
  }
  return bad / n;
}

/** Fraction of pixels that are not (near) white — used to make sure a frame isn't empty. */
export function inkRatio(png: Buffer): number {
  const p = PNG.sync.read(png);
  let ink = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    if (p.data[i]! < 235 || p.data[i + 1]! < 235 || p.data[i + 2]! < 235) ink++;
  }
  return ink / (p.width * p.height);
}
