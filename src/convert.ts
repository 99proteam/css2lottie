import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLottie } from "./builder.js";
import { converters, styleListsFor } from "./converters/index.js";
import type { LottieAnimation } from "./lottie/types.js";
import type { ConvertOptions, ResolvedOptions } from "./options.js";
import type { ConversionReport } from "./report.js";
import { openPage } from "./sampler/sampler.js";
import { animationSegments, computeTimeline, sampleTimes } from "./timeline.js";
import { VERSION } from "./version.js";

export interface ConvertResult {
  lottie: LottieAnimation;
  report: ConversionReport;
}

const DEFAULT_SIZE = 512;

function baseDirOf(options: ConvertOptions): string {
  if (options.file) return path.dirname(path.resolve(options.file));
  const base = options.baseUrl ?? options.url;
  if (base?.startsWith("file:")) return path.dirname(fileURLToPath(base));
  return process.cwd();
}

/**
 * Convert HTML/CSS animations to Lottie and return both the animation and a report of
 * unsupported / approximated features.
 */
export async function convertWithReport(options: ConvertOptions): Promise<ConvertResult> {
  const fps = options.fps ?? 60;
  if (!(fps > 0 && fps <= 240)) throw new Error(`css2lottie: invalid fps ${fps}`);
  if (options.width !== undefined && !(options.width > 0))
    throw new Error("css2lottie: width must be > 0");
  if (options.height !== undefined && !(options.height > 0))
    throw new Error("css2lottie: height must be > 0");

  const selector = options.selector ?? null;
  // Viewport: the composition size, or a roomy default when the size comes from a root element.
  const viewport = {
    width: options.width ?? (selector ? 1280 : DEFAULT_SIZE),
    height: options.height ?? (selector ? 800 : DEFAULT_SIZE),
  };
  const session = await openPage(
    { html: options.html, file: options.file, url: options.url, baseUrl: options.baseUrl },
    viewport,
    {
      rootSelector: selector,
      styleLists: styleListsFor(converters),
      settleFrames: options.settleFrames ?? 2,
    },
    { browser: options.browser, executablePath: options.executablePath },
  );
  try {
    const { discovery } = session;
    const timeline = computeTimeline(discovery.animations, {
      fps,
      duration: options.duration,
      maxDuration: options.maxDuration,
    });
    const segments = discovery.animations.flatMap((a) => animationSegments(a, timeline));
    const times = sampleTimes(timeline, segments);
    const sampled = await session.sample(times, timeline.startOffset);

    const rootBox = !discovery.rootIsBody
      ? (sampled.samples[0]?.[0]?.b ?? discovery.rootBox)
      : null;
    const resolved: ResolvedOptions = {
      width: options.width ?? (rootBox ? Math.ceil(rootBox[2]) : DEFAULT_SIZE),
      height: options.height ?? (rootBox ? Math.ceil(rootBox[3]) : DEFAULT_SIZE),
      fps,
      duration: options.duration,
      selector,
      name:
        options.name ??
        (options.file ? path.basename(options.file, path.extname(options.file)) : "css2lottie"),
      optimizeKeyframes: options.optimizeKeyframes ?? true,
      fonts: options.fonts ?? {},
      background: options.background ?? false,
      baseDir: baseDirOf(options),
    };
    return await buildLottie({
      discovery,
      sampled,
      timeline,
      options: resolved,
      pageBackground: session.pageBackground,
      version: VERSION,
      viewport,
    });
  } finally {
    await session.close();
  }
}

/**
 * Convert HTML/CSS animations to a Lottie (Bodymovin) JSON object.
 *
 * @example
 * const lottie = await convert({ html, width: 400, height: 400, fps: 60 });
 */
export async function convert(options: ConvertOptions): Promise<LottieAnimation> {
  return (await convertWithReport(options)).lottie;
}
