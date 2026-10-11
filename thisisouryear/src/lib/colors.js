// Color helpers. Everything here runs at build time, so the browser gets
// plain colors with the contrast decisions already made.

const WHITE = '#FFFFFF';
const INK = '#0B0C0E';
const READABLE = 4.5; // the usual accessibility bar for normal-size text

function toRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function toHex(rgb) {
  return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// Blend two colors. amount = 1 gives all of "a", 0 gives all of "b".
export function mix(a, b, amount) {
  const [ra, rb] = [toRgb(a), toRgb(b)];
  return toHex(ra.map((v, i) => v * amount + rb[i] * (1 - amount)));
}

export function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Contrast ratio between two colors, from 1 (identical) to 21 (black on white).
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Picks readable text for a background: white if it works, dark if that works
// instead. A few in-between colors are readable with neither, so those get
// darkened a touch until white text passes.
export function readableOn(color) {
  let bg = color;
  for (let i = 0; i < 40; i++) {
    if (contrast(bg, WHITE) >= READABLE) return { bg, text: WHITE };
    if (contrast(bg, INK) >= READABLE) return { bg, text: INK };
    bg = mix(bg, '#000000', 0.97);
  }
  return { bg, text: WHITE };
}

// Quieter text for secondary lines: the text color pulled toward the
// background, but never so far that it gets hard to read.
function softText(bg, text) {
  for (let amount = 0.72; amount < 1; amount += 0.04) {
    const candidate = mix(text, bg, amount);
    if (contrast(candidate, bg) >= READABLE) return candidate;
  }
  return text;
}

// The solid dark border around the first line of lettering: the shirt color,
// or the shirt color darkened until it clearly separates white letters from
// the outline. Never the fabric showing through.
export function borderFor(shirt) {
  let color = shirt;
  for (let i = 0; i < 40 && contrast(color, WHITE) < 6; i++) color = mix(color, '#000000', 0.94);
  return color;
}

// Turns a city's four colors into the full set of page colors.
export function themeFor(team) {
  const page = readableOn(team.shirt);

  // The button color is the first of the city's other colors that actually
  // stands out against the page. Falls back to the page's text color.
  const pick = [team.line2, team.outline, team.line1].find((c) => contrast(c, page.bg) >= 3) ?? page.text;
  const button = readableOn(pick);

  return {
    '--bg': page.bg,
    '--on-bg': page.text,
    '--soft': softText(page.bg, page.text),
    '--accent': button.bg,
    '--on-accent': button.text,
    '--shirt': team.shirt,
    '--line1': team.line1,
    '--line2': team.line2,
    '--outline': team.outline,
    '--border': borderFor(team.shirt),
  };
}

export function styleString(vars) {
  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}
