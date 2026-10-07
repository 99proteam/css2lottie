// Builds the demo website (GitHub Pages) into site-dist/.
// Every example is converted with the built package, so the site always shows the current output.
// Usage: npm run build && npm run site          (build)
//        npm run build && npm run site:serve    (build, then serve on http://127.0.0.1:4173/)
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { VERSION, convertWithReport, launchBrowser } from "../dist/index.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const siteDir = path.join(root, "site");
const examplesDir = path.join(root, "examples");
const outDir = path.join(root, "site-dist");
const siteUrl = (process.env.SITE_URL ?? "https://99proteam.github.io/css2lottie/").replace(
  /\/?$/,
  "/",
);
const repoUrl = "https://github.com/99proteam/css2lottie";
const serve = process.argv.includes("--serve");

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const formatBytes = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

await rm(outDir, { recursive: true, force: true });
await mkdir(path.join(outDir, "examples", "out"), { recursive: true });
await mkdir(path.join(outDir, "vendor"), { recursive: true });

// Static files, example sources, fonts, the lottie-web player and the README animation.
for (const entry of await readdir(siteDir)) {
  if (entry !== "index.html") await cp(path.join(siteDir, entry), path.join(outDir, entry));
}
await cp(path.join(examplesDir, "fonts"), path.join(outDir, "examples", "fonts"), {
  recursive: true,
});
const require = createRequire(import.meta.url);
await cp(
  require.resolve("lottie-web/build/player/lottie_svg.min.js"),
  path.join(outDir, "vendor", "lottie_svg.min.js"),
);
await cp(path.join(root, "docs", "side-by-side.gif"), path.join(outDir, "side-by-side.gif"));

const list = JSON.parse(await readFile(path.join(examplesDir, "examples.json"), "utf8"));
const cards = [];
const browser = await launchBrowser();
try {
  for (const ex of list) {
    const file = path.join(examplesDir, `${ex.name}.html`);
    const source = await readFile(file, "utf8");
    await writeFile(path.join(outDir, "examples", `${ex.name}.html`), source);
    const title = /<title>([^<]*)<\/title>/i.exec(source)?.[1]?.trim() ?? ex.name;
    const { lottie, report } = await convertWithReport({
      file,
      width: ex.width,
      height: ex.height,
      browser,
    });
    const json = JSON.stringify(lottie);
    await writeFile(path.join(outDir, "examples", "out", `${ex.name}.json`), json);
    cards.push(renderCard(ex, title, report, Buffer.byteLength(json)));
    console.log(`converted ${ex.name}`);
  }
} finally {
  await browser.close();
}

function renderCard(ex, title, report, bytes) {
  const s = report.stats;
  const issues = report.issues.length
    ? `<details class="report"><summary>${report.issues.length} report note${report.issues.length === 1 ? "" : "s"}</summary><ul>${report.issues
        .map(
          (i) =>
            `<li><span class="sev ${escapeHtml(i.severity)}">${escapeHtml(i.severity)}</span> <code>${escapeHtml(i.feature)}</code>: ${escapeHtml(i.detail)}</li>`,
        )
        .join("")}</ul></details>`
    : `<p class="report ok">Nothing dropped or approximated</p>`;
  const eased =
    s.easedIntervals + s.sampledIntervals
      ? ` · ${Math.round((100 * s.easedIntervals) / (s.easedIntervals + s.sampledIntervals))}% bezier-eased`
      : "";
  return `<article class="demo" id="${ex.name}" data-name="${ex.name}" data-w="${s.width}" data-h="${s.height}" data-vw="${s.viewport.width}" data-vh="${s.viewport.height}" data-fps="${s.fps}" data-op="${s.frames}" data-start="${s.startOffsetMs}">
  <header><h3>${escapeHtml(title)}</h3><span class="meta">${s.width}×${s.height} · ${s.frames} frames · ${s.layers} layer${s.layers === 1 ? "" : "s"} · ${formatBytes(bytes)}${eased}</span></header>
  <div class="panes">
    <figure><figcaption>HTML + CSS</figcaption><div class="stage"><div class="frame css-frame"><iframe title="${escapeHtml(title)}: CSS original" width="${s.viewport.width}" height="${s.viewport.height}" tabindex="-1"></iframe></div></div></figure>
    <figure><figcaption>Lottie</figcaption><div class="stage"><div class="frame lottie-frame" role="img" aria-label="${escapeHtml(title)}: Lottie animation"></div></div></figure>
  </div>
  <div class="controls"><button type="button" class="play">Play</button><input type="range" class="scrub" min="0" max="${s.frames}" step="1" value="0" aria-label="${escapeHtml(title)} frame"><span class="frame-no">0 / ${s.frames}</span></div>
  <footer><a class="btn small" href="examples/out/${ex.name}.json" download="${ex.name}.json">Download Lottie JSON</a><a href="examples/${ex.name}.html" target="_blank" rel="noopener">Open HTML</a><a href="${repoUrl}/blob/HEAD/examples/${ex.name}.html" target="_blank" rel="noopener">Source</a></footer>
  ${issues}
</article>`;
}

const today = new Date().toISOString().slice(0, 10);
const index = (await readFile(path.join(siteDir, "index.html"), "utf8"))
  .replace("<!-- GALLERY -->", cards.join("\n"))
  .replaceAll("__SITE_URL__", siteUrl)
  .replaceAll("__VERSION__", VERSION)
  .replaceAll("__EXAMPLE_COUNT__", String(list.length));
await writeFile(path.join(outDir, "index.html"), index);
await writeFile(
  path.join(outDir, "robots.txt"),
  `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}sitemap.xml\n`,
);
await writeFile(
  path.join(outDir, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${siteUrl}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>
`,
);
// GitHub Pages: serve files as-is (no Jekyll processing).
await writeFile(path.join(outDir, ".nojekyll"), "");
console.log(`\nsite built in ${path.relative(root, outDir)}/ (${list.length} examples)`);

if (serve) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".gif": "image/gif",
    ".png": "image/png",
    ".ttf": "font/ttf",
    ".xml": "application/xml",
    ".txt": "text/plain; charset=utf-8",
  };
  const port = Number(process.env.PORT ?? 4173);
  http
    .createServer(async (req, res) => {
      const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
      let target = path.resolve(outDir, "." + pathname);
      if (!target.startsWith(outDir)) return res.writeHead(403).end("forbidden");
      try {
        if ((await stat(target)).isDirectory()) target = path.join(target, "index.html");
        const body = await readFile(target);
        res.writeHead(200, {
          "content-type": types[path.extname(target)] ?? "application/octet-stream",
        });
        res.end(body);
      } catch {
        res.writeHead(404).end("not found");
      }
    })
    .listen(port, "127.0.0.1", () => console.log(`serving http://127.0.0.1:${port}/`));
}
