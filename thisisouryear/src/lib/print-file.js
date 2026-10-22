// The print file: the lettering on its own, at print size, on a transparent
// background, in one city's colors. This is what a print-on-demand service
// (Printify) prints on the shirt.
//
// It's built when the site is built, at /print/<file>.png, from the site's
// own letter shapes (varsity-artwork.js) and the same four inks every mockup
// uses, so what's printed is what shoppers saw.
import { createHash } from 'node:crypto';
import { varsityArtwork } from './varsity-artwork.js';
import { borderFor } from './colors.js';

// Bump this when the drawing below changes in a way the SVG text doesn't show
// (the size, say), so every file gets a new address.
export const PRINT_VERSION = 2;
// The homepage hero layout, drawn on a 600 by 260 canvas.
const LAYOUT = { x: 300, top: 8, width: 420, capHeight: 101, rowGap: 13 };
const CANVAS = { w: 600, h: 260 };
// About 12 inches across at 300 dots per inch.
export const PRINT_WIDTH = 3600;

const inks = (team) => ({ '--shirt': team.shirt, '--line1': team.line1, '--line2': team.line2, '--outline': team.outline, '--border': borderFor(team.shirt) });

// Swaps every var(--name, fallback) for the city's real color, innermost
// first, so the file has plain colors a print shop can read.
function bake(svg, vars) {
  const one = /var\(--([a-z0-9-]+)(?:\s*,\s*([^()]*))?\)/g;
  let out = svg;
  for (let i = 0; i < 5 && /var\(--/.test(out); i++) out = out.replace(one, (m, name, fallback) => vars[`--${name}`] ?? (fallback ?? '#000000').trim());
  return out;
}

export function printSvg(team, design, scale = 1) {
  const inner = bake(varsityArtwork({ ...LAYOUT, lines: design.lines }), inks(team));
  const size = scale === 1 ? '' : ` width="${Math.round(CANVAS.w * scale)}" height="${Math.round(CANVAS.h * scale)}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS.w} ${CANVAS.h}"${size}>${inner}</svg>`;
}

// The file name changes whenever the drawing or a color does, so Printify
// never reuses an old file.
export function printFileName(team, design) {
  const hash = createHash('sha256').update(`${PRINT_VERSION};${PRINT_WIDTH};${printSvg(team, design)}`).digest('hex').slice(0, 8);
  return `${team.slug}-${design.id}-${hash}.png`;
}

// The finished PNG, trimmed tight to the lettering.
export async function printPng(team, design) {
  const { default: sharp } = await import('sharp');
  const svg = printSvg(team, design, PRINT_WIDTH / LAYOUT.width);
  return sharp(Buffer.from(svg), { density: 72 }).trim({ threshold: 0 }).png({ compressionLevel: 9 }).withMetadata({ density: 300 }).toBuffer();
}
