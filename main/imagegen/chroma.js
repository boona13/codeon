'use strict';

// ---------------------------------------------------------------------------
// Shared chroma-key transparency.
//
// Some image backends (the ChatGPT-account endpoint, and Google's image model
// via OpenRouter) do not reliably produce transparent PNGs. To still get
// transparent cutouts we ask the model to render the subject on a flat pure
// magenta (#FF00FF) or green (#00FF00) background and key that color out here.
// Detection is intentionally narrow — only a near-uniform magenta/green BORDER
// triggers keying — so ordinary images (including legitimate solid white/cream
// backgrounds) are never altered.
//
// Used by both the Codex proxy and the OpenRouter image-generation tool.
// ---------------------------------------------------------------------------

const CHROMA_KEYS = [
  { name: 'magenta', r: 255, g: 0, b: 255 },
  { name: 'green', r: 0, g: 255, b: 0 },
];
const KEY_MATCH_DIST = 80; // border must be this close to a chroma to qualify
const KEY_INNER = 70; // <= inner distance -> fully transparent
const KEY_OUTER = 150; // >= outer distance -> fully opaque (feather between)

function colorDist(r, g, b, c) {
  const dr = r - c.r, dg = g - c.g, db = b - c.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * If `pngBuffer` has a flat magenta/green background, return a new PNG buffer
 * with that color keyed to transparency. Otherwise return null (leave as-is).
 * Requires `pngjs`; returns null if unavailable or on any decode error.
 *
 * @param {Buffer} pngBuffer
 * @returns {Buffer|null}
 */
function keyOutChroma(pngBuffer) {
  let PNG;
  try { ({ PNG } = require('pngjs')); } catch { return null; }
  let img;
  try { img = PNG.sync.read(pngBuffer); } catch { return null; }

  const { width, height, data } = img;
  if (!width || !height) return null;

  // Sample the border to find the dominant edge color + its uniformity.
  let sr = 0, sg = 0, sb = 0, n = 0;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 64));
  const sample = (x, y) => {
    const i = (y * width + x) * 4;
    sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; n++;
  };
  for (let x = 0; x < width; x += step) { sample(x, 0); sample(x, height - 1); }
  for (let y = 0; y < height; y += step) { sample(0, y); sample(width - 1, y); }
  if (!n) return null;
  const ar = sr / n, ag = sg / n, ab = sb / n;

  // Must be close to a known chroma color.
  let key = null;
  for (const c of CHROMA_KEYS) {
    if (colorDist(ar, ag, ab, c) <= KEY_MATCH_DIST) { key = c; break; }
  }
  if (!key) return null;

  // Confirm the border is actually uniform (variance low), so we don't key out
  // a busy edge that merely averages to a chroma hue.
  let varSum = 0, vn = 0;
  const variance = (x, y) => {
    const i = (y * width + x) * 4;
    varSum += colorDist(data[i], data[i + 1], data[i + 2], { r: ar, g: ag, b: ab }); vn++;
  };
  for (let x = 0; x < width; x += step) { variance(x, 0); variance(x, height - 1); }
  if (vn && varSum / vn > 60) return null;

  // Key every pixel by distance to the chroma color, with a feathered edge and
  // light despill (pull the spilled channel toward the others on edge pixels).
  const span = KEY_OUTER - KEY_INNER;
  let keyed = 0;
  for (let p = 0; p < data.length; p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const d = colorDist(r, g, b, key);
    let alpha = 255;
    if (d <= KEY_INNER) alpha = 0;
    else if (d < KEY_OUTER) alpha = Math.round(((d - KEY_INNER) / span) * 255);
    if (alpha < 255) {
      keyed++;
      if (key.name === 'green') data[p + 1] = Math.min(g, Math.round((r + b) / 2));
      else { const avg = Math.round((r + g + b) / 3); data[p] = Math.min(r, avg + 30); data[p + 2] = Math.min(b, avg + 30); }
    }
    data[p + 3] = alpha;
  }
  if (!keyed) return null;
  try { return PNG.sync.write(img); } catch { return null; }
}

module.exports = { keyOutChroma, colorDist, CHROMA_KEYS };
