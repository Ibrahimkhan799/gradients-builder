# Chroma — Liquid gradient studio

A browser-based playground for chromatic liquid gradients, inspired by iridescent glass and flowing chrome. Built with vanilla JavaScript, Vite, and a dependency-free WebGL renderer.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite.

```sh
npm run build   # Production output in dist/
npm run preview # Preview the production build
npm test        # State, history, and export-dimension tests
```

## Create

- Start with one of six presets, or **Shuffle** for a new composition.
- Choose a liquid, ribbon, or bloom surface. Change the four-color palette, flow, iridescence, distortion, and scale.
- Open **Glass & fine details** for chromatic dispersion, glass depth, exposure, softness, film grain, and rotation.
- Toggle **Animate** to see the material move. Rendering pauses when the tab is hidden.
- Choose landscape, square, portrait, or wallpaper proportions.
- Use the bookmark to keep up to 24 recipes in **Your collection**. Settings and favorites are stored locally in this browser.
- Export an opaque PNG at 1600, 2400, or 3840 pixels on its longest edge. Animation exports as a still frame.

Keyboard shortcuts: **Space** shuffles when no control is focused, **Ctrl/⌘ Z** undoes, **Ctrl/⌘ Shift Z** redoes, and **Escape** closes dialogs/full screen.

## Rendering

`liquid-shader.js` ray-marches closed, deformed glass volumes rather than painting color onto a height field. The material combines entry and exit refraction, wavelength-dependent indices of refraction, Fresnel reflection, approximate thin-film interference, colored strip lighting, and absorption through the volume. A separate finishing pass adds edge-aware antialiasing and restrained highlight bloom. This is an artistic real-time optical approximation, not an offline spectral path tracer.

The four images in `inspirations/` guide the broad meniscus shapes, black negative space, and tightly layered rainbow reflections. They are not used as textures or exported as artwork: every frame is generated procedurally. Start with **Chromatic flow**, use **Portrait** proportions for a composition like `inspiration-3.jpg`, and keep **Softness** low and **Chromatic dispersion** high for sharp spectral contours. Glass depth changes both refraction and the thin-film response; Exposure controls the balance between highlights and black space.

`renderer.js` supports WebGL 1, coalesces slider updates, caps live-preview DPR at 1.5 and total pixels at 900,000, and exports at full resolution through independent framebuffers. Rendering is more GPU-intensive than ordinary CSS gradients. No external image assets, backend, API keys, uploads, or accounts are required. Fonts are bundled locally.

To run the browser checks, install Playwright's Chromium with `npx playwright install chromium`, then run `npm run test:e2e`. To use an already installed Chrome or Edge, set `PLAYWRIGHT_CHANNEL` to `chrome` or `msedge` before that command. In PowerShell, for example: `$env:PLAYWRIGHT_CHANNEL='chrome'; npm run test:e2e`.

The editor requires a WebGL-capable browser. If unavailable, it displays an actionable fallback instead of a blank canvas. Large exports depend on the device's available GPU memory; choose a lower resolution if needed. Mobile fullscreen support depends on the browser.

Existing recipes retain their saved controls and receive default values for newly added optical controls. Since the underlying renderer has changed, their new renders will differ from older exports; saved collection thumbnails are retained. Reapply a preset to use its updated settings.

Presets and saved recipes store parameters, not animation timestamps. Loading a recipe in a new session starts from its initial frame. Browser storage is not a backup: clearing site data removes saved gradients, so export favorites you want to keep.

## Project structure

- `app.js` — editor interactions, storage, collection, export, and accessibility
- `renderer.js` — render passes, animation, WebGL lifecycle, and PNG export
- `liquid-shader.js` — volumetric liquid geometry, spectral glass shading, and optical finishing
- `studio-state.js` — presets, validated state, history, and export sizing
- `index.html` / `style.css` — responsive studio interface
- `tests/` — state, editor, and optical renderer checks; optical studies write comparison PNGs to `.artifacts/optics/`
