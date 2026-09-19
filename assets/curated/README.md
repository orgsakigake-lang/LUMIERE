# Reference exhibition assets

All six works are generated with LUMIÈRE's existing algorithms. They are new curated works; no stored legacy work or placement is changed. Artwork definitions, requested seeds, palettes, canonical dimensions, and titles live in `src/curated/exhibition.ts`. `art/manifest.json` records the resolved seeds after the existing quality gate.

Regenerate with `npm run art:curated`. This uses a local Chromium Canvas2D renderer, paints each canonical image once, and derives thumbnail, room, and full-size WebP images from those pixels. No visitor-side generation or worker is needed for these six works. Canvas output can vary across browser versions; commit the reviewed exports as the exhibition's canonical assets instead of regenerating on every build.

The room is authored in `src/curated/scene.ts`: dimensional primitives merged by material, one static shadow map, shared tiny surface maps, and a contact-shadow texture. There is no external model, texture pack, or font license dependency. This initial kit uses static cached direct shadows and ambient fill; it does not claim a finished offline global-illumination/lightmap pipeline.

`cover.webp` is a capture of the real room, not a separately generated concept image. With the build served on port 8019, run `node tools/capture-curated.mjs` and then `npm run build:curated` to refresh it. The capture is intentionally an authoring step, separate from visitor loading.
