export type IssueSeverity = "unsupported" | "approximated" | "warning";

export interface ReportIssue {
  severity: IssueSeverity;
  /** Feature name, e.g. "box-shadow" or "animated property filter" */
  feature: string;
  /** Element the issue was found on */
  selector: string;
  detail: string;
}

export interface ConversionStats {
  fps: number;
  frames: number;
  durationMs: number;
  loop: boolean;
  /** Source timeline time (ms) of frame 0 (non-zero when a loop is taken from the steady state) */
  startOffsetMs: number;
  /** Viewport the page was rendered with */
  viewport: { width: number; height: number };
  width: number;
  height: number;
  layers: number;
  animations: number;
  keyframes: number;
  /** Intervals reproduced with CSS timing-function bezier easing */
  easedIntervals: number;
  /** Intervals that needed per-frame sampling */
  sampledIntervals: number;
}

export interface ConversionReport {
  issues: ReportIssue[];
  notes: string[];
  stats: ConversionStats;
}

/** Collects issues, de-duplicating identical (feature, selector, detail) entries. */
export class Reporter {
  readonly issues: ReportIssue[] = [];
  readonly notes: string[] = [];
  private seen = new Set<string>();

  add(severity: IssueSeverity, feature: string, selector: string, detail: string): void {
    const key = `${severity}|${feature}|${selector}|${detail}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.issues.push({ severity, feature, selector, detail });
  }

  unsupported(feature: string, selector: string, detail: string): void {
    this.add("unsupported", feature, selector, detail);
  }

  approximated(feature: string, selector: string, detail: string): void {
    this.add("approximated", feature, selector, detail);
  }

  warn(feature: string, selector: string, detail: string): void {
    this.add("warning", feature, selector, detail);
  }

  note(text: string): void {
    if (!this.notes.includes(text)) this.notes.push(text);
  }
}

/** Human-readable multi-line report (used by the CLI `--report` flag). */
export function formatReport(report: ConversionReport): string {
  const s = report.stats;
  const lines: string[] = [];
  lines.push(
    `css2lottie: ${s.width}x${s.height} @ ${s.fps}fps, ${s.frames} frames (${Math.round(s.durationMs)}ms)${s.loop ? ", looping" : ""}`,
  );
  lines.push(
    `  ${s.layers} layers, ${s.animations} source animations, ${s.keyframes} keyframes ` +
      `(${s.easedIntervals} eased intervals, ${s.sampledIntervals} per-frame intervals)`,
  );
  for (const n of report.notes) lines.push(`  note: ${n}`);
  if (!report.issues.length) {
    lines.push("  No unsupported features found.");
    return lines.join("\n");
  }
  const groups: Array<[string, ReportIssue[]]> = [
    ["Unsupported (ignored)", report.issues.filter((i) => i.severity === "unsupported")],
    ["Approximated", report.issues.filter((i) => i.severity === "approximated")],
    ["Warnings", report.issues.filter((i) => i.severity === "warning")],
  ];
  for (const [title, list] of groups) {
    if (!list.length) continue;
    lines.push(`  ${title}:`);
    for (const i of list) lines.push(`    - [${i.feature}] ${i.selector}: ${i.detail}`);
  }
  return lines.join("\n");
}
