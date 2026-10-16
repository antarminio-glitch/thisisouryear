// The shop, in the browser. Reads the data block that ShopData.astro put on
// the page and builds the same rule set the server uses.
import { createShop } from '../lib/shop-core.js';
import { borderFor } from '../lib/colors.js';

const el = document.getElementById('shop-data');
export const data = el ? JSON.parse(el.textContent) : { cities: [], catalog: { products: [], designs: [] }, store: {}, approvals: {}, version: null, photos: { garments: {} } };
export const cities = data.cities;
export const shop = createShop({
  teams: cities,
  catalog: data.catalog,
  store: data.store,
  palettes: { version: data.version },
  approvals: data.approvals,
});

export const cityBySlug = (slug) => cities.find((c) => c.slug === slug);

// Paints an element in a city's colors.
export function paint(el, city) {
  if (!el || !city) return;
  el.style.setProperty('--shirt', city.shirt);
  el.style.setProperty('--line1', city.line1);
  el.style.setProperty('--line2', city.line2);
  el.style.setProperty('--outline', city.outline);
  el.style.setProperty('--border', borderFor(city.shirt));
}

export const FUNCTIONS = '/.netlify/functions';
