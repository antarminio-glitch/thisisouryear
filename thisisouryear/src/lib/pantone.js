// Pantone references to screen colors, for matching a city's shirt to the
// vendor's blanks. Pantone publishes an sRGB value for every solid coated
// color; these are those values for the references the color data uses.
// A reference that isn't in this table gives null, and the caller falls back
// to the city's own hex.
//
// Plain functions, no imports, so the fetch script and the tests share them.

const SOLID_COATED = {
  '186 C': '#C8102E',
  '187 C': '#A6192E',
  '194 C': '#9D2235',
  '268 C': '#582C83',
  '273 C': '#24135F',
  '285 C': '#0072CE',
  '287 C': '#003087',
  '289 C': '#0C2340',
  '316 C': '#00505C',
  '321 C': '#008C95',
  '343 C': '#115740',
  '654 C': '#003A70',
  '2196 C': '#0076B6',
  '2736 C': '#1E22AA',
  '2758 C': '#001E62',
  '3155 C': '#006271',
  '5395 C': '#081F2C',
  '5535 C': '#183028',
  '7421 C': '#651D32',
  'BLACK C': '#2D2926',
  'BLACK 6 C': '#101820',
  'PROCESS BLACK C': '#27251F',
};

// "PMS 289C", "289 c", "289" and "Pantone 289 C" all mean the same thing.
export function normalizePantone(code) {
  if (code == null) return null;
  let s = String(code).trim().toUpperCase().replace(/^(PMS|PANTONE)\s+/, '').replace(/\s+/g, ' ');
  if (!s) return null;
  if (/^[0-9]+C$/.test(s)) s = s.replace(/C$/, ' C');
  if (/^[0-9]+$/.test(s)) s = `${s} C`;
  if (/^BLACK ?[0-9]*$/.test(s)) s = `${s.replace(/ ?([0-9]+)$/, ' $1')} C`.replace('  ', ' ');
  return s;
}

export function pantoneToHex(code) {
  const key = normalizePantone(code);
  return key ? (SOLID_COATED[key] ?? null) : null;
}

// The Pantone reference for a city's shirt: the city's own `pantone` field in
// teams.json first, otherwise the palette row its `apply.shirt` points at.
export function shirtPantone(team, palettes = null) {
  if (team?.pantone) return String(team.pantone);
  const rows = palettes?.colorways?.[team?.slug]?.colors ?? [];
  return rows.find((r) => r.key === team?.apply?.shirt)?.pantone ?? null;
}

// The color to match blanks against: the Pantone reference's sRGB value when
// there is one we know, else the hex the site shows. Says which it used.
export function shirtHexFor(team, palettes = null) {
  const pantone = shirtPantone(team, palettes);
  const hex = pantoneToHex(pantone);
  if (hex) return { hex, pantone: normalizePantone(pantone), source: 'pantone' };
  return { hex: team.shirt, pantone: pantone ? normalizePantone(pantone) : null, source: pantone ? 'hex (pantone not in table)' : 'hex (no pantone)' };
}
