import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { main } from "../src/cli/main.js";
import { expectValidLottie } from "./helpers/lottie.js";

function io() {
  const out = { stdout: "", stderr: "" };
  return {
    out,
    io: {
      stdout: (s: string) => void (out.stdout += s),
      stderr: (s: string) => void (out.stderr += s),
    },
  };
}

describe("cli", () => {
  let dir: string;
  let input: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "css2lottie-cli-"));
    input = path.join(dir, "anim.html");
    writeFileSync(
      input,
      `<style>body{margin:0}.b{width:40px;height:40px;background:#f00;box-shadow:0 0 4px #000;animation:a .5s}.c{width:20px;height:20px;background:#00f}@keyframes a{to{opacity:0}}</style><div class="b"></div><div class="c"></div>`,
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("prints help and version", async () => {
    const h = io();
    expect(await main(["--help"], h.io)).toBe(0);
    expect(h.out.stdout).toContain("--selector");
    const v = io();
    expect(await main(["--version"], v.io)).toBe(0);
    expect(v.out.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("converts a file with the documented flags", async () => {
    const output = path.join(dir, "out.json");
    const r = io();
    const code = await main(
      [input, "-o", output, "--width", "120", "--height", "80", "--fps", "30", "--report"],
      r.io,
    );
    expect(code).toBe(0);
    const json = JSON.parse(readFileSync(output, "utf8"));
    expect([json.w, json.h, json.fr, json.op]).toEqual([120, 80, 30, 15]);
    expectValidLottie(json);
    expect(r.out.stderr).toContain("[box-shadow] div.b");
  });

  it("defaults the output name, supports --selector, --duration and stdout", async () => {
    const r = io();
    expect(await main([input, "--selector", ".c", "--duration", "1s"], r.io)).toBe(0);
    const json = JSON.parse(readFileSync(path.join(dir, "anim.json"), "utf8"));
    expect([json.w, json.h, json.op]).toEqual([20, 20, 60]);
    const s = io();
    expect(await main([input, "-o", "-", "--pretty"], s.io)).toBe(0);
    expect(JSON.parse(s.out.stdout).v).toBe("5.7.4");
    expect(existsSync(path.join(dir, "-"))).toBe(false);
  });

  it("writes the report as JSON", async () => {
    const reportFile = path.join(dir, "report.json");
    expect(
      await main([input, "-o", path.join(dir, "x.json"), "--report-json", reportFile], io().io),
    ).toBe(0);
    const report = JSON.parse(readFileSync(reportFile, "utf8"));
    expect(report.issues.some((i: { feature: string }) => i.feature === "box-shadow")).toBe(true);
  });

  it("writes a dotLottie archive for .lottie outputs", async () => {
    const output = path.join(dir, "anim.lottie");
    const r = io();
    expect(await main([input, "-o", output], r.io)).toBe(0);
    const bytes = readFileSync(output);
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(bytes.includes(Buffer.from("manifest.json"))).toBe(true);
    expect(bytes.includes(Buffer.from("animations/anim.json"))).toBe(true);
    expect(r.out.stderr).toContain("anim.lottie");
  });

  it("re-converts on change with --watch and live-reloads the preview", async () => {
    const output = path.join(dir, "watched.json");
    const controller = new AbortController();
    const r = io();
    const done = main([input, "-o", output, "--watch", "--preview", "--no-open"], {
      ...r.io,
      signal: controller.signal,
    });
    const until = async (check: () => boolean) => {
      for (let i = 0; i < 200 && !check(); i++) await new Promise((res) => setTimeout(res, 100));
      expect(check()).toBe(true);
    };
    await until(() => r.out.stderr.includes("Watching"));
    const url = /Preview: (\S+)/.exec(r.out.stderr)![1]!;
    expect(await fetch(url + "version").then((res) => res.text())).toBe("0");
    expect(await fetch(url).then((res) => res.text())).toContain('"liveReloadUrl":"/version"');
    expect(JSON.parse(readFileSync(output, "utf8")).w).toBe(512);

    const original = readFileSync(input, "utf8");
    writeFileSync(input, original + "<!-- changed -->");
    // A second "✔ watched.json" line means the change was picked up and converted.
    await until(() => r.out.stderr.split("watched.json").length > 2);
    expect(Number(await fetch(url + "version").then((res) => res.text()))).toBeGreaterThan(0);

    controller.abort();
    expect(await done).toBe(0);
    writeFileSync(input, original);
  });

  it("rejects --watch for URLs", async () => {
    await expect(main(["https://example.com", "--watch"], io().io)).rejects.toThrow(/--watch/);
  });

  it("fails on bad input", async () => {
    await expect(main([path.join(dir, "missing.html")], io().io)).rejects.toThrow(/not found/);
    await expect(main([input, "--fps", "abc"], io().io)).rejects.toThrow(/--fps/);
    await expect(main([input, "--duration", "soon"], io().io)).rejects.toThrow(/--duration/);
    expect(await main([], io().io)).toBe(1);
  });
});
