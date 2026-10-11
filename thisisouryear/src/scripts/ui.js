// Bits of interface shared by the picker and the gift, set and league pages.
import { garmentSvg } from '../lib/garment.js';
import { dollars } from '../lib/shop-core.js';
import { data, shop, cities } from './shop-data.js';

export { dollars };

export const designById = (id) => data.catalog.designs.find((d) => d.id === id) ?? data.catalog.designs[0];
export const productFor = (style, audience) => shop.findProduct(style, audience);

// Redraws the garment for a style, fit and design. Colors come from CSS
// variables on a parent element, so changing city doesn't need a redraw.
export function drawGarment(holder, { style, audience, designId }, label = '') {
  if (!holder) return;
  holder.innerHTML = garmentSvg({ style, audience, lines: designById(designId).lines, label, decorative: !label });
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Builds the size buttons for an item. Nothing is ever pre-selected unless
// the shopper already chose that size and the new item also has it.
export function renderSizes(container, product, name, selected = '') {
  if (!container) return '';
  const variants = product?.variants ?? [];
  const keep = variants.some((v) => v.size === selected && v.inStock) ? selected : '';
  container.innerHTML = variants
    .map((v) => {
      const id = `${name}-${v.size}`.replace(/[^A-Za-z0-9_-]/g, '');
      const out = v.inStock ? '' : ' disabled';
      const label = v.inStock ? escapeHtml(v.size) : `${escapeHtml(v.size)}<small>Out</small>`;
      return `<label><input type="radio" name="${escapeHtml(name)}" id="${id}" value="${escapeHtml(v.size)}"${v.size === keep ? ' checked' : ''}${out} required><span>${label}</span></label>`;
    })
    .join('');
  return keep;
}

// "$19.99", "$19.99 to $21.99", or a plain statement that it isn't for sale.
export function priceLabel(product, size) {
  if (!product || !shop.isSellable(product)) return 'Not for sale yet';
  const v = product.variants.find((x) => x.size === size);
  if (v) return dollars(product.priceCents + (v.extraCents ?? 0));
  const range = shop.priceRange(product.id);
  return range.lowCents === range.highCents ? dollars(range.lowCents) : `From ${dollars(range.lowCents)}`;
}

// A note about sizes that cost more, built from the catalog. Empty if none do.
export function sizeNote(product) {
  if (!product || !shop.isSellable(product)) return '';
  const extra = product.variants.filter((v) => (v.extraCents ?? 0) > 0);
  if (!extra.length) return '';
  const amounts = [...new Set(extra.map((v) => v.extraCents))];
  if (amounts.length !== 1) return 'Some sizes cost more. The price updates when you pick one.';
  const names = extra.map((v) => v.size);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  return `${list} ${names.length > 1 ? 'are' : 'is'} ${dollars(amounts[0]).replace('.00', '')} more.`;
}

// Why an item can't be bought, in words a shopper can use.
export function unavailableText(product, found) {
  if (found.ok || found.code === 'size_required') return '';
  if (found.code === 'product_unavailable') {
    return `${product.name}s aren't for sale yet. You can still see how one would look in these colors.`;
  }
  return found.message;
}

export function fillCitySelect(select, { placeholder = 'Choose a city', selected = '' } = {}) {
  if (!select) return;
  select.innerHTML =
    `<option value="">${escapeHtml(placeholder)}</option>` +
    cities.map((c) => `<option value="${c.slug}"${c.slug === selected ? ' selected' : ''}>${escapeHtml(c.name)}, ${escapeHtml(c.colors)}</option>`).join('');
}

// The colored parts of the garment, in words.
export function legendText(city) {
  if (!city) return '';
  const n = city.names;
  const letters = n.line1 === n.line2 ? n.line1 : `${n.line1} and ${n.line2}`;
  return `Garment: ${n.shirt}. Lettering: ${letters}. Outline: ${n.outline}.`;
}

export function show(el, text) {
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
}

// Hides something without touching what's inside it. Use this, not show(),
// for elements that hold a link or other markup.
export function hide(el) {
  if (el) el.hidden = true;
}

export async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: json };
}
