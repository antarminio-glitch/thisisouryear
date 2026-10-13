// Exports the "This Is Our Year" lettering as print-ready artwork, one set
// per city, for a print-on-demand service such as Printify.
//
//   node scripts/export-artwork.mjs            every city
//   node scripts/export-artwork.mjs dallas     one city
//
// For each city it writes to artwork/:
//   this-is-our-year-<city>.svg   vector, colors baked in, no fonts, tight
//                                 around the lettering with a small margin
//   this-is-our-year-<city>.png   the same at 300 dpi, WIDTH_IN inches wide,
//                                 transparent background
// plus COLORS.md, the four inks for every city, for the product listings.
//
// The lettering is the site's own vector paths (src/lib/varsity-artwork.js),
// so what is printed is exactly what the mockups show. The outer stroke is
// the city's "outline" color, the keyline is the dark border on the top row
// and the light ink on the bottom row, and the faces are line1 and line2,
// the same four colors the site uses for every mockup.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { varsityArtwork } from '../src/lib/varsity-artwork.js';
import { borderFor } from '../src/lib/colors.js';

// The same four inks the site gives every mockup (src/lib/cities.js), without
// pulling in that module's JSON import, which plain Node cannot load.
const shirtVars = (t) => ({ '--shirt': t.shirt, '--line1': t.line1, '--line2': t.line2, '--outline': t.outline, '--border': borderFor(t.shirt) });

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'artwork');
const WIDTH_IN = 12; // the PNG is this wide at 300 dpi; scale it down in the print editor
const DPI = 300;
const MARGIN = 6; // drawing units of clear space around the lettering, about 1.5%

// The hero layout on the homepage, drawn on a 600-wide canvas.
const LAYOUT = { x: 300, top: 8, width: 420, capHeight: 101, rowGap: 13 };

// Swap every var(--name, fallback) for the city's real color. Nested
// fallbacks (var(--border, var(--shirt, #000))) resolve from the inside out.
function bake(svg, vars) {
  const one = /var\(--([a-z0-9-]+)(?:\s*,\s*([^()]*))?\)/g;
  let out = svg;
  for (let i = 0; i < 5 && one.test(out); i++) {
    one.lastIndex = 0;
    out = out.replace(one, (m, name, fallback) => vars[`--${name}`] ?? (fallback ?? '').trim() ?? '#000000');
  }
  return out;
}

const wrap = (inner, viewBox, size = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${size}>${inner}</svg>`;

// Where the lettering actually is, by rendering it once and trimming the
// transparent edges. Returns a viewBox in drawing units with a margin.
async function tightViewBox(inner) {
  const probeScale = 4; // 2400 px wide probe, plenty for a bounding box
  const w = 600 * probeScale, h = 260 * probeScale;
  const probe = wrap(inner, '0 0 600 260', ` width="${w}" height="${h}"`);
  const { info } = await sharp(Buffer.from(probe)).png().trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
  const left = -info.trimOffsetLeft / probeScale, top = -info.trimOffsetTop / probeScale;
  const width = info.width / probeScale, height = info.height / probeScale;
  const x = left - MARGIN, y = top - MARGIN, vw = width + MARGIN * 2, vh = height + MARGIN * 2;
  return `${x.toFixed(2)} ${y.toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}`;
}

async function exportCity(team) {
  const vars = shirtVars(team);
  const inner = bake(varsityArtwork(LAYOUT), vars)
    // Explain the file to whoever opens it, and keep the site's version tag.
    .replace('<g class="varsity-artwork"', `<title>This Is Our Year, ${team.name} colors (${team.colors})</title><g class="varsity-artwork"`);
  const viewBox = await tightViewBox(inner);
  const [, , vw, vh] = viewBox.split(' ').map(Number);
  const heightIn = (WIDTH_IN * vh) / vw;

  const svg = wrap(inner, viewBox, ` width="${WIDTH_IN}in" height="${heightIn.toFixed(3)}in"`);
  const base = path.join(OUT, `this-is-our-year-${team.slug}`);
  await fs.writeFile(`${base}.svg`, svg + '\n');

  const px = Math.round(WIDTH_IN * DPI);
  const forPng = wrap(inner, viewBox, ` width="${px}" height="${Math.round((px * vh) / vw)}"`);
  await sharp(Buffer.from(forPng), { density: 72 }).png({ compressionLevel: 9 }).withMetadata({ density: DPI }).toFile(`${base}.png`);
  return { slug: team.slug, name: team.name, colors: team.colors, vars, px, heightIn };
}

async function main() {
  const teams = JSON.parse(await fs.readFile(path.join(root, 'src/data/teams.json'), 'utf8'));
  const only = process.argv[2];
  const list = only ? teams.filter((t) => t.slug === only) : teams;
  if (!list.length) throw new Error(`No city called "${only}" in src/data/teams.json`);
  await fs.mkdir(OUT, { recursive: true });
  const rows = [];
  for (const team of list) {
    const r = await exportCity(team);
    rows.push(r);
    console.log(`${team.slug.padEnd(20)} ${r.px} x ${Math.round((r.px * r.heightIn) / WIDTH_IN)} px, ${WIDTH_IN} x ${r.heightIn.toFixed(2)} in at ${DPI} dpi`);
  }
  if (!only) {
    const md = [
      '# This Is Our Year artwork: the inks, city by city',
      '',
      `Made by \`node scripts/export-artwork.mjs\`. Each city has an SVG (vector) and a PNG (${WIDTH_IN} in wide at ${DPI} dpi, transparent).`,
      'Top row: outline, dark keyline, face in line 1. Bottom row: outline, light keyline in line 1, face in line 2.',
      '',
      '| City | Colors | Shirt | Line 1 | Line 2 | Outline | Keyline |',
      '|---|---|---|---|---|---|---|',
      ...rows.map((r) => `| ${r.name} | ${r.colors} | ${r.vars['--shirt']} | ${r.vars['--line1']} | ${r.vars['--line2']} | ${r.vars['--outline']} | ${r.vars['--border']} |`),
      '',
    ].join('\n');
    await fs.writeFile(path.join(OUT, 'COLORS.md'), md);
  }
  console.log(`\nWrote ${rows.length} ${rows.length === 1 ? 'city' : 'cities'} to ${path.relative(root, OUT)}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
