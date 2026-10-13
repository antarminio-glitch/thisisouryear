// Runs the picker: choose a city, a garment and a size, watch the preview
// change, then add it to the cart.
//
// Rules it keeps:
//   - A size is never chosen for you.
//   - If an item can't be bought, you can still look at it, and it says why.
//   - Your choices live in the page address, so the back button and shared
//     links work.
import { data, shop, cities, cityBySlug, paint, FUNCTIONS } from './shop-data.js';
import { drawPlayerSpotlight } from './player-spotlights.js';
import { addItems } from './cart.js';
import { track } from './analytics.js';
import { orderPath } from '../lib/order-links.js';
import { dollars } from '../lib/shop-core.js';
import { drawGarment, renderSizes, priceLabel, sizeNote, unavailableText, legendText, designById, productFor, show, postJson, hide } from './ui.js';

const DEFAULTS = { style: 'tee', audience: 'adult', designId: 'this-is-our-year', size: '' };

export function initPicker(root) {
  if (!root || root.dataset.ready) return;
  root.dataset.ready = 'true';
  const $ = (sel) => root.querySelector(sel);
  const locked = root.dataset.lock === 'true';
  const syncUrl = root.dataset.syncUrl !== 'false';
  const group = root.dataset.group;

  const state = { slug: root.dataset.city || '', ...DEFAULTS };
  let checkoutInFlight = false;

  // ---- reading and writing the page address
  function fromUrl() {
    const q = new URLSearchParams(window.location.search);
    const next = { ...DEFAULTS, slug: locked ? state.slug : '' };
    if (!locked && cityBySlug(q.get('city'))) next.slug = q.get('city');
    if (['tee', 'hoodie'].includes(q.get('style'))) next.style = q.get('style');
    if (['adult', 'kids'].includes(q.get('fit'))) next.audience = q.get('fit');
    if (shop.design(q.get('design'))) next.designId = q.get('design');
    const product = productFor(next.style, next.audience);
    if (product?.variants.some((v) => v.size === q.get('size'))) next.size = q.get('size');
    return next;
  }
  function toUrl(push) {
    if (!syncUrl) return;
    const q = new URLSearchParams();
    const current = new URLSearchParams(window.location.search);
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid']) {
      if (current.has(key)) q.set(key, current.get(key));
    }
    if (!locked && state.slug) q.set('city', state.slug);
    if (state.style !== DEFAULTS.style) q.set('style', state.style);
    if (state.audience !== DEFAULTS.audience) q.set('fit', state.audience);
    if (state.designId !== DEFAULTS.designId) q.set('design', state.designId);
    if (state.size) q.set('size', state.size);
    const url = `${window.location.pathname}${q.toString() ? `?${q}` : ''}${window.location.hash}`;
    if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
    window.history[push ? 'pushState' : 'replaceState']({ picker: true }, '', url);
  }

  // ---- drawing the current choice
  function describe() {
    const city = cityBySlug(state.slug);
    const product = productFor(state.style, state.audience);
    const design = designById(state.designId);
    if (!city) return 'Pick a city to see it in your colors.';
    return `${city.name}, ${city.colors}. ${design.name} ${product.name.toLowerCase()}${state.size ? `, size ${state.size}` : ''}.`;
  }

  function render({ sizesChanged = false } = {}) {
    const city = cityBySlug(state.slug);
    const product = productFor(state.style, state.audience);
    const stage = $('[data-stage]');
    if (city) paint(stage, city);
    stage?.classList.toggle('is-neutral', !city);

    const label = city ? `${designById(state.designId).name} ${product.name.toLowerCase()} in ${city.name} colors, ${city.colors}` : '';
    drawGarment($('[data-garment]'), state, label);
    drawPlayerSpotlight($('[data-player-spotlight]'), data.playerSpotlights, state.slug);

    const options = $('[data-garment-options]');
    if (options) options.hidden = !city;
    root.querySelectorAll('[data-preview-style]').forEach((button) => {
      const selected = button.dataset.previewStyle === state.style && button.dataset.previewFit === state.audience;
      button.setAttribute('aria-pressed', String(selected));
      const image = button.querySelector('[data-option-image]');
      if (city) paint(image, city);
      drawGarment(image, { style: button.dataset.previewStyle, audience: button.dataset.previewFit, designId: state.designId, slug: state.slug, caption: false });
    });

    if (sizesChanged) state.size = renderSizes($('[data-sizes]'), product, `${group}-size`, state.size);
    const sizesWrap = $('[data-size-field]');
    if (sizesWrap) sizesWrap.hidden = !shop.isSellable(product);
    const chart = $('[data-size-chart]');
    if (chart) {
      chart.hidden = !product.sizeChart;
      if (product.sizeChart) chart.href = product.sizeChart;
    }
    show($('[data-size-note]'), sizeNote(product));

    show($('[data-summary]'), describe());
    const cityDetails = $('[data-city-details]');
    if (cityDetails) {
      cityDetails.open = !city;
      show($('[data-city-change]'), city ? `${city.name} colors · Change city` : 'Choose your city');
    }
    show($('[data-legend]'), legendText(city));
    const price = priceLabel(product, state.size);
    root.querySelectorAll('[data-price]').forEach((el) => (el.textContent = price));

    const found = shop.availability({ productId: product.id, designId: state.designId, slug: state.slug, size: state.size });
    const why = !city ? '' : unavailableText(product, found);
    show($('[data-availability]'), why);

    const canPickSize = !!city && (found.ok || found.code === 'size_required');
    const add = $('[data-add]');
    const buy = $('[data-buy]');
    for (const b of [add, buy]) {
      if (!b) continue;
      // Stay clickable while only a size is missing, so the click can say so.
      b.disabled = !canPickSize || checkoutInFlight;
    }
    const variant = product.variants.find((v) => v.size === state.size);
    const estimate = shop.isSellable(product) ? product.priceCents + (variant?.extraCents ?? 0) + shop.store.shippingCents : null;
    show($('[data-order-total]'), city && estimate !== null ? `${state.size ? 'One item' : 'From'} ${dollars(estimate)} with shipping, before tax.` : '');
    const quick = $('[data-quick-checkout]');
    if (quick) quick.hidden = !city || !found.ok;
    show($('[data-quick-total]'), estimate !== null ? dollars(estimate) : '');
    const quickBuy = $('[data-quick-buy]');
    if (quickBuy) quickBuy.disabled = !found.ok || checkoutInFlight;
    const share = $('[data-share-wrap]');
    if (share) share.hidden = !city;
    show($('[data-share-status]'), '');
    const fallback = $('[data-order-link]');
    if (fallback) fallback.hidden = true;
    const extra = $('[data-extra-item]');
    if (extra) extra.hidden = true;
    if (city) {
      const another = $('[data-another]');
      if (another) another.href = orderPath(state);
      const matching = $('[data-matching]');
      if (matching) {
        matching.href = `/matching-sets/?${new URLSearchParams({ city: state.slug })}`;
        matching.hidden = state.audience !== 'adult' || !shop.isSellable(shop.product('kids-tee'));
      }
    }
    const hidden = $('input[name="slug"]');
    if (hidden) hidden.value = state.slug;
    hide($('[data-added]'));
    show($('[data-msg]'), '');

    // Reflect the state in the form controls (needed after back/forward).
    const check = (name, value) => root.querySelectorAll(`input[name="${group}-${name}"]`).forEach((r) => (r.checked = r.value === value));
    check('city', state.slug);
    check('style', state.style);
    check('fit', state.audience);
    check('design', state.designId);
    check('size', state.size);

    // Anything else on the page that follows the picker (the "About" block on
    // city pages) listens for this.
    root.dispatchEvent(new CustomEvent('picker-change', { bubbles: true, detail: { product, city, state: { ...state } } }));
  }

  function change(patch, { push = true } = {}) {
    const before = { ...state };
    Object.assign(state, patch);
    const productChanged = before.style !== state.style || before.audience !== state.audience;
    render({ sizesChanged: productChanged });
    if (patch.slug && $('[data-city-details]')) $('[data-city-change]')?.focus();
    toUrl(push);
    if (patch.slug && patch.slug !== before.slug) track('team_selected', { team_id: state.slug });
    else if (patch.size && patch.size !== before.size) track('size_selected', { size: state.size, product_style: state.style, audience: state.audience });
    else track('preview_changed', { team_id: state.slug, product_style: state.style, audience: state.audience, design_id: state.designId });
  }

  // ---- city search
  const search = $('[data-city-search]');
  const options = [...root.querySelectorAll('[data-city-opt]')];
  search?.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const o of options) {
      const hit = !q || (o.dataset.search ?? '').includes(q);
      o.hidden = !hit;
      if (hit) shown++;
    }
    const empty = $('[data-city-empty]');
    if (empty) empty.hidden = shown > 0;
  });

  // ---- choices
  $('[data-copy-order]')?.addEventListener('click', async () => {
    if (!state.slug) return;
    const url = new URL(orderPath(state), location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      show($('[data-share-status]'), 'Ordering link copied. Each buyer chooses their own size.');
    } catch {
      const input = $('[data-order-link]');
      input.value = url;
      input.hidden = false;
      input.select();
      show($('[data-share-status]'), 'Copy this link. Each buyer chooses their own size.');
    }
  });
  $('[data-quick-buy]')?.addEventListener('click', () => $('[data-form]')?.requestSubmit());
  root.querySelectorAll('[data-preview-style]').forEach((button) => {
    button.addEventListener('click', () => change({ style: button.dataset.previewStyle, audience: button.dataset.previewFit }));
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== 'radio') return;
    const field = t.name.replace(`${group}-`, '');
    if (field === 'city') change({ slug: t.value });
    else if (field === 'style') change({ style: t.value });
    else if (field === 'fit') change({ audience: t.value });
    else if (field === 'design') change({ designId: t.value });
    else if (field === 'size') change({ size: t.value }, { push: false });
  });

  function currentItem() {
    const product = productFor(state.style, state.audience);
    const found = shop.availability({ productId: product.id, designId: state.designId, slug: state.slug, size: state.size });
    if (!state.slug) return { error: 'Pick a city first.' };
    if (!found.ok) return { error: found.code === 'size_required' ? 'Pick a size first.' : unavailableText(product, found) };
    return {
      item: { productId: product.id, designId: state.designId, slug: state.slug, size: state.size, quantity: 1, mode: 'standard', seenPriceCents: found.priceCents },
      found,
      product,
    };
  }

  $('[data-add]')?.addEventListener('click', () => {
    const { item, error, product } = currentItem();
    if (error) return show($('[data-msg]'), error);
    addItems([item], shop.store.maxQuantity);
    track('add_to_cart', { team_id: item.slug, product_id: item.productId, product_style: product.style, audience: product.audience, design_id: item.designId, size: item.size, quantity: 1, purchase_mode: 'standard', value_cents: item.seenPriceCents });
    const added = $('[data-added]');
    if (added) {
      added.hidden = false;
      added.querySelector('[data-added-text]').textContent = `Added: ${cityBySlug(item.slug).name} ${product.name.toLowerCase()}, size ${item.size}.`;
    }
    const extra = $('[data-extra-item]');
    if (extra) extra.hidden = false;
  });

  // "Buy now" goes straight to Stripe with this one item.
  const form = $('[data-form]');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const buy = $('[data-buy]');
    const { item, error } = currentItem();
    if (error) return show($('[data-msg]'), error);
    if (checkoutInFlight) return;
    checkoutInFlight = true;
    buy.disabled = true;
    const quickBuy = $('[data-quick-buy]');
    if (quickBuy) quickBuy.disabled = true;
    buy.setAttribute('aria-busy', 'true');
    show($('[data-msg]'), '');
    const plainTee = item.productId === 'adult-tee' && item.designId === DEFAULTS.designId;
    try {
      const body = plainTee ? { slug: item.slug, size: item.size } : { items: [item] };
      track('checkout_started', { item_count: 1, value_cents: item.seenPriceCents });
      const res = await postJson(`${FUNCTIONS}/create-checkout`, body);
      if (!res.ok || !res.body.url) throw new Error(res.body.error || 'Checkout did not open');
      window.location.assign(res.body.url);
    } catch {
      checkoutInFlight = false;
      render();
      show($('[data-msg]'), "Checkout didn't open, so nothing was charged. Give it a minute and try again.");
      buy.setAttribute('aria-busy', 'false');
    }
  });

  // Coming back from Stripe with the back button: wake the button up.
  window.addEventListener('pageshow', () => {
    checkoutInFlight = false;
    const buy = $('[data-buy]');
    if (buy) buy.setAttribute('aria-busy', 'false');
    render();
  });

  if (syncUrl) {
    window.addEventListener('popstate', () => {
      Object.assign(state, fromUrl());
      render({ sizesChanged: true });
    });
    Object.assign(state, fromUrl());
  }
  render({ sizesChanged: true });
  return { state };
}

export function initAllPickers() {
  document.querySelectorAll('[data-picker]').forEach(initPicker);
}
