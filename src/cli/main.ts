import { parseArgs } from "node:util";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { convertWithReport } from "../convert.js";
import { formatReport } from "../report.js";
import { startPreviewServer } from "../preview/preview.js";
import { VERSION } from "../version.js";

const HELP = `css2lottie ${VERSION} — convert HTML + CSS animations to Lottie JSON

Usage:
  css2lottie <input.html> [-o output.json] [options]
  css2lottie install-browser          download the headless Chromium used for sampling

Options:
  -o, --output <file>        Output JSON file (default: <input>.json, "-" for stdout)
      --width <px>           Composition width (default: root element width or 512)
      --height <px>          Composition height (default: root element height or 512)
      --fps <n>              Frames per second (default: 60)
  -d, --duration <ms>        Duration in ms (default: auto-detect; accepts "2s")
  -s, --selector <css>       Convert only this root element
      --report               Print unsupported/approximated features
      --report-json <file>   Write the report as JSON
      --preview              Open a side-by-side preview (CSS vs Lottie) in the browser
      --port <n>             Port for --preview (default: random)
      --no-open              With --preview: print the URL but don't open a browser
      --no-optimize          Disable easing optimization (per-frame keyframes)
      --background           Include the page background color as a layer
      --font <family=file>   Font file for text outlines (repeatable)
      --pretty               Pretty-print the JSON
      --executable-path <p>  Chromium/Chrome executable to use
  -v, --version              Print version
      --help                 Show this help
`;

function parseDuration(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const m = /^([\d.]+)\s*(ms|s)?$/.exec(v.trim());
  if (!m) throw new Error(`Invalid --duration "${v}" (use e.g. 1500 or 1.5s)`);
  return m[2] === "s" ? parseFloat(m[1]!) * 1000 : parseFloat(m[1]!);
}

function parseNumber(name: string, v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --${name} "${v}"`);
  return n;
}

async function installBrowser(): Promise<number> {
  const require = createRequire(import.meta.url);
  const cli = path.join(path.dirname(require.resolve("playwright-core/package.json")), "cli.js");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

export interface CliIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

const defaultIO: CliIO = {
  stdout: (s) => void process.stdout.write(s),
  stderr: (s) => void process.stderr.write(s),
};

/** Run the CLI. Returns the exit code. When `--preview` is used, resolves after the server stops. */
export async function main(argv: string[], io: CliIO = defaultIO): Promise<number> {
  if (argv[0] === "install-browser") return installBrowser();
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      width: { type: "string" },
      height: { type: "string" },
      fps: { type: "string" },
      duration: { type: "string", short: "d" },
      selector: { type: "string", short: "s" },
      report: { type: "boolean" },
      "report-json": { type: "string" },
      preview: { type: "boolean" },
      port: { type: "string" },
      "no-open": { type: "boolean" },
      "no-optimize": { type: "boolean" },
      background: { type: "boolean" },
      font: { type: "string", multiple: true },
      pretty: { type: "boolean" },
      "executable-path": { type: "string" },
      version: { type: "boolean", short: "v" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    io.stdout(HELP);
    return 0;
  }
  if (values.version) {
    io.stdout(`${VERSION}\n`);
    return 0;
  }
  const input = positionals[0];
  if (!input) {
    io.stderr(HELP);
    return 1;
  }
  const fonts: Record<string, string> = {};
  for (const f of values.font ?? []) {
    const eq = f.indexOf("=");
    if (eq < 1) throw new Error(`Invalid --font "${f}" (use Family=path/to/font.ttf)`);
    fonts[f.slice(0, eq)] = path.resolve(f.slice(eq + 1));
  }
  const isUrl = /^(https?|file):\/\//.test(input);
  const options = {
    ...(isUrl ? { url: input } : { file: input }),
    width: parseNumber("width", values.width),
    height: parseNumber("height", values.height),
    fps: parseNumber("fps", values.fps),
    duration: parseDuration(values.duration),
    selector: values.selector,
    optimizeKeyframes: !values["no-optimize"],
    background: values.background ?? false,
    fonts,
    executablePath: values["executable-path"],
  };
  if (!isUrl)
    await readFile(input).catch(() => {
      throw new Error(`Input file not found: ${input}`);
    });

  const started = Date.now();
  const { lottie, report } = await convertWithReport(options);
  const json = JSON.stringify(lottie, null, values.pretty ? 2 : undefined);
  const output =
    values.output ?? (isUrl ? "animation.json" : input.replace(/\.html?$/i, "") + ".json");
  if (output === "-") io.stdout(json + "\n");
  else {
    await writeFile(output, json);
    io.stderr(
      `✔ ${output} (${(json.length / 1024).toFixed(1)} KB, ${report.stats.layers} layers, ${report.stats.frames} frames) in ${Date.now() - started}ms\n`,
    );
  }
  if (values["report-json"])
    await writeFile(values["report-json"], JSON.stringify(report, null, 2));
  if (values.report) io.stderr(formatReport(report) + "\n");
  else if (report.issues.some((i) => i.severity === "unsupported")) {
    const n = report.issues.filter((i) => i.severity === "unsupported").length;
    io.stderr(`⚠ ${n} unsupported feature(s) ignored — run with --report for details\n`);
  }

  if (values.preview) {
    const server = await startPreviewServer({
      lottie,
      report,
      ...(isUrl ? { html: "" } : { file: input }),
      viewport: report.stats.viewport,
      startOffsetMs: report.stats.startOffsetMs,
      port: values.port ? Number(values.port) : undefined,
      open: !values["no-open"],
    });
    io.stderr(`Preview: ${server.url}  (Ctrl+C to stop)\n`);
    await new Promise<void>((resolve) => {
      const stop = () => void server.close().then(resolve);
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  }
  return 0;
}
