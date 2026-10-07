import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { convertWithReport } from "../src/index.js";
import { useBrowser } from "./helpers/browser.js";
import { expectValidLottie } from "./helpers/lottie.js";
import { pixelDiff, inkRatio, renderCss, renderLottie } from "./helpers/render.js";

interface Example {
  name: string;
  width: number;
  height: number;
}

const examples = JSON.parse(readFileSync("examples/examples.json", "utf8")) as Example[];

/** Max fraction of differing pixels between the CSS render and lottie-web. */
const MAX_DIFF: Record<string, number> = {
  "card-flip": 0.08, // CSS perspective is approximated by a flat 2D flip
  "text-wave": 0.03, // glyph rasterization (hinting) differs slightly
};

/**
 * Snapshots are recorded on Linux, as in CI. Other platforms shape text with sub-pixel
 * differences (DirectWrite/CoreText vs FreeType), so there the output has to match the
 * snapshot's structure exactly and its numbers within SNAPSHOT_TOLERANCE.
 */
const EXACT_SNAPSHOTS = process.platform === "linux";
const SNAPSHOT_TOLERANCE = 1;

/** Paths where `actual` differs from `expected` beyond SNAPSHOT_TOLERANCE. */
function snapshotMismatches(actual: unknown, expected: unknown, at = ""): string[] {
  if (typeof actual === "number" && typeof expected === "number") {
    return Math.abs(actual - expected) <= SNAPSHOT_TOLERANCE
      ? []
      : [`${at}: ${actual} vs ${expected}`];
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length)
      return [`${at}: array of ${(actual as unknown[])?.length} vs ${expected.length}`];
    return expected.flatMap((e, i) => snapshotMismatches(actual[i], e, `${at}/${i}`));
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") return [`${at}: not an object`];
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    return [...keys].flatMap((k) =>
      snapshotMismatches(
        (actual as Record<string, unknown>)[k],
        (expected as Record<string, unknown>)[k],
        `${at}/${k}`,
      ),
    );
  }
  return actual === expected
    ? []
    : [`${at}: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`];
}

describe("examples", () => {
  const browser = useBrowser();

  it("has at least 10 examples", () => {
    expect(examples.length).toBeGreaterThanOrEqual(10);
  });

  for (const ex of examples) {
    it(`${ex.name}: valid Lottie, matches snapshot and the CSS render`, async () => {
      const file = path.resolve("examples", `${ex.name}.html`);
      const { lottie, report } = await convertWithReport({
        file,
        width: ex.width,
        height: ex.height,
        browser: browser(),
      });
      expectValidLottie(lottie);
      expect(lottie.layers.length).toBeGreaterThan(0);
      expect(report.issues.filter((i) => i.severity === "warning")).toEqual([]);

      const snapshot = JSON.stringify({ lottie, report }, null, 1);
      const snapshotFile = `__snapshots__/examples/${ex.name}.json`;
      if (EXACT_SNAPSHOTS || !existsSync(path.resolve("test", snapshotFile))) {
        await expect(snapshot).toMatchFileSnapshot(snapshotFile);
      } else {
        const recorded: unknown = JSON.parse(
          readFileSync(path.resolve("test", snapshotFile), "utf8"),
        );
        expect(snapshotMismatches(JSON.parse(snapshot), recorded).slice(0, 10)).toEqual([]);
      }

      const maxDiff = MAX_DIFF[ex.name] ?? 0.005;
      for (const frac of [0, 0.23, 0.5, 0.81]) {
        const frame = Math.round(frac * lottie.op);
        const css = await renderCss(
          browser(),
          {
            url: pathToFileURL(file).href,
            width: ex.width,
            height: ex.height,
            startOffsetMs: report.stats.startOffsetMs,
          },
          (frame * 1000) / lottie.fr,
        );
        const lot = await renderLottie(browser(), lottie, frame);
        const diff = pixelDiff(css, lot);
        expect(
          diff,
          `${ex.name} frame ${frame}: ${(diff * 100).toFixed(2)}% pixels differ`,
        ).toBeLessThanOrEqual(maxDiff);
        if (inkRatio(css) > 0.001) expect(inkRatio(lot)).toBeGreaterThan(0.001);
      }
    });
  }
});
