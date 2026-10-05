import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import type { LottieAnimation } from "../lottie/types.js";
import type { ConversionReport } from "../report.js";
import { mimeFromUrl } from "../utils/resources.js";

export interface PreviewOptions {
  lottie: LottieAnimation;
  /** URL of the original HTML (rendered in an iframe) */
  sourceUrl: string;
  /** Viewport the source was rendered with */
  viewport: { width: number; height: number };
  /** Timeline offset (ms) of composition frame 0 in the source page */
  startOffsetMs?: number;
  /** URL of the lottie-web player script */
  lottieScriptUrl: string;
  /** URL the animation JSON is served from */
  animationUrl: string;
  report?: ConversionReport;
  title?: string;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/** Side-by-side comparison page: original HTML/CSS (left) vs the Lottie played by lottie-web (right). */
export function createPreviewHtml(opts: PreviewOptions): string {
  const { lottie, viewport } = opts;
  const title = escapeHtml(opts.title ?? lottie.nm ?? "css2lottie preview");
  const issues = opts.report?.issues ?? [];
  const issueList = issues.length
    ? `<ul>${issues
        .map(
          (i) =>
            `<li><span class="sev ${i.severity}">${i.severity}</span> <code>${escapeHtml(i.feature)}</code> on <code>${escapeHtml(i.selector)}</code>: ${escapeHtml(i.detail)}</li>`,
        )
        .join("")}</ul>`
    : "<p>No unsupported features found.</p>";
  const config = JSON.stringify({
    fps: lottie.fr,
    op: lottie.op,
    w: lottie.w,
    h: lottie.h,
    startOffset: opts.startOffsetMs ?? 0,
    animationUrl: opts.animationUrl,
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — css2lottie preview</title>
<style>
  :root { --bg: #f6f7f9; --panel: #fff; --text: #1d2330; --muted: #667085; --border: #e3e6ea; --accent: #5b5bd6; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111318; --panel: #1a1d24; --text: #e7e9ee; --muted: #98a2b3; --border: #2a2f39; --accent: #8b8bf0; } }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; background: var(--bg); color: var(--text); }
  header { padding: 16px 20px; display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
  header h1 { font-size: 18px; margin: 0; }
  header span { color: var(--muted); }
  main { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; padding: 0 20px; }
  .pane { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .pane h2 { margin: 0; font-size: 13px; font-weight: 600; padding: 10px 14px; border-bottom: 1px solid var(--border); color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .stage { display: grid; place-items: center; padding: 16px; min-height: 200px;
    background-image: linear-gradient(45deg, rgba(128,128,128,.08) 25%, transparent 25%, transparent 75%, rgba(128,128,128,.08) 75%), linear-gradient(45deg, rgba(128,128,128,.08) 25%, transparent 25%, transparent 75%, rgba(128,128,128,.08) 75%);
    background-size: 16px 16px; background-position: 0 0, 8px 8px; }
  .frame { position: relative; overflow: hidden; }
  iframe { border: 0; transform-origin: 0 0; position: absolute; left: 0; top: 0; background: transparent; }
  #lottie { width: 100%; height: 100%; }
  .controls { display: flex; gap: 10px; align-items: center; padding: 16px 20px; flex-wrap: wrap; }
  button { font: inherit; padding: 6px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel); color: var(--text); cursor: pointer; }
  button:hover { border-color: var(--accent); }
  input[type=range] { flex: 1; min-width: 160px; accent-color: var(--accent); }
  #frame { font-variant-numeric: tabular-nums; color: var(--muted); min-width: 110px; }
  section.report { margin: 0 20px 24px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 4px 16px; }
  section.report ul { padding-left: 18px; }
  .sev { font-size: 11px; text-transform: uppercase; font-weight: 600; padding: 1px 6px; border-radius: 4px; background: #fde68a; color: #713f12; }
  .sev.unsupported { background: #fecaca; color: #7f1d1d; }
  .sev.approximated { background: #bfdbfe; color: #1e3a8a; }
</style>
</head>
<body>
<header><h1>${title}</h1><span>${lottie.w}×${lottie.h} · ${lottie.fr} fps · ${lottie.op} frames · ${lottie.layers.length} layers</span></header>
<main>
  <div class="pane"><h2>HTML + CSS (original)</h2><div class="stage"><div class="frame" id="cssFrame"><iframe id="source" src="${escapeHtml(opts.sourceUrl)}" width="${viewport.width}" height="${viewport.height}" title="Original"></iframe></div></div></div>
  <div class="pane"><h2>Lottie (lottie-web)</h2><div class="stage"><div class="frame" id="lottieFrame"><div id="lottie"></div></div></div></div>
</main>
<div class="controls">
  <button id="play">Pause</button>
  <button id="restart">Restart both</button>
  <input id="scrub" type="range" min="0" max="${lottie.op}" step="1" value="0" aria-label="Frame">
  <span id="frame">frame 0 / ${lottie.op}</span>
</div>
<section class="report"><h3>Conversion report</h3>${issueList}</section>
<script src="${escapeHtml(opts.lottieScriptUrl)}"></script>
<script>
(function () {
  var cfg = ${config};
  var iframe = document.getElementById("source");
  var cssFrame = document.getElementById("cssFrame");
  var lottieFrame = document.getElementById("lottieFrame");
  var scale = Math.min(1, 480 / Math.max(cfg.w, cfg.h));
  var vw = ${viewport.width}, vh = ${viewport.height};
  var cssScale = Math.min(1, 480 / Math.max(vw, vh));
  cssFrame.style.width = vw * cssScale + "px"; cssFrame.style.height = vh * cssScale + "px";
  iframe.style.transform = "scale(" + cssScale + ")";
  lottieFrame.style.width = cfg.w * scale + "px"; lottieFrame.style.height = cfg.h * scale + "px";
  var anim = lottie.loadAnimation({ container: document.getElementById("lottie"), renderer: "svg", loop: true, autoplay: false, path: cfg.animationUrl });
  var playing = true;
  function cssAnims() { try { return iframe.contentDocument.getAnimations(); } catch (e) { return []; } }
  function seekCss(frame, play) {
    var t = cfg.startOffset + frame * 1000 / cfg.fps;
    cssAnims().forEach(function (a) { a.currentTime = t * a.playbackRate; if (play) a.play(); else a.pause(); });
  }
  function restart() { seekCss(0, true); anim.goToAndPlay(0, true); playing = true; document.getElementById("play").textContent = "Pause"; }
  var ready = 0;
  function onReady() { if (++ready === 2) restart(); }
  anim.addEventListener("DOMLoaded", onReady);
  iframe.addEventListener("load", function () { setTimeout(onReady, 50); });
  anim.addEventListener("loopComplete", function () { if (playing) seekCss(0, true); });
  anim.addEventListener("enterFrame", function () {
    var f = Math.round(anim.currentFrame);
    document.getElementById("scrub").value = f;
    document.getElementById("frame").textContent = "frame " + f + " / " + cfg.op;
  });
  document.getElementById("restart").onclick = restart;
  document.getElementById("play").onclick = function () {
    playing = !playing;
    if (playing) { anim.play(); cssAnims().forEach(function (a) { a.play(); }); }
    else { anim.pause(); cssAnims().forEach(function (a) { a.pause(); }); }
    this.textContent = playing ? "Pause" : "Play";
  };
  document.getElementById("scrub").oninput = function () {
    var f = Number(this.value);
    playing = false; document.getElementById("play").textContent = "Play";
    anim.goToAndStop(f, true); seekCss(f, false);
    document.getElementById("frame").textContent = "frame " + f + " / " + cfg.op;
  };
})();
</script>
</body>
</html>
`;
}

export interface PreviewServerOptions {
  lottie: LottieAnimation;
  report?: ConversionReport;
  /** Original source: an HTML file path or an HTML string */
  file?: string;
  html?: string;
  viewport: { width: number; height: number };
  startOffsetMs?: number;
  port?: number;
  /** Open the default browser (default true) */
  open?: boolean;
}

export interface PreviewServer {
  url: string;
  close(): Promise<void>;
}

function lottieWebPath(): string {
  const require = createRequire(import.meta.url);
  return require.resolve("lottie-web/build/player/lottie_svg.min.js");
}

export function openInBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* no browser available: the URL is printed anyway */
  }
}

/** Serve the comparison page on localhost (the original page needs http for same-origin scrubbing). */
export async function startPreviewServer(opts: PreviewServerOptions): Promise<PreviewServer> {
  const sourceDir = opts.file ? path.dirname(path.resolve(opts.file)) : null;
  const sourceName = opts.file ? path.basename(opts.file) : "index.html";
  const page = createPreviewHtml({
    lottie: opts.lottie,
    report: opts.report,
    sourceUrl: `/source/${encodeURIComponent(sourceName)}`,
    viewport: opts.viewport,
    startOffsetMs: opts.startOffsetMs,
    lottieScriptUrl: "/lottie.js",
    animationUrl: "/animation.json",
  });
  const json = JSON.stringify(opts.lottie);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, type: string, body: string | Buffer) => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    };
    try {
      if (url.pathname === "/") return send(200, "text/html; charset=utf-8", page);
      if (url.pathname === "/animation.json") return send(200, "application/json", json);
      if (url.pathname === "/lottie.js")
        return send(200, "text/javascript", await readFile(lottieWebPath()));
      if (url.pathname.startsWith("/source/")) {
        const rel = decodeURIComponent(url.pathname.slice("/source/".length));
        if (!sourceDir) {
          if (rel === "index.html") return send(200, "text/html; charset=utf-8", opts.html ?? "");
          return send(404, "text/plain", "not found");
        }
        const target = path.resolve(sourceDir, rel);
        if (!target.startsWith(sourceDir + path.sep) && target !== sourceDir)
          return send(403, "text/plain", "forbidden");
        const type = target.endsWith(".html")
          ? "text/html; charset=utf-8"
          : target.endsWith(".css")
            ? "text/css"
            : target.endsWith(".js")
              ? "text/javascript"
              : mimeFromUrl(target);
        return send(200, type, await readFile(target));
      }
      send(404, "text/plain", "not found");
    } catch {
      send(404, "text/plain", "not found");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/`;
  if (opts.open !== false) openInBrowser(url);
  return {
    url,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
