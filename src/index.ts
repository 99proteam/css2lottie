export { convert, convertWithReport, type ConvertResult } from "./convert.js";
export type { ConvertOptions } from "./options.js";
export {
  formatReport,
  type ConversionReport,
  type ReportIssue,
  type ConversionStats,
} from "./report.js";
export { createPreviewHtml, startPreviewServer, type PreviewOptions } from "./preview/preview.js";
export { launchBrowser, BrowserNotFoundError } from "./sampler/browser.js";
export type * from "./lottie/types.js";
export { VERSION } from "./version.js";

// Building blocks (useful for custom converters and tests)
export { parseCssColor } from "./utils/color.js";
export { pathDataToShapes } from "./converters/path-data.js";
export { parseEasing, evaluateBezier } from "./easing/cubic-bezier.js";
export { converters } from "./converters/index.js";
export type { NodeConverter, NodeContext } from "./converters/types.js";
