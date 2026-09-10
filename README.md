# AR Menu Studio

Upload a raw food photo, get an AR-ready 3D dish a guest can place on their table, on Android and on iPhone. React, three.js, model-viewer. No API keys, no server, no per-image cost — every step runs in the browser, including the iOS conversion.

Built with GCC restaurants in mind: bilingual English/Arabic UI with full RTL, GCC currencies, and a printable QR per dish for the paper menu.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
npm run preview
```

## The pipeline

Drop a photo in and the finished dish comes back. Nothing to tune, no clicks in between.

1. **Photo** — decoded and downscaled to 1024 px for the per-pixel passes.
2. **Cut-out** — background removal in `src/lib/segment.js`, at its default strength.
3. **Camera angle** — second moments of the cut-out say whether the plate was shot from above or at an angle, which is the one parameter that used to need a human.
4. **3D dish** — inflation in `src/lib/inflate.js`, or a reconstruction model when one is configured.
5. **Publish** — GLB and USDZ export, AR viewer, menu entry, QR code.

About four seconds end to end on the built-in engine. The cut-out and shape controls still exist behind *Adjust cut-out* and *Adjust shape* on the finished dish, for the photo the automatic pass gets wrong, and returning from either rebuilds and lands back on the dish.

## Two engines

The studio can build a dish two ways, chosen on the cut-out step.

**On device** is silhouette inflation, described below. Free, instant, no key, and it has a hard ceiling: it can only puff up what the camera already saw, which on food reads as smooth and plasticky.

**TRELLIS 2 / Hunyuan3D** send the cut-out to a real image-to-3D model and get a reconstructed mesh back. Paste an API key on the cut-out step and pick the engine. The key lives in `localStorage` and goes straight from the browser to the service, so **anyone who can open the page on that device can spend it** — fine for your own testing, not fine once a restaurant is involved. Move it behind your own server first: `BASE_URL` in `src/lib/ai3d.js` is the only line that has to change.

TRELLIS 2 is MIT licensed and self-hostable on a 16GB NVIDIA GPU, which costs nothing per dish. Through fal it is roughly $0.25 to $0.35 per generation, which is the price of not running a GPU. Reconstruction takes tens of seconds to a few minutes depending on the queue.

The reconstruction is fetched once and cached in memory, so changing the dish width, its facing or its plate re-places that same mesh locally rather than paying for another call.

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

## iOS

Android reads the GLB through WebXR or Scene Viewer. iPhone and iPad go through AR Quick Look, which reads USDZ and nothing else. Both files come out of the same three.js object, so each dish is exported twice, in the browser, with no backend and no conversion service.

Quick Look is strict about how the file arrives, and a `blob:` URL fails every one of its rules. So a small service worker (`public/ar-sw.js`) serves the USDZ from the Cache API at a real same-origin path, `/ar/<id>.usdz`, answering with `model/vnd.usdz+zip`. That is the whole delivery layer; `src/lib/ar.js` is the app side of it.

What is verified here, in headless Chromium:

- The USDZ is a valid archive: `model.usda` first, every entry stored uncompressed, every file offset 64-byte aligned. Quick Look rejects an archive that misses any of those.
- The texture is written as PNG, so the alpha that carves the dish silhouette survives, and `alphaTest` maps onto `opacityThreshold`, which is how Quick Look does cut-outs.
- The service worker answers `/ar/<id>.usdz` with the right bytes and the right content type, both for the studio preview and for a saved dish.

What is not verified here: Quick Look itself. There is no iPhone in this environment. Open a dish over HTTPS on a real device before you trust it in front of a guest.

Two consequences worth knowing. The dish is single-sided, because USDZ has no double-sided flag; the front and back shells both taper to zero at the silhouette, so the object is closed and single-sided rendering matches the preview. And USDZ archives are uncompressed by format, with geometry written as ASCII text, so a USDZ runs about 2.5x its GLB. *Mesh detail* is the only real lever on that; the default of 128 gives roughly 52k triangles, a 1.5 MB GLB and a 3.6 MB USDZ.

## Known limits, stated plainly

**Dishes live in one browser.** `src/lib/storage.js` is IndexedDB. That means the QR codes only resolve on the device that created the menu — fine for building and demoing, useless for guests. The module is deliberately a thin, swappable interface: point `saveItem`, `listItems`, `getItem` and `getAsset` at Supabase, Firebase or your own API and everything above it is unchanged. Until then, *Export menu* writes a JSON file with the models embedded and *Import menu* reads it back on another device.

**The AI engines are untested against the live service.** The request and response handling, the queue polling, the GLB import and the USDZ export are all verified end to end against a stubbed service, because fal is unreachable from the machine this was built on. The first real call may need the request body adjusted; the service's own error text is surfaced verbatim in the UI for exactly that reason.

**Segmentation and inflation run on the main thread.** A 1024 px photo takes a few hundred milliseconds and the UI freezes for that beat. Moving both into a Web Worker is the obvious next step.

**Files are 1.5 MB of GLB and 3.6 MB of USDZ per dish** at the default mesh detail, dominated by geometry rather than texture. Lower *Mesh detail* to trade, or run the GLB through `gltf-transform` with Draco and KTX2 before serving it to guests. Draco will not help the USDZ, which the format requires to be stored uncompressed.

## Deploying

Static build, any host. Both files for SPA routing are included: `public/_redirects` for Netlify, `vercel.json` for Vercel. On nginx, rewrite unmatched paths to `/index.html`.

HTTPS is not optional in production: WebXR, service workers and Quick Look all require a secure context, so on plain HTTP iOS AR degrades to the 3D viewer. Localhost is exempt, which is why the whole flow works in `npm run dev`.

## Layout

```
src/
  lib/imaging.js     canvas helpers, sRGB→Lab, separable blur
  lib/segment.js     background removal
  lib/inflate.js     distance transform, height map, mesh, GLB and USDZ export
  lib/storage.js     IndexedDB, menu export/import
  lib/ar.js          service worker registration, USDZ cache delivery
  components/        dropzone, cut-out canvas, three.js preview, AR viewer, QR
  pages/             Studio (the pipeline), Menu, Item
  i18n/              English + Arabic, RTL
public/ar-sw.js      serves /ar/<id>.usdz so AR Quick Look accepts it
```

## Licences

three.js MIT, model-viewer Apache-2.0, qrcode MIT, React MIT. Nothing here is licence-encumbered for commercial use, and nothing calls a paid API.
