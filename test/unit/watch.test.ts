import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { watchInput } from "../../src/cli/watch.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("watchInput", () => {
  let dir: string;
  let stop = () => {};
  afterEach(() => {
    stop();
    rmSync(dir, { recursive: true, force: true });
  });

  function setup() {
    dir = mkdtempSync(path.join(tmpdir(), "css2lottie-watch-"));
    const input = path.join(dir, "anim.html");
    writeFileSync(input, "<div></div>");
    return input;
  }

  it("fires once per burst of changes to the input or files next to it", async () => {
    const input = setup();
    let calls = 0;
    stop = watchInput(input, () => calls++, { debounceMs: 100 });
    await wait(100);
    writeFileSync(input, "<div>1</div>");
    writeFileSync(path.join(dir, "style.css"), "div{}");
    writeFileSync(input, "<div>2</div>");
    await wait(600);
    expect(calls).toBe(1);
  });

  it("ignores the output it writes and editor swap files", async () => {
    const input = setup();
    const output = path.join(dir, "anim.json");
    let calls = 0;
    stop = watchInput(input, () => calls++, { debounceMs: 50, ignore: [output] });
    await wait(100);
    writeFileSync(output, "{}");
    writeFileSync(path.join(dir, ".anim.html.swp"), "x");
    await wait(400);
    expect(calls).toBe(0);
  });
});
