import { describe, expect, it } from "vitest";
import path from "node:path";
import { convertWithReport, startPreviewServer, createPreviewHtml } from "../src/index.js";
import { useBrowser } from "./helpers/browser.js";

describe("preview", () => {
  const browser = useBrowser();

  it("creates a self-describing comparison page", () => {
    const html = createPreviewHtml({
      lottie: {
        v: "5.7.4",
        fr: 60,
        ip: 0,
        op: 60,
        w: 100,
        h: 100,
        nm: "x<y",
        ddd: 0,
        assets: [],
        layers: [],
        markers: [],
      },
      sourceUrl: "/source/a.html",
      viewport: { width: 100, height: 100 },
      lottieScriptUrl: "/lottie.js",
      animationUrl: "/animation.json",
    });
    expect(html).toContain("x&lt;y");
    expect(html).toContain('src="/source/a.html"');
    expect(html).toContain("HTML + CSS (original)");
    expect(html).toContain("Lottie (lottie-web)");
  });

  it("serves the CSS original and the Lottie side by side", async () => {
    const file = path.resolve("examples/pulse.html");
    const { lottie, report } = await convertWithReport({
      file,
      width: 200,
      height: 200,
      browser: browser(),
    });
    const server = await startPreviewServer({
      lottie,
      report,
      file,
      viewport: report.stats.viewport,
      startOffsetMs: report.stats.startOffsetMs,
      open: false,
    });
    try {
      expect((await fetch(server.url + "animation.json").then((r) => r.json())).op).toBe(lottie.op);
      expect((await fetch(server.url + "lottie.js")).status).toBe(200);
      expect((await fetch(server.url + "source/pulse.html")).status).toBe(200);
      expect((await fetch(server.url + "source/..%2Fpackage.json")).status).toBe(403);

      const page = await browser().newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(server.url);
      await page.waitForFunction(() => document.querySelectorAll("#lottie svg").length === 1);
      const cssAnimations = await page.evaluate(
        () =>
          (document.getElementById("source") as HTMLIFrameElement).contentDocument!.getAnimations()
            .length,
      );
      expect(cssAnimations).toBeGreaterThan(0);
      // Scrub both to the same frame
      await page.evaluate(() => {
        const s = document.getElementById("scrub") as HTMLInputElement;
        s.value = "30";
        s.dispatchEvent(new Event("input"));
      });
      expect(await page.textContent("#frame")).toContain("frame 30");
      expect(errors).toEqual([]);
      await page.close();
    } finally {
      await server.close();
    }
  });
});
