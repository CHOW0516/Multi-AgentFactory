# Anatomy kit (vendored)

Copied unchanged from the Anatomy skill's `kit/` (MIT, see `LICENSE`). Owned by P1; **do not edit**.
P5 imports from here. If something is missing, ask in `docs/requests/p5.md`.

| File | Use |
|---|---|
| `iso-kit.ts` | Core (camera, solids, parts library, SVG renderer, CSS). Import this from TypeScript. |
| `iso-kit.mjs` | Same core as plain ESM; needed by `lathe.mjs` and `tube.mjs`. |
| `iso.css` | Kit styles. Put `class="iso"` (and `data-theme="light"` for light) on a wrapper. |
| `react/draw.tsx` | React components: `Solid`, `Line`, `Wire`, `Dots`, `FaceText`, `IsoFigure`, `Plate`. |
| `react/live.tsx` | Hooks: `useReadout`, `useLoop`, `useEased`, `useInView`, `useStillness`, `spring`, `follow`. |
| `lathe.mjs`, `tube.mjs` | Round parts and pipes/cables. |
| `gl.mjs`, `gl-shared.mjs` | Optional WebGL layer for shaders inside the drawing. |
