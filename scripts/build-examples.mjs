// Converts every example in examples/ to examples/out/<name>.json using the built package.
// Usage: npm run build && npm run examples
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convertWithReport, formatReport, launchBrowser } from "../dist/index.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const examplesDir = path.join(root, "examples");
const outDir = path.join(examplesDir, "out");
const list = JSON.parse(await readFile(path.join(examplesDir, "examples.json"), "utf8"));
await mkdir(outDir, { recursive: true });

const browser = await launchBrowser();
try {
  for (const ex of list) {
    const file = path.join(examplesDir, `${ex.name}.html`);
    const { lottie, report } = await convertWithReport({
      file,
      width: ex.width,
      height: ex.height,
      browser,
    });
    await writeFile(path.join(outDir, `${ex.name}.json`), JSON.stringify(lottie));
    console.log(`\n${ex.name}.json\n${formatReport(report)}`);
  }
} finally {
  await browser.close();
}
