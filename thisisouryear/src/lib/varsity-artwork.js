// Original vector reconstruction from the customer's reference photograph.
// These are paths, not a guessed font: the layout is identical on every device.
// Coordinate units per glyph: cap height 140; widths vary per letter.
const GLYPHS = {
  T: { w: 100, d: 'M0 0H100V36H76V24H65V116H76V140H24V116H35V24H24V36H0Z' },
  H: { w: 100, d: 'M0 0H44V24H36V55H64V24H56V0H100V24H91V116H100V140H56V116H64V83H36V116H44V140H0V116H9V24H0Z' },
  I: { w: 44, d: 'M0 0H44V24H36V116H44V140H0V116H8V24H0Z' },
  S: { w: 86, d: 'M15 0H71L86 15V43H57V25H29V54H71L86 69V125L71 140H15L0 125V96H29V115H57V84H15L0 69V15Z' },
  O: { w: 76, d: 'M14 0H62L76 14V126L62 140H14L0 126V14ZM27 25V115H49V25Z' },
  U: { w: 86, d: 'M0 0H39V24H31V115H55V24H47V0H86V24H78V125L63 140H23L8 125V24H0Z' },
  R: { w: 88, d: 'M0 0H68L83 15V64L68 79L81 116H88V140H53L33 84H31V116H39V140H0V116H8V24H0ZM31 25V58H55V25Z' },
  Y: { w: 88, d: 'M0 0H40V24H33L44 57L55 24H48V0H88V24H81L58 81V116H68V140H20V116H30V81L7 24H0Z' },
  E: { w: 76, d: 'M0 0H76V42H51V25H31V55H57V83H31V115H51V97H76V140H0V116H8V24H0Z' },
  A: { w: 88, d: 'M24 0H64L81 116H88V140H49V116H56L53 96H34L31 116H39V140H0V116H7ZM38 71H50L44 32Z' },
  W: { w: 120, d: 'M0 0H40V24H32L43 99L55 40H65L77 99L88 24H80V0H120V24H112L94 140H68L60 104L52 140H26L8 24H0Z' },
  L: { w: 74, d: 'M0 0H42V24H31V115H49V93H74V140H0V116H8V24H0Z' },
  N: { w: 98, d: 'M0 0H35L66 82V24H58V0H98V24H90V140H64L32 59V116H40V140H0V116H8V24H0Z' },
  X: { w: 88, d: 'M0 0H38V24H32L44 51L56 24H50V0H88V24H80L59 69L81 116H88V140H49V116H55L44 89L33 116H39V140H0V116H7L29 69L8 24H0Z' },
  "'": { w: 18, d: 'M0 0H18V22L7 35H0L7 19H0Z' },
};

// Based on the reference: equal outside line widths, ~0.54 total height/width,
// cap-height matched between rows, and a narrow interline gap.
export const REFERENCE_LAYOUT = Object.freeze({ width: 236, capHeight: 57, rowGap: 9, top: 163, centerX: 300 });

function linePaths(text) {
  let x = 0;
  const paths = [];
  for (const char of text.toUpperCase()) {
    if (char === ' ') { x += 28; continue; }
    const g = GLYPHS[char];
    if (!g) throw new Error(`Unsupported artwork character: ${char}`);
    paths.push(`<path d="${g.d}" transform="translate(${x} 0)"/>`);
    x += g.w + 13;
  }
  return { paths: paths.join(''), width: Math.max(1, x - 13) };
}

export function varsityArtwork({ lines = ['THIS IS', 'OUR YEAR'], x = 300, top = 163, width = 236, capHeight = 57, rowGap = 9 } = {}) {
  return `<g class="varsity-artwork" data-artwork-version="reference-v1" fill-rule="evenodd" stroke-linejoin="miter" stroke-miterlimit="3">` + lines.slice(0, 2).map((text, i) => {
    const row = linePaths(text);
    const sx = width / (row.width + 16), sy = capHeight / 156;
    const transform = `translate(${x - width / 2 + sx * 8} ${top + i * (capHeight + rowGap) + sy * 8}) scale(${sx} ${sy})`;
    const fill = i === 0 ? 'var(--line1, #ffffff)' : 'var(--line2, #0c2340)';
    // Top row: silver outline / dark border / white face. Bottom row: silver / white / navy.
    // The dark border is --border, the palette's solid dark (the shirt color, darkened
    // when it is not dark enough), never the fabric showing through. The bottom face is
    // solid ink, never a transparent/hollow outline.
    const keyline = i === 0 ? 'var(--border, var(--shirt, #0c2340))' : 'var(--line1, #ffffff)';
    const keylineWidth = i === 0 ? 9 : 6;
    return `<g transform="${transform}">` +
      `<g fill="var(--outline, #a5acaf)" stroke="var(--outline, #a5acaf)" stroke-width="16">${row.paths}</g>` +
      `<g fill="${keyline}" stroke="${keyline}" stroke-width="${keylineWidth}">${row.paths}</g>` +
      `<g fill="${fill}" stroke="none">${row.paths}</g></g>`;
  }).join('') + '</g>';
}
