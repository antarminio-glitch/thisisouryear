// Real product photos. Two jobs:
//
//   1. photoFor() picks the photo of the blank garment to show for a product
//      and a city, from src/data/garment-photos.json (built by
//      scripts/fetch-garment-photos.mjs).
//   2. nearestColor() is the color matching that script uses to pick which of
//      the vendor's blank colors is closest to a city's shirt color.
//
// Plain functions, no imports, so the same code runs at build time, in the
// browser and in the fetch script.

// ---- color matching

function toRgb(hex) {
  const h = String(hex).replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function hexOf([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// sRGB to CIE Lab (D65). Distances in Lab roughly match how different two
// colors look, which plain RGB distances do not.
export function labOf(hex) {
  const lin = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const [r, g, b] = lin;
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// CIE76 color difference. Under about 2 is hard to see; over about 20 is a
// clearly different color.
export function deltaE(hexA, hexB) {
  const [a, b] = [labOf(hexA), labOf(hexB)];
  return Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));
}

// CIEDE2000, the current standard for how different two colors look. Unlike
// the simple Lab distance it does not let darkness swamp hue, and it corrects
// the blue region, which is what keeps royal blues from matching purples.
// `kL` is the lightness weight; the textile industry uses 2, which halves
// the weight of lightness. That suits us: a team's screen color is brighter
// than any dyed cotton, so lightness is the least trustworthy part.
export function deltaE2000(hexA, hexB, { kL = 1 } = {}) {
  const [L1, a1, b1] = labOf(hexA);
  const [L2, a2, b2] = labOf(hexB);
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hp = (a, b) => (a === 0 && b === 0 ? 0 : (Math.atan2(b, a) * deg + 360) % 360);
  const h1p = hp(a1p, b1);
  const h2p = hp(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 360 : -360;
    hbp /= 2;
  }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hbp - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH));
}

// How far a team's screen color is from a blank's measured fabric color.
// CIEDE2000 with the textile lightness weight. Under about 5 is the same
// color to most eyes; over about 15 is a different one.
export function colorDistance(hexA, hexB) {
  return deltaE2000(hexA, hexB, { kL: 2 });
}

// The vendor color closest to `hex`. `colors` is a list of { code, name, hex }.
// Returns { color, distance } or null if the list is empty.
export function nearestColor(hex, colors) {
  let best = null;
  for (const c of colors) {
    if (!c?.hex) continue;
    const d = colorDistance(hex, c.hex);
    if (!best || d < best.distance) best = { color: c, distance: d };
  }
  return best;
}

// Builds one test from the list of patterns in garments.json. Heathers, camo
// and neons are skipped by default because a flat team color never matches
// them well.
export function skipTest(patterns = []) {
  const res = patterns.map((p) => new RegExp(p, 'i'));
  return (name) => res.some((re) => re.test(String(name)));
}

// ---- looking photos up

// The product that a style and fit map to, by its id in catalog.json.
export function productIdFor(products, style, audience) {
  return (products ?? []).find((p) => p.style === style && p.audience === audience)?.id ?? `${audience}-${style}`;
}

// The photo for a product and a city: { src, hex, print, color }. With no
// city, the garment's neutral blank (white) so pickers have something to show
// before a city is chosen. Null when there is no photo, in which case the
// drawing is used.
export function photoFor(photos, productId, slug = '') {
  const g = photos?.garments?.[productId];
  if (!g) return null;
  const key = slug ? g.cities?.[slug]?.color : g.neutral;
  const c = key ? g.colors?.[key] : null;
  if (!c?.src) return null;
  return { src: c.src, hex: c.hex, print: g.print, color: c.name, style: g.style };
}

// The vendor blank a city is printed on for a product: { style, code, name },
// for example PC54 / TrueNavy / True Navy. Null when no photo was matched.
export function blankFor(photos, productId, slug) {
  const g = photos?.garments?.[productId];
  const code = g?.cities?.[slug]?.color;
  const c = code ? g.colors?.[code] : null;
  return c ? { style: g.style, code, name: c.name } : null;
}

// ---- on-model photos (src/data/model-photos.json): a short list, hero spots only

export const modelKey = (style, color) => `${style}:${color}`;

export function modelPhotoFor(models, style, color) {
  return models?.photos?.[modelKey(style, color)] ?? null;
}

// The model photo closest to a city: the blank the city is printed on, per
// product in the order given, until one of those blanks has a model shot.
// Null when none does, in which case the page shows nothing extra.
export function modelPhotoForCity(models, photos, slug, productIds = ['adult-tee', 'adult-hoodie', 'kids-tee', 'kids-hoodie']) {
  for (const id of productIds) {
    const blank = blankFor(photos, id, slug);
    const hit = blank ? modelPhotoFor(models, blank.style, blank.code) : null;
    if (hit) return { ...hit, productId: id };
  }
  return null;
}

// The first city printed on a given blank, so a model shot has real colors
// to wear. `teams` decides the order.
export function cityForBlank(photos, teams, productId, color) {
  return (teams ?? []).find((t) => photos?.garments?.[productId]?.cities?.[t.slug]?.color === color) ?? null;
}

// One item from a list, changing with the day, so hero spots rotate with the
// daily rebuild. Same day, same pick.
export function rotatingPick(list, date = new Date()) {
  if (!list?.length) return null;
  const day = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
  return list[day % list.length];
}

// A short strip of model shots: one per product, in the order the products
// are given, each worn by a city printed on that blank. Rotates by day.
export function stripPicks(models, photos, teams, productIds, count = 4, date = new Date()) {
  const out = [];
  for (const productId of productIds) {
    const options = Object.values(models?.photos ?? {}).filter((m) => m.productId === productId);
    const photo = rotatingPick(options, date);
    const team = photo ? cityForBlank(photos, teams, productId, photo.color) : null;
    if (photo && team) out.push({ photo, team, productId });
    if (out.length >= count) break;
  }
  return out;
}

// The slimmed-down copy that goes to the browser: only what drawing needs.
export function photosForBrowser(photos) {
  const garments = {};
  for (const [id, g] of Object.entries(photos?.garments ?? {})) {
    garments[id] = {
      style: g.style,
      neutral: g.neutral,
      print: g.print,
      colors: Object.fromEntries(Object.entries(g.colors ?? {}).map(([k, c]) => [k, { src: c.src, hex: c.hex, name: c.name }])),
      cities: Object.fromEntries(Object.entries(g.cities ?? {}).map(([k, c]) => [k, { color: c.color }])),
    };
  }
  return { garments };
}
