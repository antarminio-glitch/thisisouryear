// The print file: the lettering on its own, at print size, on a transparent
// background, in one city's colors. This is what a print-on-demand service
// (Printify) prints on the shirt.
//
// It's built when the site is built, at /print/<file>.png, from the same
// letter shapes as the share cards, so it matches what shoppers see.
//
// The gap between the letters and the outer outline is cut out, not printed
// in the shirt's color. That way the real shirt shows through and there's no
// mismatched ring of ink around the letters.
import { createHash } from 'node:crypto';
import { loadFonts, measure, textPath } from './og.js';

// Bump this when the drawing below changes, so every file gets a new address
// and the print service fetches the new one.
export const PRINT_VERSION = 1;
// Pixels across for the widest line, at 300 dots per inch about 11 inches.
const LETTER_WIDTH = 3300;

const sameColor = (a, b) => String(a).toUpperCase() === String(b).toUpperCase();

export function printFileName(team, design) {
  const key = [PRINT_VERSION, team.slug, team.shirt, team.line1, team.line2, team.outline, design.id, design.lines.join('|')].join(';');
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 8);
  return `${team.slug}-${design.id}-${hash}.png`;
}

export function printSvg(team, design) {
  const { block } = loadFonts();
  const lines = design.lines.slice(0, 2);
  const track = 0.1;
  const widest = Math.max(...lines.map((l) => measure(block, l, 1, track)));
  const size = LETTER_WIDTH / widest;
  const weight = 0.025 * size;
  const gap = 0.045 * size;
  const rim = 0.05 * size;
  const pad = Math.ceil((weight + gap + rim) * 2);
  const W = Math.ceil(LETTER_WIDTH + pad * 2);
  const top = pad + size * 0.78;
  const H = Math.ceil(top + size * 1.16 + size * 0.1 + pad);
  const fills = [team.line1, team.line2];
  const paths = lines.map((line, i) => textPath(block, line, W / 2, top + i * size * 1.16, size, { anchor: 'middle', track }));
  const stroke = (d, width, color) => `<path d="${d}" fill="${color}" stroke="${color}" stroke-width="${width.toFixed(2)}" stroke-linejoin="round"/>`;
  // The outer outline, with the gap cut out of it.
  const cut = paths.map((d) => stroke(d, (weight + gap) * 2, '#000')).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs><mask id="gap" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>${cut}</mask></defs>` +
    `<g mask="url(#gap)">${paths.map((d) => stroke(d, (weight + gap + rim) * 2, team.outline)).join('')}</g>` +
    // A line drawn in the shirt's own color is left unprinted, so the shirt
    // itself shows through and the letters read as outlines.
    paths.map((d, i) => (sameColor(fills[i], team.shirt) ? '' : stroke(d, weight * 2, fills[i]))).join('') +
    `</svg>`
  );
}

// The finished PNG, trimmed to the lettering.
export async function printPng(team, design) {
  const { default: sharp } = await import('sharp');
  return sharp(Buffer.from(printSvg(team, design)), { density: 72 })
    .trim({ threshold: 0 })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
