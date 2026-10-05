import type { NodeConverter } from "./types.js";
import { loadResource, toDataUrl } from "../utils/resources.js";

/** <img> → embedded base64 image asset + image layer. */
export const imageConverter: NodeConverter = {
  name: "image",
  kinds: ["img"],
  styles: [],
  animatable: [],
  async convert(ctx) {
    const src = ctx.node.img?.src;
    if (!src) return;
    const [, , w, h] = ctx.localBox[0]!;
    if (ctx.localBox.some((b) => Math.abs(b[2] - w) > 0.5 || Math.abs(b[3] - h) > 0.5)) {
      ctx.report.approximated(
        "image size",
        ctx.node.selector,
        "animated <img> width/height is not supported; using the first frame size",
      );
    }
    try {
      const res = await loadResource(src);
      if (res.mime === "image/svg+xml") {
        ctx.report.warn(
          "SVG image",
          ctx.node.selector,
          "SVG images inside <img> only render in lottie-web; inline the SVG for native players",
        );
      }
      const id = `image_${ctx.node.id}`;
      ctx.addAsset({
        id,
        w: Math.round(w),
        h: Math.round(h),
        u: "",
        p: toDataUrl(res),
        e: 1,
        nm: ctx.node.selector,
      });
      ctx.layer.kind = "image";
      ctx.layer.refId = id;
    } catch (e) {
      ctx.report.unsupported(
        "image",
        ctx.node.selector,
        `could not load ${src.slice(0, 80)}: ${(e as Error).message}`,
      );
    }
  },
};
