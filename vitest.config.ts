import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Browser-backed tests share one Chromium per file; keep files parallel but bounded.
    maxWorkers: 4,
  },
});
