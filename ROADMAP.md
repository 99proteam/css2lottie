# Roadmap

v1 covers transforms, opacity, colors, borders, border-radius, sizes, inline SVG shapes, images, text outlines and nesting (see the README). These are planned next, roughly in priority order. Comments and PRs are welcome on any item.

## Next

- [ ] **Linear and radial gradients.** CSS `linear-gradient()` / `radial-gradient()` backgrounds and SVG `<linearGradient>` / `<radialGradient>` paints become Lottie gradient fills and strokes (`gf` / `gs`), including animated stops.
- [ ] **Path drawing.** `stroke-dasharray` / `stroke-dashoffset` (the classic "draw the checkmark" effect) maps to Lottie trim paths, or to stroke dashes when the dashes are static.
- [ ] **Clip-path and masks.** `clip-path` (basic shapes and `path()`), `overflow: hidden` and SVG `<clipPath>` / `<mask>` become Lottie masks or track mattes.
- [ ] **Box-shadow approximation.** An offset, blurred copy of the box shape. It would use a blur effect where players support it, or layered translucent strokes otherwise.
- [ ] **Text as Lottie text layers.** Emit real text layers (`ty: 5`) with embedded font info, as an alternative to outlines. Text would stay editable and files smaller.

## Later

- [ ] JavaScript-driven animations: record `requestAnimationFrame` and timer-driven style changes by stepping a virtual clock
- [ ] Transitions triggered after load (hover/click/timers) through user-supplied interaction scripts
- [ ] `perspective` and 3D transforms via Lottie 3D layers (`ddd: 1`)
- [ ] Precompositions for group opacity and shared symbols (`<use>`)
- [ ] `filter: blur()` / `drop-shadow()` via Lottie effects (lottie-web only)
- [ ] SVG `<text>`, `<use>`, `<image>`, nested `<svg>`
- [ ] Path morphing between `d` values with different point counts (point resampling)
- [ ] `.lottie` (dotLottie) output
- [ ] Watch mode (`--watch`) that regenerates on save and live-reloads the preview
