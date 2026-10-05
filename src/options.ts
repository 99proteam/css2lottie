import type { Browser } from "playwright-core";

export interface ConvertOptions {
  /** HTML document as a string. One of `html` / `file` / `url` is required. */
  html?: string;
  /** Path to an HTML file (relative assets such as images and fonts resolve next to it). */
  file?: string;
  /** URL to load (file://, http://localhost, ...). */
  url?: string;
  /** Base URL used to resolve relative URLs when converting an `html` string. */
  baseUrl?: string;
  /** Composition width in px. Defaults to the root element's width (with `selector`) or 512. */
  width?: number;
  /** Composition height in px. Defaults to the root element's height (with `selector`) or 512. */
  height?: number;
  /** Frames per second. Default 60. */
  fps?: number;
  /** Duration in ms. Default: auto-detected from the longest animation (one loop for infinite ones). */
  duration?: number;
  /** CSS selector of the single root element to convert. Default: everything in <body>. */
  selector?: string;
  /** Composition name (`nm`). */
  name?: string;
  /** Emit easing-optimized keyframes (default true). Set false to keep per-frame (simplified) keys. */
  optimizeKeyframes?: boolean;
  /** Font files to use for text outlines: `{ "Inter": "./Inter-Bold.ttf" }` (family → path/buffer). */
  fonts?: Record<string, string | Uint8Array>;
  /** Include the <body>/<html> background color as a full-size background layer. Default false. */
  background?: boolean;
  /** Use an existing Playwright browser (faster for batch conversions). */
  browser?: Browser;
  /** Path to a Chromium executable. Also read from CSS2LOTTIE_CHROMIUM_PATH. */
  executablePath?: string;
  /** Number of animation frames to wait after load before sampling (lets on-load JS start transitions). Default 2. */
  settleFrames?: number;
  /** Max auto-detected duration in ms when looping animations have unrelated periods. Default 30000. */
  maxDuration?: number;
}

export interface ResolvedOptions {
  width: number;
  height: number;
  fps: number;
  duration: number | undefined;
  selector: string | null;
  name: string;
  optimizeKeyframes: boolean;
  fonts: Record<string, string | Uint8Array>;
  background: boolean;
  /** Directory used to resolve relative font paths */
  baseDir: string;
}
