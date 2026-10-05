import { describe, expect, it } from "vitest";
import { Reporter, formatReport } from "../../src/report.js";
import { readFileSync } from "node:fs";
import { VERSION } from "../../src/version.js";

describe("Reporter", () => {
  it("de-duplicates issues and formats a readable report", () => {
    const r = new Reporter();
    r.unsupported("box-shadow", "div.card", "box-shadow: 0 1px 2px black");
    r.unsupported("box-shadow", "div.card", "box-shadow: 0 1px 2px black");
    r.approximated("3D transform", "div.card", "flattened");
    r.note("hello");
    expect(r.issues).toHaveLength(2);
    const text = formatReport({
      issues: r.issues,
      notes: r.notes,
      stats: {
        fps: 60,
        frames: 60,
        durationMs: 1000,
        loop: true,
        startOffsetMs: 0,
        viewport: { width: 1, height: 1 },
        width: 100,
        height: 100,
        layers: 2,
        animations: 1,
        keyframes: 4,
        easedIntervals: 2,
        sampledIntervals: 0,
      },
    });
    expect(text).toContain("Unsupported (ignored):");
    expect(text).toContain("[box-shadow] div.card");
    expect(text).toContain("Approximated:");
    expect(text).toContain("note: hello");
  });
});

describe("version", () => {
  it("matches package.json", () => {
    expect(VERSION).toBe(JSON.parse(readFileSync("package.json", "utf8")).version);
  });
});
