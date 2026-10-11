// Draws the garment previews as SVG text. Plain strings in, plain strings out,
// so the exact same drawing code runs when the site is built and in the browser
// when someone changes a choice in the picker.
//
// Every preview is a drawing, not a photo. Pages that show one label it as a
// concept preview.
//
// Colors are never baked in. The drawing reads four CSS variables from whatever
// wraps it: --shirt, --line1, --line2, --outline.

// Width of each character in the Graduate font, in thousandths of the letter
// size. Placing every letter by hand keeps the print the same shape on every
// device, even in the moment before the font file has loaded.
const ADVANCE = {
  A: 657, B: 684, C: 600, D: 690, E: 636, F: 596, G: 620, H: 792, I: 392, J: 540, K: 669, L: 556, M: 946,
  N: 812, O: 650, P: 624, Q: 650, R: 699, S: 600, T: 580, U: 740, V: 687, W: 1026, X: 649, Y: 607, Z: 596,
  ' ': 350, "'": 240, '.': 200, ',': 200, '!': 260, '-': 509, '&': 674,
};
const DIGIT = 650;

export const DEFAULT_LINES = ['THIS IS', 'OUR YEAR'];

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Width of a line of lettering, in units of the letter size.
export function lineWidth(text, track = 0.1) {
  const chars = [...String(text).toUpperCase()];
  return chars.reduce((sum, c) => sum + (ADVANCE[c] ?? DIGIT) / 1000, 0) + track * (chars.length - 1);
}

function place(text, x, size, track) {
  const chars = [...String(text).toUpperCase()];
  const widths = chars.map((c) => ((ADVANCE[c] ?? DIGIT) / 1000) * size);
  const total = widths.reduce((sum, w) => sum + w, 0) + track * size * (chars.length - 1);
  let cursor = x - total / 2;
  const centers = widths.map((w) => {
    const center = cursor + w / 2;
    cursor += w + track * size;
    return center.toFixed(2);
  });
  return { text: chars.join(''), xs: centers.join(' ') };
}

// The chest print: two stacked lines of block lettering with the classic
// athletic double outline. Each line is drawn three times, back to front:
//   1. a wide stroke in the outline color
//   2. a narrower stroke in the shirt color, which makes the gap
//   3. the letter itself
export function letteringSvg({
  x = 0, // horizontal center
  y = 0, // baseline of the first line
  size = 46, // letter size
  lines = DEFAULT_LINES,
  // The rest are multiples of the letter size.
  leading = 1.16, // distance between the two baselines
  track = 0.1, // extra space between letters, so the outlines have room
  weight = 0.025, // how much the letters are thickened
  gap = 0.045, // width of the shirt-colored gap
  rim = 0.05, // width of the outer outline
} = {}) {
  const fillStroke = (size * weight * 2).toFixed(2);
  const gapStroke = (size * (weight + gap) * 2).toFixed(2);
  const rimStroke = (size * (weight + gap + rim) * 2).toFixed(2);
  const fills = ['lt-1', 'lt-2'];

  const layers = lines
    .slice(0, 2)
    .map((line, i) => {
      const p = place(line, x, size, track);
      const at = `x="${p.xs}" y="${(y + i * size * leading).toFixed(2)}"`;
      const t = esc(p.text);
      return (
        `<text ${at} class="lt-rim" stroke-width="${rimStroke}">${t}</text>` +
        `<text ${at} class="lt-gap" stroke-width="${gapStroke}">${t}</text>` +
        `<text ${at} class="${fills[i]}" stroke-width="${fillStroke}">${t}</text>`
      );
    })
    .join('');
  return `<g class="lt" font-size="${size}">${layers}</g>`;
}

// Picks a letter size so the widest line fits the print area.
function fitSize(lines, maxWidth, maxSize) {
  const widest = Math.max(...lines.map((l) => lineWidth(l)));
  return Math.min(maxSize, Math.floor((maxWidth / (widest + 0.3)) * 10) / 10);
}

const TEE = {
  body: 'M238 46Q300 62 362 46L444 70Q462 75 474 88L572 190Q578 197 572 204L512 256Q505 261 499 254L458 208C462 330 465 460 462 560Q462 568 454 569Q300 580 146 569Q138 568 138 560C135 460 138 330 142 208L101 254Q95 261 88 256L28 204Q22 197 28 190L126 88Q138 75 156 70Z',
  sleeveL: 'M156 70Q138 75 126 88L28 190Q22 197 28 204L88 256Q95 261 101 254L142 208Q130 140 152 71Z',
  sleeveR: 'M444 70Q462 75 474 88L572 190Q578 197 572 204L512 256Q505 261 499 254L458 208Q470 140 448 71Z',
  neck: 'M238 46Q300 62 362 46C352 100 248 100 238 46Z',
  collar: 'M236 50C248 107 352 107 364 50',
};

const HOODIE = {
  body: 'M216 96C214 24 386 24 384 96L446 114C500 150 528 300 548 428L551 452Q552 460 544 462L498 472Q490 473 488 465L484 446C472 360 456 290 438 236C442 330 444 440 442 546Q442 554 434 555Q300 566 166 555Q158 554 158 546C156 440 158 330 162 236C144 290 128 360 116 446L112 465Q110 473 102 472L56 462Q48 460 49 452L52 428C72 300 100 150 154 114Z',
  sleeveL: 'M154 114C100 150 72 300 52 428L49 452Q48 460 56 462L102 472Q110 473 112 465L116 446C128 360 144 290 162 236Q150 170 172 108Z',
  sleeveR: 'M446 114C500 150 528 300 548 428L551 452Q552 460 544 462L498 472Q490 473 488 465L484 446C472 360 456 290 438 236Q450 170 428 108Z',
  hoodInside: 'M240 100C240 52 360 52 360 100C340 126 260 126 240 100Z',
  pocket: 'M224 428L376 428L404 506Q406 512 400 512L200 512Q194 512 196 506Z',
};

function teeSvg(lines) {
  const size = fitSize(lines, 290, 48);
  return (
    `<path class="tee-fill" d="${TEE.body}"/>` +
    `<g clip-path="url(#tee-clip)">` +
    `<path d="${TEE.body}" fill="url(#tee-form)"/><path d="${TEE.body}" fill="url(#tee-drop)"/>` +
    `<path d="${TEE.sleeveL}" fill="url(#tee-sleeve-l)"/><path d="${TEE.sleeveR}" fill="url(#tee-sleeve-r)"/>` +
    `<path class="tee-fold" d="M200 572Q212 480 194 392"/><path class="tee-fold" d="M404 572Q392 486 408 410"/>` +
    `<path class="tee-lift" d="M222 572Q232 492 218 420"/>` +
    `<path class="tee-seam" d="M152 71Q130 140 142 208M448 71Q470 140 458 208"/>` +
    `<path class="tee-seam-hi" d="M154.500 72Q132.500 140 144.500 208M445.500 72Q467.500 140 455.500 208"/>` +
    `<path class="tee-stitch" d="M37 181L105 243M563 181L495 243M139 551Q300 562 461 551"/>` +
    `<path class="tee-stitch-hi" d="M36 183L104 245M564 183L496 245M139 553Q300 564 461 553"/>` +
    `<path class="tee-fill" d="${TEE.neck}"/><path class="tee-neck-shade" d="${TEE.neck}"/>` +
    `<path class="tee-collar" d="${TEE.collar}"/><path class="tee-collar-hi" d="${TEE.collar}"/>` +
    `<path class="tee-seam" d="M231 54C243 118 357 118 369 54"/><path class="tee-seam-hi" d="M240 48C251 98 349 98 360 48"/>` +
    `</g>` +
    `<path class="tee-edge" d="${TEE.body}"/>` +
    letteringSvg({ x: 300, y: 262, size, lines })
  );
}

function hoodieSvg(lines) {
  const size = fitSize(lines, 252, 42);
  return (
    `<path class="tee-fill" d="${HOODIE.body}"/>` +
    `<g clip-path="url(#hood-clip)">` +
    `<path d="${HOODIE.body}" fill="url(#hood-form)"/><path d="${HOODIE.body}" fill="url(#tee-drop)"/>` +
    `<path d="${HOODIE.sleeveL}" fill="url(#hood-sleeve-l)"/><path d="${HOODIE.sleeveR}" fill="url(#hood-sleeve-r)"/>` +
    // hood opening, then the seam where the hood meets the body
    `<path class="tee-fill" d="${HOODIE.hoodInside}"/><path class="tee-neck-shade" d="${HOODIE.hoodInside}"/>` +
    `<path class="tee-seam" d="M218 98C246 138 354 138 382 98"/><path class="tee-seam-hi" d="M220 101C248 141 352 141 380 101"/>` +
    // sleeve seams, cuffs, waistband
    `<path class="tee-seam" d="M172 108Q150 170 162 236M428 108Q450 170 438 236"/>` +
    `<path class="tee-seam-hi" d="M174.500 109Q152.500 170 164.500 236M425.500 109Q447.500 170 435.500 236"/>` +
    `<path class="tee-stitch" d="M55 432L115 446M545 432L485 446M159 522Q300 532 441 522"/>` +
    `<path class="tee-stitch-hi" d="M55 434L115 448M545 434L485 448M159 524Q300 534 441 524"/>` +
    // front pocket
    `<path class="hood-pocket" d="${HOODIE.pocket}"/><path class="tee-seam" d="${HOODIE.pocket}"/>` +
    `<path class="tee-seam-hi" d="M226 431L374 431"/>` +
    // drawstrings
    `<path class="hood-cord" d="M270 122C268 150 272 176 266 204M330 122C332 150 328 176 334 204"/>` +
    `<path class="hood-tip" d="M266 204L265 216M334 204L335 216"/>` +
    `</g>` +
    `<path class="tee-edge" d="${HOODIE.body}"/>` +
    letteringSvg({ x: 300, y: 292, size, lines })
  );
}

// One garment, any colors. `style` is "tee" or "hoodie". Kids' items use the
// same drawing, a little smaller.
export function garmentSvg({ style = 'tee', audience = 'adult', lines = DEFAULT_LINES, label = '', decorative = false, className = '' } = {}) {
  const inner = style === 'hoodie' ? hoodieSvg(lines) : teeSvg(lines);
  const body = audience === 'kids' ? `<g transform="translate(42 44) scale(0.86)">${inner}</g>` : inner;
  const a11y = decorative ? 'aria-hidden="true"' : `role="img" aria-label="${esc(label)}"`;
  const cls = ['shirt', `shirt-${style}`, className].filter(Boolean).join(' ');
  return `<svg class="${cls}" viewBox="0 0 600 600" ${a11y}>${body}</svg>`;
}

// Shared shading for every garment on the page. Included once by the layout.
// It is only black and white at low opacity, so it works over any color.
export function defsSvg() {
  const stops = (list) => list.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"></stop>`).join('');
  const form = stops([[0, '#000', 0.26], [0.16, '#000', 0], [0.42, '#fff', 0.09], [0.6, '#fff', 0.04], [0.86, '#000', 0], [1, '#000', 0.26]]);
  const sleeve = stops([[0, '#000', 0.3], [0.55, '#000', 0.06], [1, '#fff', 0.1]]);
  return (
    `<svg class="shirt-defs" aria-hidden="true" focusable="false" width="0" height="0"><defs>` +
    `<linearGradient id="tee-form" gradientUnits="userSpaceOnUse" x1="138" y1="0" x2="462" y2="0">${form}</linearGradient>` +
    `<linearGradient id="hood-form" gradientUnits="userSpaceOnUse" x1="158" y1="0" x2="442" y2="0">${form}</linearGradient>` +
    `<linearGradient id="tee-drop" gradientUnits="userSpaceOnUse" x1="0" y1="46" x2="0" y2="575">${stops([[0, '#fff', 0.1], [0.3, '#fff', 0], [0.7, '#000', 0], [1, '#000', 0.18]])}</linearGradient>` +
    `<linearGradient id="tee-sleeve-l" gradientUnits="userSpaceOnUse" x1="60" y1="225" x2="150" y2="130">${sleeve}</linearGradient>` +
    `<linearGradient id="tee-sleeve-r" gradientUnits="userSpaceOnUse" x1="540" y1="225" x2="450" y2="130">${sleeve}</linearGradient>` +
    `<linearGradient id="hood-sleeve-l" gradientUnits="userSpaceOnUse" x1="70" y1="400" x2="165" y2="180">${sleeve}</linearGradient>` +
    `<linearGradient id="hood-sleeve-r" gradientUnits="userSpaceOnUse" x1="530" y1="400" x2="435" y2="180">${sleeve}</linearGradient>` +
    `<clipPath id="tee-clip"><path d="${TEE.body}"></path></clipPath>` +
    `<clipPath id="hood-clip"><path d="${HOODIE.body}"></path></clipPath>` +
    `</defs></svg>`
  );
}
