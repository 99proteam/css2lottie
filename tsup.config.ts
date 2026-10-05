import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    shims: true,
    target: "node18",
    // The in-page sampler is serialized with Function#toString(); keep it free
    // of helper injection (no minify, no keepNames).
    minify: false,
    keepNames: false,
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    sourcemap: true,
    target: "node18",
    minify: false,
    keepNames: false,
    banner: { js: "#!/usr/bin/env node" },
  },
]);
