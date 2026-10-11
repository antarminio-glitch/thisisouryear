// Small helpers for showing a city's colors in words.
import teams from '../data/teams.json';
import palettes from '../data/palettes.json';
import { borderFor } from './colors.js';

export { teams };

export const cityBySlug = (slug) => teams.find((t) => t.slug === slug);

// "Los Angeles (Royal)" reads better in a sentence as just "Los Angeles".
export const placeName = (team) => team.name.replace(/\s*\(.*\)$/, '');

// Plain-English name for each colored part of the garment. Uses the palette
// name where the color is linked to one, and the store's own label otherwise.
export function colorNames(team) {
  const rows = palettes.colorways?.[team.slug]?.colors ?? [];
  const fromPalette = (surface) => rows.find((r) => r.key === team.apply?.[surface])?.label ?? null;
  const labels = team.colors.split('/').map((s) => s.trim());
  const sameAsShirt = team.line2.toUpperCase() === team.shirt.toUpperCase();
  const fallback = {
    shirt: labels[0],
    line1: 'White',
    line2: sameAsShirt ? labels[0] : (labels[1] ?? labels[0]),
    outline: sameAsShirt ? (labels[1] ?? 'Accent') : 'Accent',
  };
  const tidy = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return Object.fromEntries(['shirt', 'line1', 'line2', 'outline'].map((s) => [s, tidy(fromPalette(s) ?? fallback[s])]));
}

export const shirtVars = (t) => ({ '--shirt': t.shirt, '--line1': t.line1, '--line2': t.line2, '--outline': t.outline, '--border': borderFor(t.shirt) });

// What the search boxes match: the city name plus any nearby places listed
// under "aka" in teams.json.
export const searchText = (t) => [t.name, ...(t.aka ?? [])].join(' ').toLowerCase();
