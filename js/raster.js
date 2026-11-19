// Image -> polylines in millimetres, Y-up.
//
// The image is binarised ourselves (so the threshold is under the user's control),
// then Potrace traces the black regions and fits curves to them. Potrace's own SVG
// carries a transform that lands its output back in image-pixel space, so the same
// SVG reader the PDF route uses handles the result.
import { potrace, init } from "../vendor/potrace/potrace.js";
import { svgToPolys } from "./svg.js";

let ready = null;

export async function imageToPolys(file, { threshold = null, widthMM = 100 } = {}) {
  ready ??= init();
  await ready;

  const bmp = await createImageBitmap(file);
  // Potrace rejects an OffscreenCanvas, so this has to be a real canvas element.
  const canvas = Object.assign(document.createElement("canvas"),
                               { width: bmp.width, height: bmp.height });
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close();

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const used = binarise(img, threshold);
  ctx.putImageData(img, 0, 0);

  // extractcolors would also trace the white background as a rectangle, which on a
  // laser is an extra frame cut around the part.
  const svg = await potrace(canvas, { extractcolors: false, turdsize: 2, alphamax: 1 });

  const k = widthMM / canvas.width;              // mm per pixel
  const h = canvas.height;
  const toMM = (x, y) => [x * k, (h - y) * k];   // potrace's transform leaves us Y-down
  return {
    polys: svgToPolys(svg, toMM),
    threshold: used,
    mmPerPixel: k,
  };
}

// In-place binarisation to pure black/white. Transparent pixels count as background,
// otherwise a PNG logo on transparency traces as a solid rectangle.
function binarise(img, threshold) {
  const d = img.data;
  const lum = new Uint8Array(d.length / 4);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const a = d[i + 3] / 255;
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    lum[p] = Math.round(l * a + 255 * (1 - a));
  }
  const t = threshold ?? otsu(lum);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = lum[p] <= t ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  return t;
}

// Otsu's method: the threshold that maximises between-class variance.
// A two-tone image makes every threshold between the two tones equally optimal, so the
// plateau is averaged rather than taking its first index - otherwise this returns 0,
// anti-aliased edge pixels all fall on the white side, and every shape comes out a
// fraction of a millimetre small.
function otsu(lum) {
  const hist = new Float64Array(256);
  for (const v of lum) hist[v]++;
  const total = lum.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  const between = new Float64Array(256);
  let sumB = 0, wB = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    const wF = total - wB;
    sumB += t * hist[t];
    if (!wB || !wF) continue; // an all-one-class split has no variance to speak of
    between[t] = wB * wF * ((sumB / wB) - ((sum - sumB) / wF)) ** 2;
  }

  let best = 0;
  for (const v of between) if (v > best) best = v;
  if (best === 0) return 127; // single-tone image: nothing to separate
  let acc = 0, n = 0;
  for (let t = 0; t < 256; t++) {
    if (between[t] >= best * (1 - 1e-9)) { acc += t; n++; }
  }
  return Math.round(acc / n);
}
