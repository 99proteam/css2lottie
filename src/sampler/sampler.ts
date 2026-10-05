import { pathToFileURL } from "node:url";
import path from "node:path";
import type { Browser, Page } from "playwright-core";
import { pageDiscover, pageSample, type DiscoverInput } from "./page-script.js";
import type { DiscoveryResult, NodeKind, SampleResult } from "./types.js";
import { launchBrowser } from "./browser.js";

export interface LoadSource {
  html?: string;
  file?: string;
  url?: string;
  baseUrl?: string;
}

export interface PageSession {
  page: Page;
  discovery: DiscoveryResult;
  /** Computed background of <body> (or <html> when body is transparent) */
  pageBackground: string;
  sample(compTimes: number[], startOffset: number): Promise<SampleResult>;
  close(): Promise<void>;
}

function injectBase(html: string, baseUrl: string): string {
  const tag = `<base href="${baseUrl.replace(/"/g, "&quot;")}">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${tag}`);
  return tag + html;
}

/** Open the page, wait for it to settle, pause all animations and discover the node tree. */
export async function openPage(
  source: LoadSource,
  viewport: { width: number; height: number },
  discoverInput: {
    rootSelector: string | null;
    styleLists: Record<NodeKind, string[]>;
    settleFrames: number;
  },
  opts: { browser?: Browser; executablePath?: string },
): Promise<PageSession> {
  const ownBrowser = !opts.browser;
  const browser = opts.browser ?? (await launchBrowser(opts.executablePath));
  const context = await browser.newContext({
    viewport: {
      width: Math.max(1, Math.round(viewport.width)),
      height: Math.max(1, Math.round(viewport.height)),
    },
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  try {
    if (source.file) {
      await page.goto(pathToFileURL(path.resolve(source.file)).href, { waitUntil: "load" });
    } else if (source.url) {
      await page.goto(source.url, { waitUntil: "load" });
    } else if (source.html !== undefined) {
      const html = source.baseUrl ? injectBase(source.html, source.baseUrl) : source.html;
      await page.setContent(html, { waitUntil: "load" });
    } else {
      throw new Error("css2lottie: one of `html`, `file` or `url` is required");
    }
    const input: DiscoverInput = discoverInput;
    const discovery = await page.evaluate(pageDiscover, input);
    const pageBackground = await page.evaluate(() => {
      const b = getComputedStyle(document.body).backgroundColor;
      if (b && b !== "rgba(0, 0, 0, 0)" && b !== "transparent") return b;
      return getComputedStyle(document.documentElement).backgroundColor;
    });
    return {
      page,
      discovery,
      pageBackground,
      async sample(compTimes, startOffset) {
        const BATCH = 120;
        const result: SampleResult = { times: compTimes, samples: [], text: {}, issues: [] };
        for (let i = 0; i < compTimes.length; i += BATCH) {
          const batch = compTimes.slice(i, i + BATCH).map((t) => t + startOffset);
          const part = await page.evaluate(pageSample, {
            timelineTimes: batch,
            measureText: i === 0,
            cleanup: i + BATCH >= compTimes.length,
          });
          result.samples.push(...part.samples);
          Object.assign(result.text, part.text);
          result.issues.push(...part.issues);
        }
        return result;
      },
      async close() {
        await context.close();
        if (ownBrowser) await browser.close();
      },
    };
  } catch (e) {
    await context.close().catch(() => {});
    if (ownBrowser) await browser.close().catch(() => {});
    throw e;
  }
}
