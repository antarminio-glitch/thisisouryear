// Draws the share card for a city: a 1200 x 630 picture used when a page is
// shared, and offered as a download on the page.
//
// It runs when the site is built, not in the browser. Letters are turned into
// outlines here, so the picture looks the same no matter what fonts the
// machine building the site has installed.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as fontkit from 'fontkit';
import { themeFor } from './colors.js';
import { DEFAULT_LINES } from './garment.js';

const fontDir = path.join(process.cwd(), 'public', 'fonts');
let fonts;
function loadFonts() {
  fonts ??= {
    block: fontkit.openSync(path.join(fontDir, 'graduate.woff2')),
    text: fontkit.openSync(path.join(fontDir, 'barlow-semi-condensed-600.woff2')),
    light: fontkit.openSync(path.join(fontDir, 'barlow-semi-condensed-400.woff2')),
  };
  return fonts;
}

function measure(font, text, size, track = 0) {
  const run = font.layout(text);
  return run.glyphs.reduce((w, g) => w + (g.advanceWidth / font.unitsPerEm) * size, 0) + track * size * Math.max(0, run.glyphs.length - 1);
}

// Turns a line of text into an SVG path. `anchor` is "start" or "middle".
function textPath(font, text, x, y, size, { anchor = 'start', track = 0 } = {}) {
  const scale = size / font.unitsPerEm;
  let cursor = anchor === 'middle' ? x - measure(font, text, size, track) / 2 : x;
  let d = '';
  for (const g of font.layout(text).glyphs) {
    d += g.path.scale(scale, -scale).translate(cursor, y).toSVG();
    cursor += g.advanceWidth * scale + track * size;
  }
  return d;
}

function wrap(font, text, size, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(font, next, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A short fingerprint of everything that appears on the card. It goes in the
// file name, so when the counter ticks over or a color changes the card gets
// a new address and old copies can't linger in caches.
export function cardKey(team, counterText, lines = DEFAULT_LINES, version = '') {
  const input = JSON.stringify([team.slug, team.name, team.colors, team.shirt, team.line1, team.line2, team.outline, counterText, lines, version, 'card-v1']);
  return createHash('sha1').update(input).digest('hex').slice(0, 8);
}

export const cardPath = (team, counterText, lines, version) => `/og/${team.slug}-${cardKey(team, counterText, lines, version)}.png`;

export function cardAlt(team, counterText, lines = DEFAULT_LINES) {
  return `${lines.join(' ')} in block letters, in ${team.name} colors (${team.colors}). ${counterText}`;
}

export function cardSvg(team, counterText, lines = DEFAULT_LINES, siteHost = 'thisisouryear.team') {
  const { block, text, light } = loadFonts();
  const theme = themeFor(team);
  const bg = theme['--bg'];
  const fg = theme['--on-bg'];
  const W = 1200;
  const H = 630;

  // Lettering, sized so the wider line fills most of the card.
  const track = 0.1;
  const widest = Math.max(...lines.map((l) => measure(block, l, 1, track)));
  const size = Math.min(150, 980 / (widest + 0.3));
  const weight = 0.025 * size;
  const gap = 0.045 * size;
  const rim = 0.05 * size;
  const top = 78 + size * 0.75;
  const fills = [team.line1, team.line2];
  const lettering = lines
    .slice(0, 2)
    .map((line, i) => {
      const d = textPath(block, line, W / 2, top + i * size * 1.16, size, { anchor: 'middle', track });
      return (
        `<path d="${d}" fill="${team.outline}" stroke="${team.outline}" stroke-width="${((weight + gap + rim) * 2).toFixed(2)}" stroke-linejoin="round"/>` +
        `<path d="${d}" fill="${team.shirt}" stroke="${team.shirt}" stroke-width="${((weight + gap) * 2).toFixed(2)}" stroke-linejoin="round"/>` +
        `<path d="${d}" fill="${fills[i]}" stroke="${fills[i]}" stroke-width="${(weight * 2).toFixed(2)}" stroke-linejoin="round"/>`
      );
    })
    .join('');

  // The counter line, wrapped to at most three lines.
  // Each sentence starts on its own line.
  // The type shrinks a little before a long sentence is allowed to wrap.
  const sentences = counterText.match(/[^.!?]+[.!?]+/g)?.map((x) => x.trim()) ?? [counterText];
  const longest = Math.max(...sentences.map((x) => measure(text, x, 40)));
  const lineSize = Math.max(32, Math.min(40, Math.floor((40 * 1060) / longest)));
  const wrapped = sentences.flatMap((sentence) => wrap(text, sentence, lineSize, 1064)).slice(0, 3);
  const firstBaseline = top + size * 1.16 + size * 0.12 + (wrapped.length > 2 ? 46 : 58);
  const counter = wrapped
    .map((l, i) => `<path d="${textPath(text, l, W / 2, firstBaseline + i * 48, lineSize, { anchor: 'middle' })}" fill="${fg}"/>`)
    .join('');

  const label = `${team.name}, ${team.colors}`;
  const footY = H - 40;
  const foot =
    `<path d="${textPath(light, label, 60, footY, 28)}" fill="${fg}" fill-opacity="0.82"/>` +
    `<path d="${textPath(light, siteHost, W - 60 - measure(light, siteHost, 28), footY, 28)}" fill="${fg}" fill-opacity="0.82"/>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<title>${esc(cardAlt(team, counterText, lines))}</title>` +
    `<rect width="${W}" height="${H}" fill="${bg}"/>` +
    `<rect x="60" y="${H - 88}" width="${W - 120}" height="1.5" fill="${fg}" fill-opacity="0.25"/>` +
    lettering +
    counter +
    foot +
    `</svg>`
  );
}

export async function cardPng(team, counterText, lines, siteHost) {
  const { default: sharp } = await import('sharp');
  return sharp(Buffer.from(cardSvg(team, counterText, lines, siteHost))).png({ compressionLevel: 9 }).toBuffer();
}

// Keeps a copy of the card as a plain file too, for anyone who wants it.
export function writeCardSvg(dir, team, counterText) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${team.slug}.svg`), cardSvg(team, counterText));
}
