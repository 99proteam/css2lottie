import { afterAll, beforeAll } from "vitest";
import type { Browser } from "playwright-core";
import { launchBrowser } from "../../src/sampler/browser.js";

/** One shared Chromium per test file. */
export function useBrowser(): () => Browser {
  let browser: Browser | undefined;
  beforeAll(async () => {
    browser = await launchBrowser();
  });
  afterAll(async () => {
    await browser?.close();
  });
  return () => {
    if (!browser) throw new Error("browser not started");
    return browser;
  };
}
