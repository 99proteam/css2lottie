/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Code that runs *inside* the page (Chromium) via `page.evaluate`.
 *
 * IMPORTANT: every exported function here is serialized with Function#toString(), so it must be
 * fully self-contained: no imports, no references to module-level values, no helpers injected
 * by a bundler. Shared state between calls lives on `window.__c2l`.
 */
import type {
  AnimationInfo,
  DiscoveryResult,
  FontFaceInfo,
  NodeInfo,
  NodeKind,
  NodeSample,
  SampleResult,
  StaticIssue,
  TextRun,
} from "./types.js";

export interface DiscoverInput {
  rootSelector: string | null;
  styleLists: Record<NodeKind, string[]>;
  settleFrames: number;
}

export interface SampleInput {
  /** Timeline times (ms) to seek to, in order */
  timelineTimes: number[];
  /** Measure text glyph positions on the first time of this batch */
  measureText: boolean;
  /** Cancel stray transitions after sampling (last batch) */
  cleanup: boolean;
}

export async function pageDiscover(input: DiscoverInput): Promise<DiscoveryResult> {
  const w = window as any;
  const issues: StaticIssue[] = [];

  // --- wait for the page to settle -------------------------------------------------------------
  try {
    await (document as any).fonts?.ready;
  } catch {
    /* ignore */
  }
  const imgs = Array.from(document.images);
  await Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
            setTimeout(resolve, 3000);
          }),
    ),
  );
  for (let i = 0; i < input.settleFrames; i++) {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }

  // --- helpers ---------------------------------------------------------------------------------
  const SVG_NS = "http://www.w3.org/2000/svg";
  const SKIP_TAGS = new Set([
    "script",
    "style",
    "template",
    "head",
    "meta",
    "link",
    "noscript",
    "title",
    "base",
  ]);
  const SVG_SHAPES = new Set(["rect", "circle", "ellipse", "path", "polygon", "polyline", "line"]);
  const SVG_IGNORE = new Set([
    "defs",
    "title",
    "desc",
    "metadata",
    "style",
    "linearGradient",
    "radialGradient",
    "clipPath",
    "mask",
    "pattern",
    "filter",
    "symbol",
    "marker",
  ]);

  const describe = (el: Element, pseudo?: string): string => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    const cls =
      typeof (el as any).className === "string"
        ? (el as any).className
        : ((el as any).className?.baseVal ?? "");
    const classes = String(cls).trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (classes.length) s += "." + classes.join(".");
    if (!el.id && !classes.length && el.parentElement) {
      const idx = Array.from(el.parentElement.children).indexOf(el) + 1;
      s += `:nth-child(${idx})`;
    }
    return pseudo ? s + pseudo : s;
  };

  const root: Element | null = input.rootSelector
    ? document.querySelector(input.rootSelector)
    : document.body;
  if (!root) throw new Error(`css2lottie: selector "${input.rootSelector}" matched no element`);
  const rootIsBody = root === document.body;

  const nodes: NodeInfo[] = [];
  const elements: Element[] = [];
  const nodeOf = new Map<Element, number>();

  const addNode = (el: Element, kind: NodeKind, parentId: number | null, pseudo?: string) => {
    const id = nodes.length;
    const info: NodeInfo = {
      id,
      parentId,
      kind,
      tag: el.tagName.toLowerCase(),
      selector: describe(el, pseudo),
      styleNames: input.styleLists[kind] ?? [],
    };
    if (pseudo) info.pseudo = pseudo;
    nodes.push(info);
    elements.push(el);
    if (!pseudo) nodeOf.set(el, id);
    return info;
  };

  const issue = (nodeId: number | null, selector: string, feature: string, detail: string) =>
    issues.push({ nodeId, selector, feature, detail });

  const inspectHtmlStyles = (info: NodeInfo, cs: CSSStyleDeclaration) => {
    const check = (prop: string, ok: (v: string) => boolean, feature: string) => {
      const v = cs.getPropertyValue(prop);
      if (v && !ok(v)) issue(info.id, info.selector, feature, `${prop}: ${v}`);
    };
    check("box-shadow", (v) => v === "none", "box-shadow");
    check("filter", (v) => v === "none", "filter");
    check("backdrop-filter", (v) => v === "none", "backdrop-filter");
    check("background-image", (v) => v === "none", "background-image (gradients/images)");
    check("clip-path", (v) => v === "none", "clip-path");
    check("mask-image", (v) => v === "none", "mask");
    check("mix-blend-mode", (v) => v === "normal", "mix-blend-mode");
    check("text-shadow", (v) => v === "none", "text-shadow");
    check("perspective", (v) => v === "none", "3D perspective");
    check("transform-style", (v) => v === "flat", "3D transform-style");
    check("outline-style", (v) => v === "none" || cs.outlineWidth === "0px", "outline");
    for (const side of ["top", "right", "bottom", "left"]) {
      const st = cs.getPropertyValue(`border-${side}-style`);
      const bw = parseFloat(cs.getPropertyValue(`border-${side}-width`)) || 0;
      if (bw > 0 && st !== "solid" && st !== "none" && st !== "hidden") {
        issue(info.id, info.selector, "border-style", `border-${side}-style: ${st} (drawn solid)`);
        break;
      }
    }
  };

  const inspectSvgStyles = (info: NodeInfo, cs: CSSStyleDeclaration) => {
    const check = (prop: string, ok: (v: string) => boolean, feature: string) => {
      const v = cs.getPropertyValue(prop);
      if (v && !ok(v)) issue(info.id, info.selector, feature, `${prop}: ${v}`);
    };
    check("fill", (v) => !v.startsWith("url("), "SVG gradient/pattern paint");
    check("stroke", (v) => !v.startsWith("url("), "SVG gradient/pattern paint");
    check("stroke-dasharray", (v) => v === "none", "stroke-dasharray");
    check("filter", (v) => v === "none", "filter");
    check("clip-path", (v) => v === "none", "clip-path");
    check("mask", (v) => v === "none", "mask");
    check("marker-start", (v) => v === "none", "SVG markers");
    check("marker-end", (v) => v === "none", "SVG markers");
    check("mix-blend-mode", (v) => v === "normal", "mix-blend-mode");
  };

  const hasPseudo = (el: Element, pseudo: string) => {
    const cs = getComputedStyle(el, pseudo);
    return cs.content !== "none" && cs.content !== "normal" && cs.display !== "none";
  };

  const walkSvg = (el: Element, parentId: number) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName;
      if (child.namespaceURI !== SVG_NS) continue;
      if (SVG_IGNORE.has(tag)) continue;
      const cs = getComputedStyle(child);
      if (cs.display === "none") continue;
      if (tag === "g" || tag === "a") {
        const info = addNode(child, "svg-group", parentId);
        inspectSvgStyles(info, cs);
        walkSvg(child, info.id);
      } else if (SVG_SHAPES.has(tag)) {
        const info = addNode(child, "svg-shape", parentId);
        info.svg = { viewBox: null, preserveAspectRatio: "" };
        if (tag === "polygon" || tag === "polyline") {
          info.svg.points = child.getAttribute("points") ?? "";
        } else if (tag === "line") {
          const n = (a: string) => (child as any)[a]?.baseVal?.value ?? 0;
          info.svg.line = [n("x1"), n("y1"), n("x2"), n("y2")];
        }
        inspectSvgStyles(info, cs);
      } else {
        issue(
          null,
          describe(child),
          `SVG <${tag}>`,
          `<${tag}> inside inline SVG is not supported yet and was skipped`,
        );
      }
    }
  };

  const walk = (el: Element, parentId: number | null, isRoot: boolean) => {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    const cs = getComputedStyle(el);
    if (cs.display === "none") return;
    let id = parentId;
    if (el.namespaceURI === SVG_NS && tag === "svg") {
      const info = addNode(el, "svg-root", parentId);
      const svg = el as SVGSVGElement;
      const vb = svg.viewBox?.baseVal;
      info.svg = {
        viewBox: vb && vb.width > 0 && vb.height > 0 ? [vb.x, vb.y, vb.width, vb.height] : null,
        preserveAspectRatio: el.getAttribute("preserveAspectRatio") ?? "xMidYMid meet",
      };
      inspectHtmlStyles(info, cs);
      walkSvg(el, info.id);
      return;
    }
    if (tag === "img") {
      const img = el as HTMLImageElement;
      const info = addNode(el, "img", parentId);
      info.img = {
        src: img.currentSrc || img.src,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      };
      inspectHtmlStyles(info, cs);
      return;
    }
    if (["canvas", "video", "iframe", "object", "embed", "audio"].includes(tag)) {
      issue(
        null,
        describe(el),
        `<${tag}>`,
        `<${tag}> elements cannot be converted and were skipped`,
      );
      return;
    }
    if (!(isRoot && rootIsBody)) {
      const info = addNode(el, "html", parentId);
      id = info.id;
      inspectHtmlStyles(info, cs);
    }
    if (id !== null && !(isRoot && rootIsBody) && hasPseudo(el, "::before")) {
      const p = addNode(el, "pseudo", id, "::before");
      inspectHtmlStyles(p, getComputedStyle(el, "::before"));
    }
    for (const child of Array.from(el.children)) walk(child, id, false);
    if (id !== null && !(isRoot && rootIsBody) && hasPseudo(el, "::after")) {
      const p = addNode(el, "pseudo", id, "::after");
      inspectHtmlStyles(p, getComputedStyle(el, "::after"));
    }
  };
  walk(root, null, true);

  // --- animations ------------------------------------------------------------------------------
  const allAnims = document.getAnimations();
  for (const a of allAnims) a.pause();
  const kebab = (s: string) =>
    s === "cssFloat" ? "float" : s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
  const animations: AnimationInfo[] = [];
  const tracked: Animation[] = [];
  allAnims.forEach((a) => {
    const effect = a.effect as KeyframeEffect | null;
    if (!effect || !(effect as any).getKeyframes) return;
    const target = effect.target as Element | null;
    const pseudo = (effect as any).pseudoElement as string | null;
    let nodeId: number | null = null;
    if (target) {
      nodeId = pseudo
        ? (() => {
            const host = nodeOf.get(target);
            if (host === undefined) return null;
            for (const n of nodes) {
              if (n.kind === "pseudo" && n.parentId === host && n.pseudo === pseudo) return n.id;
            }
            return null;
          })()
        : (nodeOf.get(target) ?? null);
    }
    const timing = effect.getTiming();
    const computed = effect.getComputedTiming();
    const kfs = effect.getKeyframes();
    const props = new Set<string>();
    for (const kf of kfs) {
      for (const k of Object.keys(kf)) {
        if (["offset", "computedOffset", "easing", "composite"].includes(k)) continue;
        props.add(kebab(k));
      }
    }
    const ctor = a.constructor?.name;
    const kind: AnimationInfo["kind"] =
      ctor === "CSSAnimation"
        ? "css-animation"
        : ctor === "CSSTransition"
          ? "css-transition"
          : "web-animation";
    const name =
      kind === "css-animation"
        ? (a as any).animationName
        : kind === "css-transition"
          ? (a as any).transitionProperty
          : a.id || "animation";
    const iterations = timing.iterations ?? 1;
    animations.push({
      id: animations.length,
      kind,
      name: String(name),
      nodeId,
      selector: target ? describe(target, pseudo ?? undefined) : "(no target)",
      delay: Number(timing.delay ?? 0),
      endDelay: Number(timing.endDelay ?? 0),
      duration: Number(computed.duration ?? 0),
      iterations: Number.isFinite(iterations) ? Number(iterations) : null,
      iterationStart: Number(timing.iterationStart ?? 0),
      direction: String(timing.direction ?? "normal"),
      fill: String(computed.fill ?? timing.fill ?? "auto"),
      easing: String(timing.easing ?? "linear"),
      playbackRate: a.playbackRate,
      keyframes: kfs.map((kf: any) => ({
        offset: Number(kf.computedOffset ?? kf.offset ?? 0),
        easing: String(kf.easing ?? "linear"),
      })),
      properties: Array.from(props),
    });
    tracked.push(a);
  });

  // --- @font-face sources (for text → outlines) ---------------------------------------------------
  const fontFaces: FontFaceInfo[] = [];
  const visitRules = (rules: CSSRuleList, base: string) => {
    for (const rule of Array.from(rules)) {
      if ((rule as any).type === 5 /* FONT_FACE_RULE */) {
        const st = (rule as CSSFontFaceRule).style;
        const src = st.getPropertyValue("src");
        const urls: string[] = [];
        const re = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) {
          try {
            urls.push(new URL(m[2]!, base).href);
          } catch {
            /* ignore */
          }
        }
        fontFaces.push({
          family: st.getPropertyValue("font-family").replace(/^['"]|['"]$/g, ""),
          weight: st.getPropertyValue("font-weight") || "400",
          style: st.getPropertyValue("font-style") || "normal",
          urls,
        });
      } else if ((rule as any).cssRules) {
        visitRules((rule as any).cssRules, base);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      visitRules(sheet.cssRules, sheet.href ?? document.baseURI);
    } catch {
      /* cross-origin stylesheet */
    }
  }

  // --- override animations used to neutralize transforms while measuring layout ----------------
  // Script animations sit above CSS animations in the composite order, so a paused `fill: both`
  // animation setting transform: none hides CSS transforms without touching the base style (which
  // would start transitions).
  const overrides: Array<{ anim: Animation; effect: AnimationEffect }> = [];
  const neutral = { transform: "none", translate: "none", rotate: "none", scale: "none" };
  const overrideTargets = new Set<Element>();
  nodes.forEach((n, idx) => {
    if (n.kind === "html" || n.kind === "img" || n.kind === "svg-root") {
      overrideTargets.add(elements[idx]!);
    }
  });
  for (let p = root.parentElement; p; p = p.parentElement) overrideTargets.add(p);
  overrideTargets.add(root);
  for (const el of overrideTargets) {
    const anim = el.animate([neutral, neutral], { duration: 1e9, fill: "both" });
    anim.pause();
    anim.currentTime = 0;
    overrides.push({ anim, effect: anim.effect! });
    anim.effect = null;
  }
  const TRANSFORM_PROPS = new Set(["transform", "translate", "rotate", "scale", "perspective"]);
  const transformAnims = tracked.filter((a, i) =>
    animations[i]!.properties.some((p) => TRANSFORM_PROPS.has(p)),
  );

  const rb = root.getBoundingClientRect();
  w.__c2l = {
    nodes,
    elements,
    allAnims,
    tracked,
    overrides,
    transformAnims,
    root,
    rootIsBody,
  };

  return {
    nodes,
    animations,
    fontFaces,
    issues,
    rootBox: rootIsBody ? [0, 0, innerWidth, innerHeight] : [rb.x, rb.y, rb.width, rb.height],
    rootIsBody,
  };
}

export function pageSample(input: SampleInput): Omit<SampleResult, "times"> {
  const w = window as any;
  const st = w.__c2l;
  if (!st) throw new Error("css2lottie: pageDiscover must run before pageSample");
  const nodes: NodeInfo[] = st.nodes;
  const elements: Element[] = st.elements;
  const issues: StaticIssue[] = [];
  const colorProps = new Set([
    "background-color",
    "color",
    "fill",
    "stroke",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
  ]);
  const colorCache = new Map<string, string>();
  let ctx: CanvasRenderingContext2D | null = null;
  const normalizeColor = (v: string): string => {
    if (!v || v === "none" || v.startsWith("rgb") || v.startsWith("url(") || v === "transparent") {
      return v;
    }
    const cached = colorCache.get(v);
    if (cached) return cached;
    if (!ctx) {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      ctx = c.getContext("2d", { willReadFrequently: true });
    }
    let out = v;
    if (ctx) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      out = `rgba(${d[0]}, ${d[1]}, ${d[2]}, ${(d[3]! / 255).toFixed(4)})`;
    }
    colorCache.set(v, out);
    return out;
  };

  const angleToDeg = (tok: string): number => {
    const n = parseFloat(tok);
    if (tok.endsWith("rad")) return (n * 180) / Math.PI;
    if (tok.endsWith("turn")) return n * 360;
    if (tok.endsWith("grad")) return n * 0.9;
    return n;
  };
  const lengthOf = (tok: string | undefined, basis: number): number => {
    if (!tok) return 0;
    if (tok.endsWith("%")) return (parseFloat(tok) / 100) * basis;
    return parseFloat(tok) || 0;
  };

  /** Compose translate · rotate · scale · transform. Percent translate resolves against refBox. */
  const composeMatrix = (cs: CSSStyleDeclaration, refW: number, refH: number) => {
    let m = new DOMMatrix();
    const tr = cs.translate;
    if (tr && tr !== "none") {
      const p = tr.split(/\s+/);
      m = m.translate(lengthOf(p[0], refW), lengthOf(p[1], refH), lengthOf(p[2], 0));
    }
    const ro = cs.rotate;
    if (ro && ro !== "none") {
      const p = ro.split(/\s+/);
      const angle = angleToDeg(p[p.length - 1]!);
      if (p.length === 1 || p[0] === "z") m = m.rotate(0, 0, angle);
      else if (p[0] === "x") m = m.rotateAxisAngle(1, 0, 0, angle);
      else if (p[0] === "y") m = m.rotateAxisAngle(0, 1, 0, angle);
      else m = m.rotateAxisAngle(Number(p[0]), Number(p[1]), Number(p[2]), angle);
    }
    const sc = cs.scale;
    if (sc && sc !== "none") {
      const p = sc.split(/\s+/).map((s) => (s.endsWith("%") ? parseFloat(s) / 100 : Number(s)));
      m = m.scale(p[0]!, p[1] ?? p[0]!, p[2] ?? 1);
    }
    if (cs.transform && cs.transform !== "none") m = m.multiply(new DOMMatrix(cs.transform));
    return m;
  };

  const viewBoxOrigin = (el: Element): [number, number] => {
    const svg = (el as SVGGraphicsElement).ownerSVGElement;
    const vb = svg?.viewBox?.baseVal;
    return vb && vb.width > 0 ? [vb.x, vb.y] : [0, 0];
  };

  const readStyles = (cs: CSSStyleDeclaration, names: string[]) =>
    names.map((n) => {
      const v = cs.getPropertyValue(n);
      return colorProps.has(n) ? normalizeColor(v) : v;
    });

  const measureText = (el: Element, box: DOMRect): TextRun[] => {
    const runs: TextRun[] = [];
    const cs = getComputedStyle(el);
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType !== Node.TEXT_NODE) continue;
      const text = child.textContent ?? "";
      if (!text.trim()) continue;
      const run: TextRun = {
        chars: [],
        fontFamily: cs.fontFamily,
        fontSize: parseFloat(cs.fontSize) || 16,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        textTransform: cs.textTransform,
      };
      const range = document.createRange();
      let i = 0;
      while (i < text.length) {
        const cp = text.codePointAt(i)!;
        const len = cp > 0xffff ? 2 : 1;
        const ch = text.slice(i, i + len);
        if (ch.trim()) {
          range.setStart(child, i);
          range.setEnd(child, i + len);
          const r = range.getClientRects()[0];
          if (r && r.width > 0) {
            run.chars.push({ ch, x: r.x - box.x, y: r.y - box.y, w: r.width, h: r.height });
          }
        }
        i += len;
      }
      if (run.chars.length) runs.push(run);
    }
    return runs;
  };

  const samples: NodeSample[][] = [];
  const text: Record<number, TextRun[]> = {};
  const known = new Set<Animation>(st.allAnims as Animation[]);

  input.timelineTimes.forEach((t, ti) => {
    for (const a of st.allAnims as Animation[]) a.currentTime = t * a.playbackRate;
    const frame: NodeSample[] = [];

    // Pass 1: styles, transforms, SVG geometry (needs real transforms applied).
    nodes.forEach((n, idx) => {
      const el = elements[idx]!;
      const cs = n.pseudo ? getComputedStyle(el, n.pseudo) : getComputedStyle(el);
      frame.push({
        s: readStyles(cs, n.styleNames),
        m: [1, 0, 0, 1, 0, 0],
        o: [0, 0],
        b: null,
      });
    });

    // Pass 2: neutralize transforms and read untransformed layout boxes.
    const savedEffects: Array<[Animation, AnimationEffect | null]> = [];
    for (const a of st.transformAnims as Animation[]) {
      savedEffects.push([a, a.effect]);
      a.effect = null;
    }
    for (const o of st.overrides) o.anim.effect = o.effect;
    nodes.forEach((n, idx) => {
      const el = elements[idx]!;
      if (n.kind === "html" || n.kind === "img" || n.kind === "svg-root") {
        const r = el.getBoundingClientRect();
        frame[idx]!.b = [r.x, r.y, r.width, r.height];
        if (ti === 0 && input.measureText && n.kind === "html") {
          const runs = measureText(el, r);
          if (runs.length) text[n.id] = runs;
        }
      }
    });
    for (const o of st.overrides) o.anim.effect = null;
    for (const [a, eff] of savedEffects) a.effect = eff;

    // Pass 3: transforms (needs boxes for percentage resolution).
    nodes.forEach((n, idx) => {
      const el = elements[idx]!;
      const cs = n.pseudo ? getComputedStyle(el, n.pseudo) : getComputedStyle(el);
      const sample = frame[idx]!;
      let refX = 0;
      let refY = 0;
      let refW = 0;
      let refH = 0;
      if (n.kind === "pseudo") {
        const hostCs = getComputedStyle(el);
        const pos = cs.position;
        const bw = parseFloat(cs.width) || 0;
        const bh = parseFloat(cs.height) || 0;
        const extraW =
          cs.boxSizing === "border-box"
            ? 0
            : (parseFloat(cs.paddingLeft) || 0) +
              (parseFloat(cs.paddingRight) || 0) +
              (parseFloat(cs.borderLeftWidth) || 0) +
              (parseFloat(cs.borderRightWidth) || 0);
        const extraH =
          cs.boxSizing === "border-box"
            ? 0
            : (parseFloat(cs.paddingTop) || 0) +
              (parseFloat(cs.paddingBottom) || 0) +
              (parseFloat(cs.borderTopWidth) || 0) +
              (parseFloat(cs.borderBottomWidth) || 0);
        refW = bw + extraW;
        refH = bh + extraH;
        if ((pos === "absolute" || pos === "fixed") && hostCs.position !== "static") {
          const x =
            (parseFloat(hostCs.borderLeftWidth) || 0) +
            (parseFloat(cs.left) || 0) +
            (parseFloat(cs.marginLeft) || 0);
          const y =
            (parseFloat(hostCs.borderTopWidth) || 0) +
            (parseFloat(cs.top) || 0) +
            (parseFloat(cs.marginTop) || 0);
          sample.b = [x, y, refW, refH];
        } else {
          sample.b = [0, 0, refW, refH];
          if (ti === 0 && input.measureText) {
            issues.push({
              nodeId: n.id,
              selector: n.selector,
              feature: "in-flow pseudo-element",
              detail:
                "only absolutely positioned ::before/::after inside a positioned host can be placed accurately; placed at the host's top-left",
            });
          }
        }
      } else if (n.kind === "svg-shape" || n.kind === "svg-group") {
        const box = cs.transformBox;
        if (
          box === "fill-box" ||
          box === "content-box" ||
          box === "stroke-box" ||
          box === "border-box"
        ) {
          try {
            const bb = (el as SVGGraphicsElement).getBBox();
            refX = bb.x;
            refY = bb.y;
            refW = bb.width;
            refH = bb.height;
          } catch {
            /* not rendered */
          }
        } else {
          const svg = (el as SVGGraphicsElement).ownerSVGElement;
          const vb = svg?.viewBox?.baseVal;
          [refX, refY] = viewBoxOrigin(el);
          refW = vb && vb.width > 0 ? vb.width : (svg?.clientWidth ?? 0);
          refH = vb && vb.height > 0 ? vb.height : (svg?.clientHeight ?? 0);
        }
      } else if (sample.b) {
        refW = sample.b[2];
        refH = sample.b[3];
      }
      const m = composeMatrix(cs, refW, refH);
      sample.m = [m.a, m.b, m.c, m.d, m.e, m.f];
      if (!m.is2D) sample.d3 = true;
      const origin = cs.transformOrigin.split(/\s+/);
      sample.o = [refX + lengthOf(origin[0], refW), refY + lengthOf(origin[1], refH)];
    });

    samples.push(frame);
  });

  // Cancel any transition accidentally started while measuring.
  for (const a of input.cleanup ? document.getAnimations() : []) {
    if (!known.has(a) && !(st.overrides as Array<{ anim: Animation }>).some((o) => o.anim === a)) {
      a.cancel();
    }
  }
  return { samples, text, issues };
}
