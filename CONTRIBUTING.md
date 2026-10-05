# Contributing to css2lottie

Thanks for helping. Bug reports with a small HTML file are the most useful contribution. Use the **Unsupported animation** issue template.

## Setup

```bash
git clone https://github.com/99proteam/css2lottie.git
cd css2lottie
npm install
npx playwright-core install chromium   # browser used by the sampler and tests
npm test
```

Useful scripts:

| Script                | What it does                                             |
| --------------------- | -------------------------------------------------------- |
| `npm run build`       | ESM + CJS + types with tsup into `dist/`                 |
| `npm run typecheck`   | `tsc --noEmit` (strict)                                  |
| `npm run lint`        | ESLint                                                   |
| `npm run format`      | Prettier                                                 |
| `npm test`            | Vitest: unit, integration, snapshot and pixel-diff tests |
| `npm run test:update` | Update snapshots after an intended output change         |
| `npm run examples`    | Regenerate `examples/out/*.json` (after `npm run build`) |

Try a file end to end with `node dist/cli.js my.html --preview` after building.

## Architecture

```
src/
  sampler/        Playwright + in-page code (Web Animations API sampling)
    page-script.ts  runs inside Chromium: discovers nodes, pauses/seeks animations
    sampler.ts      opens the page and batches sampling
  timeline.ts     duration/loop detection and per-animation keyframe segments
  easing/         cubic-bezier math and the keyframe optimizer (buildTrack)
  converters/     one file per CSS property family → Lottie data
  builder.ts      runs converters per node and assembles layers
  lottie/         Lottie JSON types and property helpers
  preview/        --preview comparison page and server
  cli/            command-line interface
```

The sampler records raw values for every frame: computed styles, the transform matrix, the transform origin and the layout box. **Converters** turn those values into Lottie properties. They never talk to the browser directly, which keeps them easy to unit test.

## Adding support for a new CSS property

Each converter lives in its own file in `src/converters/` and implements `NodeConverter`:

```ts
// src/converters/my-property.ts
import type { NodeConverter } from "./types.js";
import { toScalarProperty } from "../lottie/properties.js";

export const myPropertyConverter: NodeConverter = {
  name: "my-property",
  // Which nodes it applies to: html | pseudo | img | svg-root | svg-group | svg-shape
  kinds: ["html", "pseudo"],
  // Computed styles the sampler must record every frame for those nodes
  styles: ["my-property"],
  // CSS properties whose *animation* you can now represent. Anything animated that no
  // converter lists here is reported as "unsupported" automatically.
  animatable: ["my-property"],
  convert(ctx) {
    // ctx.style(prop) → sampled string values, one per sample time (ctx.times)
    const values = ctx.style("my-property").map((v) => [parseFloat(v) || 0]);
    // ctx.track() builds keyframes. It tries the CSS easing of the animations that touch
    // `properties` and falls back to per-frame keys only when needed.
    const prop = toScalarProperty(
      ctx.track(values, { properties: ["my-property"], tolerance: 0.01 }),
    );
    // Write into the layer: ctx.layer.transform, ctx.layer.groups (shapes), ctx.addAsset(...)
    // ... and use ctx.report.unsupported/approximated(...) for anything you can't map.
    void prop;
  },
};
```

Then:

1. **Register it** in `src/converters/index.ts`. Order matters: converters can read results from earlier ones (`ctx.opacity`, `ctx.geometry`).
2. **Unit test** the pure parts (parsing, geometry, color math) in `test/unit/<name>.test.ts`.
3. **Integration test** it in `test/convert.test.ts` with a tiny HTML page. Use `expectFidelity()` to compare the lottie-web render against the CSS render pixel by pixel.
4. **Add an example** in `examples/<name>.html` and list it in `examples/examples.json` if it shows something new. Then run `npm run test:update` and review the new snapshot.
5. Move the item from `ROADMAP.md` to the supported table in `README.md`, and add a `CHANGELOG.md` entry.

Tips:

- Pick a tolerance in the channel's own units: px for positions, 0–100 for opacity, 0–1 for colors. Too tight and you get needless per-frame keys. Too loose and the output drifts.
- Shape groups are drawn by `order`, highest on top. The background uses 10, borders 20 and text 30.
- Keep Lottie output within what lottie-web, lottie-ios and lottie-android all support. Check the [Lottie spec](https://lottie.github.io/lottie-spec/) and test on mobile players when you can.
- Code in `src/sampler/page-script.ts` is serialized into the page with `Function#toString()`. It can't import anything or reference module-level values.

## Pull requests

- Run `npm run lint && npm run typecheck && npm test` before pushing. CI runs the same.
- Keep PRs focused: one property or fix per PR is ideal.
- Update snapshots only when the output change is intended, and say why in the PR.

## Releases (maintainers)

1. Update `version` in `package.json` and `src/version.ts`, and update `CHANGELOG.md`.
2. Commit, then `git tag vX.Y.Z && git push --follow-tags`.
3. The `release` workflow tests, builds and publishes to npm with provenance.
