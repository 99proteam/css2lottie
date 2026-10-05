# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-05

### Added

- `convert()` / `convertWithReport()` API and the `css2lottie` CLI.
- Sampler: headless Chromium via Playwright. It pauses and seeks `document.getAnimations()`, covering CSS animations, transitions triggered on load and `element.animate()`.
- Converters: transform (translate/rotate/scale/skew, with `transform-origin` as the anchor), opacity/visibility/backface-visibility, background-color, borders (uniform strokes, per-side colors), border-radius (rect/ellipse/per-corner path), width/height and layout position, inline SVG shapes and paint, `<img>` as embedded base64 assets, text to glyph outlines (opentype.js), `::before` / `::after`, and nested elements via parenting.
- Keyframe optimization: bezier-eased keyframes taken from CSS timing functions, including partial segments. They are kept only when they match every sampled frame. Otherwise per-frame keys are simplified with RDP, and hold keys handle discontinuities.
- Timing support: delay, iteration count (infinite becomes a seamless loop), direction (reverse/alternate), fill-mode and playback rate.
- Report of unsupported and approximated features (`--report`, `--report-json`).
- `--preview`: a side-by-side comparison of the CSS original and lottie-web, with a shared scrubber.
- 11 examples, with Lottie schema validation, snapshots and pixel-diff tests.
