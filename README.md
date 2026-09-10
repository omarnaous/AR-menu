# AR Menu Studio

Upload a raw food photo, get an AR-ready 3D dish a guest can place on their table. React, three.js, model-viewer. No API keys, no server, no per-image cost — every step runs in the browser.

Built with GCC restaurants in mind: bilingual English/Arabic UI with full RTL, GCC currencies, and a printable QR per dish for the paper menu.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
npm run preview
```

## The pipeline

1. **Photo** — the image is decoded and downscaled to 1024 px for the per-pixel passes.
2. **Cut-out** — background removal in `src/lib/segment.js`.
3. **3D dish** — inflation in `src/lib/inflate.js`.
4. **Publish** — GLB export, AR viewer, menu entry, QR code.

## How a flat photo becomes 3D

Be clear about this, because it decides what the product can promise: **a single photo contains no depth information.** No library, free or paid, recovers the true geometry of a plate of machboos from one JPEG. Photogrammetry needs many angles. Image-to-3D models (TripoSR, Hunyuan3D, Stable Fast 3D) hallucinate a plausible mesh and need a GPU, which means a server and a bill per image.

This app does the third thing, which is the only one that runs free and instantly on a phone: **silhouette inflation.**

- A chamfer distance transform measures how deep inside the silhouette each pixel is.
- Height follows a circular cross-section of that depth, so the middle rises and the edge tapers to zero.
- The photo's own high-frequency shading is layered on as fine surface relief.
- Front and back shells share the silhouette boundary, so the object is closed and holds up when a guest walks around it.

Most restaurant photos include a plate, and a plate is not a mound. Inflating the whole silhouette turns a 30 cm plate into a 12 cm white dome with the food painted on its crown — the worst-looking failure mode here. So a colour model built from the rim band of the silhouette separates crockery from food. The plate becomes a thin slab with a rounded rim; only the food gets the mound. When the rim already looks like the food (a burger shot with no plate), the split is meaningless and the whole silhouette inflates. Toggle: *The photo already has a plate*.

**What this gives you:** a convincing dish at the right physical scale, from a photo you already have, in about two seconds.

**What it does not give you:** true undercuts, separate garnish geometry, or the back of a dish the camera never saw. Stacked food shot from a low angle (a triple burger) will read as a relief card, not a sculpture. Shoot top-down.

## Background removal

`segmentFood()` builds two colour models in CIE Lab — the border ring of the photo, and the middle — then labels each pixel by which it is closer to. Then: morphological open, connected components with small blobs dropped, hole fill, edge erode, feather.

It handles the way restaurants actually shoot food: one dish, centred, plain surface. It does not handle a busy table, a patterned cloth the colour of the sauce, or three dishes in frame. For those the UI gives you a box to constrain the search, a cut-strength slider, and erase/restore brushes. Two seconds of brushing beats a re-shoot.

If you would rather run a neural matting model, `segmentFood()` is a pure function from `ImageData` to an alpha `Uint8Array` — swap the body and the rest of the app is unchanged.

## Shooting guide for restaurant staff

Give this to whoever holds the phone. It matters more than any slider in the app.

- One dish, centred, filling most of the frame.
- Plain surface behind it: wooden table, single-colour cloth. Not a patterned tablecloth.
- Even light. No hard shadow crossing the plate, no direct flash.
- Shoot straight down. This is the single biggest quality lever.
- Wipe the rim. Sauce on the plate edge confuses the plate/food split.

## Known limits, stated plainly

**iOS has no camera AR here.** Android goes through WebXR or Scene Viewer with the GLB. iPhone and iPad use Quick Look, which requires a USDZ file, and there is no free browser-side GLB→USDZ converter. iOS visitors get the interactive 3D viewer instead of camera AR. To fix it you need a build step or an endpoint running Apple's `usdzconvert` or Google's `usd_from_gltf`, then set `ios-src` on the `<model-viewer>` element in `src/components/ARView.jsx`. Given that iOS is roughly half of GCC handsets, treat this as the first thing to solve before a real rollout.

**Dishes live in one browser.** `src/lib/storage.js` is IndexedDB. That means the QR codes only resolve on the device that created the menu — fine for building and demoing, useless for guests. The module is deliberately a thin, swappable interface: point `saveItem`, `listItems`, `getItem` and `getAsset` at Supabase, Firebase or your own API and everything above it is unchanged. Until then, *Export menu* writes a JSON file with the models embedded and *Import menu* reads it back on another device.

**Segmentation and inflation run on the main thread.** A 1024 px photo takes a few hundred milliseconds and the UI freezes for that beat. Moving both into a Web Worker is the obvious next step.

**Files are 2–3 MB per dish** at the default mesh detail, dominated by the texture. Lower *Mesh detail*, or run the GLB through `gltf-transform` with Draco and KTX2 before serving it to guests.

## Deploying

Static build, any host. Both files for SPA routing are included: `public/_redirects` for Netlify, `vercel.json` for Vercel. On nginx, rewrite unmatched paths to `/index.html`. WebXR needs HTTPS; localhost is exempt.

## Layout

```
src/
  lib/imaging.js     canvas helpers, sRGB→Lab, separable blur
  lib/segment.js     background removal
  lib/inflate.js     distance transform, height map, mesh, GLB export
  lib/storage.js     IndexedDB, menu export/import
  components/        dropzone, cut-out canvas, three.js preview, AR viewer, QR
  pages/             Studio (the pipeline), Menu, Item
  i18n/              English + Arabic, RTL
```

## Licences

three.js MIT, model-viewer Apache-2.0, qrcode MIT, React MIT. Nothing here is licence-encumbered for commercial use, and nothing calls a paid API.
