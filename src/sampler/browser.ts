import { chromium, type Browser } from "playwright-core";

export class BrowserNotFoundError extends Error {
  constructor(cause: unknown) {
    super(
      "css2lottie could not launch Chromium.\n" +
        "Install a browser once with:\n\n" +
        "  npx css2lottie install-browser\n\n" +
        "or point to an existing Chromium/Chrome with --executable-path / the\n" +
        "CSS2LOTTIE_CHROMIUM_PATH environment variable.\n\n" +
        `Original error: ${(cause as Error)?.message ?? String(cause)}`,
    );
    this.name = "BrowserNotFoundError";
  }
}

/** Launch headless Chromium, trying an explicit path, the Playwright cache, then installed Chrome. */
export async function launchBrowser(executablePath?: string): Promise<Browser> {
  const explicit = executablePath ?? process.env.CSS2LOTTIE_CHROMIUM_PATH;
  const attempts: Array<() => Promise<Browser>> = explicit
    ? [() => chromium.launch({ executablePath: explicit })]
    : [() => chromium.launch(), () => chromium.launch({ channel: "chrome" })];
  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (e) {
      lastError = e;
    }
  }
  throw new BrowserNotFoundError(lastError);
}
