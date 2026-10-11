// Pulls real photos of the blank garments from SanMar, the print vendor's
// supplier, so the site shows actual shirts instead of drawings.
//
//   npm run photos                 fetch anything missing
//   npm run photos -- --dry-run    only show which blank color each city gets
//   npm run photos -- --force      fetch everything again
//   npm run photos -- --only adult-tee
//
// For every garment in src/data/garments.json it:
//   1. looks the style number up on sanmar.com and reads the list of colors
//      that blank comes in
//   2. measures the real color of each blank from its small photo and picks
//      the one closest to each city's shirt color (or the one named under
//      "blank" for that city in teams.json)
//   3. downloads the flat front photo of each color it needs, trims it,
//      squares it on white and saves it in public/images/garments/
//   4. measures the actual fabric color at chest height, which the lettering
//      uses so its outline gap looks like the shirt showing through
//   5. writes src/data/garment-photos.json, which the site reads
//
// Photos and the data file are committed, so the live build never talks to
// SanMar. Run this again when a color changes or a new garment is added.
//
// SanMar lets its customers use its product photography to sell SanMar
// products. These photos must not be used for anything else.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { nearestColor, hexOf, skipTest, colorDistance } from '../src/lib/photos.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(root, 'src/data');
const OUT_DIR = path.join(root, 'public/images/garments');
const OUT_JSON = path.join(DATA, 'garment-photos.json');
const CACHE = path.join(root, '.cache/garment-photos');
const UA = 'Mozilla/5.0 (Macintosh) thisisouryear-photo-fetch (+https://thisisouryear.team)';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const DRY = flag('dry-run');
const FORCE = flag('force');
const ONLY = opt('only');

const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const exists = (file) =>
  fs.access(file).then(
    () => true,
    () => false,
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);
const absolute = (url) => (url.startsWith('//') ? `https:${url}` : url.startsWith('/') ? `https://www.sanmar.com${url}` : url);

// ---- fetching, politely: one request at a time, a short pause, a retry or two

async function get(url, { as = 'text' } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: as === 'json' ? 'application/json' : '*/*' }, signal: AbortSignal.timeout(30000), redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await sleep(250);
      if (as === 'json') return res.json();
      if (as === 'buffer') return Buffer.from(await res.arrayBuffer());
      return res.text();
    } catch (e) {
      lastError = e;
      await sleep(1000 * attempt);
    }
  }
  throw new Error(`Could not fetch ${url}: ${lastError.message}`);
}

async function cached(url, { as = 'buffer' } = {}) {
  await fs.mkdir(CACHE, { recursive: true });
  const file = path.join(CACHE, hash(url));
  if (!FORCE && (await exists(file))) return as === 'text' ? fs.readFile(file, 'utf8') : fs.readFile(file);
  const body = await get(url, { as });
  await fs.writeFile(file, body);
  return body;
}

// ---- reading SanMar's product page
//
// The page carries the full product record as JSON for its own scripts. That
// record lists every color the style comes in and every photo of this color.

function extractProduct(html) {
  const at = html.indexOf('"baseOptions"');
  if (at < 0) throw new Error('No product record on that page. SanMar may have changed its site.');
  // Walk back to the opening brace of the product object.
  let depth = 0;
  let start = -1;
  for (let i = at; i >= 0; i--) {
    const ch = html[i];
    if (ch === '}' || ch === ']') depth++;
    else if (ch === '{' || ch === '[') {
      if (depth > 0) depth--;
      else if (ch === '{' && !/[:,[]\s*$/.test(html.slice(Math.max(0, i - 40), i))) {
        start = i;
        break;
      } else if (ch === '{') {
        // A nested object that happens to sit before "baseOptions": keep going
        // only if it's the value of a key. The product object itself is the
        // value of "product":, so it also matches; take the first candidate
        // that parses.
        start = i;
        break;
      }
    }
  }
  if (start < 0) throw new Error('Could not find the start of the product record.');
  // Scan forward to the matching close, respecting strings.
  let d = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') d++;
    else if (ch === '}' || ch === ']') {
      d--;
      if (d === 0) return JSON.parse(html.slice(start, i + 1));
    }
  }
  throw new Error('The product record on that page is incomplete.');
}

async function productPage(code) {
  const html = await cached(`https://www.sanmar.com/p/${code}`, { as: 'text' });
  const p = extractProduct(html);
  if (!p.styleNumber || !Array.isArray(p.baseOptions)) throw new Error(`Page for ${code} did not have a product record.`);
  return p;
}

// Finds SanMar's internal code for a style number like "PC54". Their search
// returns the product links for a query, and the product page confirms the
// style number, so a search hit for the wrong style is never used.
async function resolveCode(style) {
  const json = await get(`https://www.sanmar.com/search/results?q=${encodeURIComponent(style)}&page=0&format=json`, { as: 'json' });
  const codes = [...new Set([...(json.productListerHtml ?? '').matchAll(/\/p\/(\d+)_[A-Za-z0-9]+/g)].map((m) => m[1]))];
  if (!codes.length) throw new Error(`SanMar search found nothing for ${style}.`);
  for (const code of codes.slice(0, 5)) {
    const firstColor = (json.productListerHtml ?? '').match(new RegExp(`/p/(${code}_[A-Za-z0-9]+)`))?.[1];
    const p = await productPage(firstColor ?? code);
    if (p.styleNumber?.toUpperCase() === style.toUpperCase()) return { code, product: p };
  }
  throw new Error(`SanMar search for ${style} returned other styles only.`);
}

// Every color a style comes in, from the product record.
function colorsOf(product) {
  const options = product.baseOptions?.find((b) => b.variantType === 'ApparelColourVariantProduct')?.options ?? product.baseOptions?.[0]?.options ?? [];
  return options.map((o) => {
    const q = (o.variantOptionQualifiers ?? [])[0] ?? {};
    return {
      code: String(o.code).split('_').slice(1).join('_'),
      fullCode: o.code,
      name: q.value ?? String(o.code).split('_').slice(1).join('_'),
      swatch: q.image?.url ? absolute(q.image.url) : null,
      page: absolute(o.url ?? `/p/${o.code}`),
    };
  });
}

// The flat front photo of one color. `formats` is the order of sizes to try:
// SanMar keeps a 1200 pixel "zoom", a 624 pixel "mainImage", a 128 pixel
// "listingPage" and a 92 pixel "thumbnail" of each shot.
function flatFrontOf(product, formats = ['zoom', 'mainImage']) {
  const images = product.images ?? [];
  const pick = (test) => images.find((i) => i.imageType === 'GALLERY' && test(i));
  for (const re of [/FlatFront/i, /Flat/i, /ModelFront/i]) {
    for (const format of formats) {
      const hit = pick((i) => i.format === format && re.test(i.mediaCode));
      if (hit) return hit;
    }
  }
  return null;
}

// ---- colors

async function averageHex(input, region = null) {
  let img = sharp(input);
  if (region) img = img.extract(region);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += info.channels) {
    sum[0] += data[i];
    sum[1] += data[i + 1];
    sum[2] += data[i + 2];
  }
  return hexOf(sum.map((v) => v / n));
}

async function swatchHex(url) {
  try {
    return await averageHex(await cached(url));
  } catch {
    return null;
  }
}

// ---- the photo itself: trim the white, square it, size it, measure it

// Trims the white around the garment and centers it on a white square, so
// every photo frames the garment the same way whatever SanMar's framing was.
async function squareUp(buffer, size) {
  const trimmed = await sharp(buffer).trim({ background: '#ffffff', threshold: 10 }).toBuffer({ resolveWithObject: true });
  const { width, height } = trimmed.info;
  const side = Math.max(width, height);
  const pad = { top: Math.floor((side - height) / 2), left: Math.floor((side - width) / 2) };
  return sharp(trimmed.data)
    .extend({ top: pad.top, bottom: side - height - pad.top, left: pad.left, right: side - width - pad.left, background: '#ffffff' })
    .resize(size, size)
    .toBuffer();
}

// The fabric color where the print goes. The lettering is drawn in a 600 by
// 600 space, so the print rectangle is scaled to the photo's size.
function fabricHex(square, size, print) {
  const k = size / 600;
  const height = print.capHeight * 2 + print.rowGap;
  return averageHex(square, {
    left: Math.round((print.x - 30) * k),
    top: Math.round(print.top * k),
    width: Math.round(60 * k),
    height: Math.round(height * k),
  });
}

// The real color of a blank, measured from SanMar's small front photo of it.
// Swatch images are too dull to match against: their "Red" averages to a
// dark maroon while the photographed shirt is bright red.
async function sampledHex(color, print) {
  try {
    const page = await productPage(color.fullCode);
    const small = flatFrontOf(page, ['listingPage', 'thumbnail', 'mainImage']);
    if (!small) return color.swatch ? swatchHex(color.swatch) : null;
    const square = await squareUp(await cached(absolute(small.url)), 200);
    return await fabricHex(square, 200, print);
  } catch {
    return color.swatch ? swatchHex(color.swatch) : null;
  }
}

async function processPhoto(buffer, file, size, print) {
  const square = await squareUp(buffer, size);
  const hex = await fabricHex(square, size, print);
  if (!DRY) await sharp(square).webp({ quality: 82 }).toFile(file);
  return hex;
}

// ---- main

async function main() {
  const config = await readJson(path.join(DATA, 'garments.json'));
  const teams = await readJson(path.join(DATA, 'teams.json'));
  const previous = (await exists(OUT_JSON)) ? await readJson(OUT_JSON) : { garments: {} };
  const skip = skipTest(config.skipColors);
  const size = config.imageSize ?? 1000;
  const out = { vendor: config.vendor, vendorSite: config.vendorSite, fetched: new Date().toISOString().slice(0, 10), garments: { ...previous.garments } };
  const problems = [];

  await fs.mkdir(OUT_DIR, { recursive: true });

  for (const [id, g] of Object.entries(config.garments)) {
    if (ONLY && ONLY !== id) continue;
    console.log(`\n${id}: ${g.style} ${g.name}`);

    // 1. the style and its colors
    let code = g.code ?? previous.garments?.[id]?.code;
    let product;
    if (code) {
      try {
        product = await productPage(`${code}_${g.neutral}`);
        if (product.styleNumber?.toUpperCase() !== g.style.toUpperCase()) throw new Error('style mismatch');
      } catch {
        code = null;
      }
    }
    if (!code) ({ code, product } = await resolveCode(g.style));
    const colors = colorsOf(product);
    console.log(`  SanMar code ${code}, ${colors.length} colors`);

    // 2. the real color of each usable blank, from its photo
    const usable = colors.filter((c) => !skip(c.name));
    process.stdout.write(`  measuring ${usable.length} colors from their photos`);
    for (const c of usable) {
      c.hex = await sampledHex(c, g.print);
      process.stdout.write('.');
    }
    console.log();
    const matchable = usable.filter((c) => c.hex);
    // Kept for anyone checking the matching by hand.
    await fs.mkdir(CACHE, { recursive: true });
    await fs.writeFile(path.join(CACHE, `measured-${id}.json`), JSON.stringify(matchable.map(({ code, name, hex }) => ({ code, name, hex })), null, 1));

    // 3. the blank for each city
    const cities = {};
    const wanted = new Map();
    const byCode = Object.fromEntries(colors.map((c) => [c.code, c]));
    const want = (c) => wanted.set(c.code, c);
    const neutral = byCode[g.neutral];
    if (!neutral) problems.push(`${id}: neutral color "${g.neutral}" is not one of ${g.style}'s colors.`);
    else want(neutral);

    for (const t of teams) {
      // "blank" in teams.json names the vendor color by hand: one code for
      // every garment, or an object keyed by product id or style number.
      const override = typeof t.blank === 'string' ? t.blank : (t.blank?.[id] ?? t.blank?.[g.style]);
      let chosen;
      let how;
      let d;
      if (override) {
        chosen = byCode[override];
        how = 'blank';
        if (!chosen) {
          problems.push(`${id}: ${t.slug} asks for blank "${override}", which is not one of ${g.style}'s colors. Codes look like: ${colors.slice(0, 6).map((c) => c.code).join(', ')}`);
          continue;
        }
        d = chosen.hex ? colorDistance(t.shirt, chosen.hex) : null;
      } else {
        const best = nearestColor(t.shirt, matchable);
        if (!best) {
          problems.push(`${id}: no matchable colors, so ${t.slug} has no photo.`);
          continue;
        }
        chosen = best.color;
        how = 'auto';
        d = best.distance;
      }
      cities[t.slug] = { color: chosen.code, how, distance: d == null ? null : Math.round(d * 10) / 10 };
      want(chosen);
      const far = d != null && d > 15 ? '  <- not a close match; consider a "blank" override in teams.json' : '';
      console.log(`  ${t.slug.padEnd(20)} ${t.shirt}  ->  ${chosen.name.padEnd(22)} ${chosen.code.padEnd(12)} ${how === 'blank' ? '(chosen by hand)' : `distance ${cities[t.slug].distance}`}${far}`);
    }

    // 4. the photos
    const kept = previous.garments?.[id]?.colors ?? {};
    const photos = {};
    for (const c of wanted.values()) {
      const file = path.join(OUT_DIR, `${g.style.toLowerCase()}-${c.code.toLowerCase()}.webp`);
      const src = `/images/garments/${path.basename(file)}`;
      if (!FORCE && kept[c.code]?.src === src && (await exists(file))) {
        photos[c.code] = kept[c.code];
        continue;
      }
      if (DRY) {
        photos[c.code] = { name: c.name, src, hex: c.hex ?? null, sourcePage: c.page, sourceImage: null, pending: true };
        continue;
      }
      const page = await productPage(c.fullCode);
      const image = flatFrontOf(page);
      if (!image) {
        problems.push(`${id}: SanMar has no front photo of ${g.style} in ${c.name}.`);
        continue;
      }
      process.stdout.write(`  downloading ${c.name}...`);
      const buffer = await cached(absolute(image.url));
      const hex = await processPhoto(buffer, file, size, g.print);
      console.log(` ${hex}`);
      photos[c.code] = { name: c.name, src, hex, sourcePage: c.page, sourceImage: absolute(image.url) };
    }

    // Drop cities whose photo failed, so the site falls back to the drawing.
    for (const [slug, c] of Object.entries(cities)) if (!photos[c.color]) delete cities[slug];

    out.garments[id] = { style: g.style, name: g.name, code, neutral: g.neutral, print: g.print, colors: photos, cities };
  }

  if (DRY) {
    console.log('\nDry run: nothing was downloaded or written.');
  } else {
    await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2) + '\n');
    const count = Object.values(out.garments).reduce((n, g) => n + Object.keys(g.colors).length, 0);
    console.log(`\nWrote ${path.relative(root, OUT_JSON)} with ${count} photos in ${path.relative(root, OUT_DIR)}/`);
  }
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
