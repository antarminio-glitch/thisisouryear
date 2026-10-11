// Draws the garment previews as SVG text. Plain strings in, plain strings out,
// so the exact same drawing code runs when the site is built and in the browser
// when someone changes a choice in the picker.
//
// A garment is a drawing unless a real photo of the blank is passed in (see
// src/lib/photos.js). Then the photo is shown with the lettering printed on it.
//
// Colors are never baked in. The drawing reads four CSS variables from whatever
// wraps it: --shirt, --line1, --line2, --outline.
//
// The lettering itself is the vector artwork in src/lib/varsity-artwork.js,
// rebuilt from the reference shirt, so it is the same shape everywhere.
import { varsityArtwork } from './varsity-artwork.js';

export const DEFAULT_LINES = ['THIS IS', 'OUR YEAR'];

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    varsityArtwork({ x: 300, top: 162, width: 244, capHeight: 59, rowGap: 9, lines })
  );
}

function hoodieSvg(lines) {
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
    varsityArtwork({ x: 300, top: 224, width: 224, capHeight: 54, rowGap: 9, lines })
  );
}

// A real photo of the blank garment, with the lettering placed on the chest.
// `photo` comes from garment-photos.json: { src, hex, print }. The hex is the
// fabric color measured from the photo where the print goes. The artwork's
// keyline is drawn in the shirt color, so inside the print that variable is
// set to the measured color and the fabric looks like it shows through.
function photoSvg(photo, lines) {
  const print = photo.print ?? { x: 300, top: 152, width: 236, capHeight: 57, rowGap: 9 };
  const { x, top, width, capHeight, rowGap } = print;
  return (
    `<image href="${esc(photo.src)}" x="0" y="0" width="600" height="600" preserveAspectRatio="xMidYMid meet"/>` +
    `<g class="print" style="--shirt:${esc(photo.hex ?? '')}">${varsityArtwork({ lines, x, top, width, capHeight, rowGap })}</g>`
  );
}

// One garment, any colors. `style` is "tee" or "hoodie". With a `photo` the
// real blank is shown (kids' photos are already kids-sized); without one,
// kids' items use the same drawing, a little smaller.
export function garmentSvg({ style = 'tee', audience = 'adult', lines = DEFAULT_LINES, label = '', decorative = false, className = '', photo = null } = {}) {
  const inner = photo ? photoSvg(photo, lines) : style === 'hoodie' ? hoodieSvg(lines) : teeSvg(lines);
  const body = audience === 'kids' && !photo ? `<g transform="translate(42 44) scale(0.86)">${inner}</g>` : inner;
  const a11y = decorative ? 'aria-hidden="true"' : `role="img" aria-label="${esc(label)}"`;
  const cls = ['shirt', `shirt-${style}`, photo ? 'shirt-real' : '', className].filter(Boolean).join(' ');
  return `<svg class="${cls}" viewBox="0 0 600 600" ${a11y}>${body}</svg>`;
}

// A photo of the blank on a model, with the lettering placed on the chest.
// `photo` comes from model-photos.json and `print` is the style's modelPrint
// in garments.json: the same placement for every color of a style, with a
// slight tilt so the print follows the body. Hero spots only.
export function modelPhotoSvg({ photo, print = null, lines = DEFAULT_LINES, label = '', decorative = false, className = '' } = {}) {
  const p = print ?? { x: 300, top: 300, width: 170, capHeight: 40, rowGap: 7, rotate: 0 };
  const cx = p.x;
  const cy = p.top + (p.capHeight * 2 + p.rowGap) / 2;
  const art = varsityArtwork({ lines, x: p.x, top: p.top, width: p.width, capHeight: p.capHeight, rowGap: p.rowGap });
  const a11y = decorative ? 'aria-hidden="true"' : `role="img" aria-label="${esc(label)}"`;
  const cls = ['shirt', 'shirt-model', className].filter(Boolean).join(' ');
  return (
    `<svg class="${cls}" viewBox="0 0 600 900" ${a11y}>` +
    `<image href="${esc(photo.src)}" x="0" y="0" width="600" height="900" preserveAspectRatio="xMidYMid meet"/>` +
    `<g class="print" style="--shirt:${esc(photo.hex ?? '')}" transform="rotate(${Number(p.rotate ?? 0)} ${cx} ${cy})">${art}</g>` +
    `</svg>`
  );
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
