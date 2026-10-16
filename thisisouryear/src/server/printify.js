// Sends paid orders to Printify, which prints them and ships them straight to
// the customer.
//
// Turned on with FULFILLMENT=printify in Netlify, plus PRINTIFY_API_TOKEN.
// Before the first order, the owner scans Printify's catalog from the admin
// screen. For each garment on sale (src/data/printify.json says which
// Printify garments to look for), that picks a printer and, for each city,
// the blank closest to the one shoppers see on the site, and saves the result.
//
// Each order is created in Printify "on hold" unless PRINTIFY_AUTO_SEND is
// "true". On hold means nothing is printed or charged until the owner approves
// it, which is the safe way to check the first few.
//
// Printify charges the card on the owner's Printify account when an order goes
// into production. Nothing here handles money.
import { printFileName } from '../lib/print-file.js';
import { deltaE2000 } from '../lib/photos.js';
import { orderRef } from './order-email.js';

const API = 'https://api.printify.com/v1';
const STUCK_AFTER_MS = 15 * 60 * 1000;
export const KEY_CATALOG = 'printify/catalog';
export const KEY_OVERRIDES = 'printify/overrides';
const orderKey = (orderId) => `printify/order/${orderId}`;

export function printifySettings(env) {
  const on = env.FULFILLMENT === 'printify';
  const missing = [];
  if (!env.PRINTIFY_API_TOKEN) missing.push('PRINTIFY_API_TOKEN');
  return {
    on,
    ready: on && missing.length === 0,
    tokenSet: Boolean(env.PRINTIFY_API_TOKEN),
    missing,
    shopId: env.PRINTIFY_SHOP_ID ? String(env.PRINTIFY_SHOP_ID) : null,
    providerId: env.PRINTIFY_PROVIDER_ID ? Number(env.PRINTIFY_PROVIDER_ID) : null,
    autoSend: env.PRINTIFY_AUTO_SEND === 'true',
  };
}

// A tiny client for Printify's REST API. Throws on any error, with the status
// on the error so callers can tell "fix the order" from "try again later".
export function printifyClient(env, fetchImpl = fetch) {
  const base = (env.PRINTIFY_API_BASE || API).replace(/\/+$/, '');
  return async function call(method, path, body) {
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${env.PRINTIFY_API_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'ThisIsOurYear',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      const e = new Error(`Couldn't reach Printify: ${err?.message ?? err}`);
      e.status = 0;
      throw e;
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { message: text.slice(0, 200) };
    }
    if (!res.ok) {
      const detail = data?.errors ? JSON.stringify(data.errors).slice(0, 300) : (data?.message ?? data?.error ?? '');
      const e = new Error(`Printify said ${res.status}${detail ? `: ${detail}` : ''}`);
      e.status = res.status;
      throw e;
    }
    return data;
  };
}

// The garments Printify is set up for, in the order the admin screen shows
// them: those in printify.json that are also for sale.
export function printifyProducts(config, shop) {
  return Object.keys(config.products).filter((id) => shop.catalog.products.some((p) => p.id === id && p.sellable));
}

// ---- matching blank colors to each city

// How far apart two colors look (CIEDE2000). Under about 5 is close; over
// about 20 is a different color.
export function colorDistance(a, b) {
  return Math.round(deltaE2000(a, b) * 10) / 10;
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const SIZE_ALIASES = { XXL: '2XL', XXXL: '3XL', '2X': '2XL', '3X': '3XL', XXS: '2XS' };
function normSize(s) {
  const t = String(s ?? '').toUpperCase().replace(/YOUTH|KIDS|\(.*?\)/g, '').replace(/\s+/g, '').replace(/^Y(?=X|S|M|L)/, '');
  return SIZE_ALIASES[t] ?? t;
}

// Printify names variants like "Black / L" (or the other way round), and
// usually gives the parts separately too.
function splitVariant(v) {
  if (v.options?.color && v.options?.size) return { color: String(v.options.color), size: String(v.options.size) };
  const parts = String(v.title ?? '').split(' / ').map((s) => s.trim());
  const size = parts.find((p) => /^(Y(OUTH)?\s*)?(\d?X{0,3}[SML]|\d?XL|X{1,3}L|XS)$/i.test(p));
  const color = parts.find((p) => p !== size);
  return { color: color ?? '', size: size ?? '' };
}

// Screen colors for blank names: the rough ones in printify.json, plus the
// measured ones for every SanMar blank the site shows.
export function blankHexes(config, photos) {
  const out = new Map();
  for (const g of Object.values(photos?.garments ?? {})) for (const c of Object.values(g.colors ?? {})) if (c.hex) out.set(norm(c.name), c.hex);
  for (const [name, hex] of Object.entries(config.colors ?? {})) out.set(norm(name), hex);
  return out;
}

// What each city should look like for one garment: the SanMar blank the site
// shows for it, or the city's shirt color when there's none.
export function targetsFor(productId, teams, photos) {
  const g = photos?.garments?.[productId];
  return Object.fromEntries(
    teams.map((t) => {
      const code = g?.cities?.[t.slug]?.color;
      const c = code ? g.colors?.[code] : null;
      return [t.slug, c?.hex ? { name: c.name, hex: c.hex } : { name: null, hex: t.shirt }];
    }),
  );
}

// Works out, for one printer and one garment, which blank and which size
// variant each city gets. `overrides` are colors the owner picked by hand.
// `sameGarment` is true when Printify's garment is the very one the site
// shows, so a color with the same name is the same blank.
export function mapProvider({ variants, teams, sizes, targets, hexes, config, overrides = {}, preferred = {}, sameGarment = false }) {
  const byColor = new Map();
  let placeholder = null;
  for (const v of variants) {
    const { color, size } = splitVariant(v);
    if (!color || !size) continue;
    if (!byColor.has(color)) byColor.set(color, {});
    byColor.get(color)[normSize(size)] = v.id;
    const front = (v.placeholders ?? []).find((p) => p.position === 'front');
    if (front && !placeholder) placeholder = { width: front.width, height: front.height };
  }
  const colors = [...byColor.keys()];
  const hexOf = (name) => hexes.get(norm(name)) ?? null;
  const known = colors.filter((c) => hexOf(c));
  const cities = {};
  for (const team of teams) {
    const target = targets[team.slug] ?? { name: null, hex: team.shirt };
    const pick = overrides[team.slug] ?? preferred[team.slug];
    const same = sameGarment && target.name ? colors.find((c) => norm(c) === norm(target.name)) : null;
    let color = null;
    let distance = null;
    let how = 'closest';
    if (pick && byColor.has(pick)) {
      color = pick;
      how = overrides[team.slug] ? 'manual' : 'preferred';
    } else if (same) {
      // The very blank the site shows, by name.
      color = same;
      how = 'same';
    } else {
      // Solid blanks win close calls: heathers print mottled.
      let best = null;
      for (const c of known) {
        const d = colorDistance(target.hex, hexOf(c));
        const score = d + (/heather/i.test(c) ? (config.heatherPenalty ?? 0) : 0);
        if (best === null || score < best) [best, color] = [score, c];
      }
    }
    if (color && hexOf(color)) distance = colorDistance(target.hex, hexOf(color));
    const variantIds = {};
    const missingSizes = [];
    for (const s of sizes) {
      const id = color ? byColor.get(color)[normSize(s)] : null;
      if (id) variantIds[s] = id;
      else missingSizes.push(s);
    }
    const close = how !== 'closest' || (distance !== null && distance <= config.closeEnough);
    const ok = Boolean(color) && missingSizes.length === 0 && close;
    cities[team.slug] = { color, approxHex: color ? hexOf(color) : null, target: target.name, targetHex: target.hex, distance, how, ok, variants: variantIds, missingSizes };
  }
  const matched = Object.values(cities).filter((c) => c.ok);
  const avg = matched.length ? matched.reduce((n, c) => n + (c.distance ?? 0), 0) / matched.length : Infinity;
  return { cities, placeholder, colorsAvailable: colors.sort(), score: matched.length, avgDistance: Math.round(avg * 10) / 10 };
}

// Finds Printify's id for a garment, from the models printify.json lists in
// order of preference ("PC54", then "3001", and so on), or a number to pin
// one directly.
export function pickBlueprint(blueprints, models) {
  for (const m of models) {
    if (typeof m === 'number') {
      const hit = blueprints.find((b) => Number(b.id) === m);
      if (hit) return hit;
      continue;
    }
    const want = norm(m);
    const hit = blueprints.find((b) => norm(b.model) === want) ?? blueprints.find((b) => String(b.title ?? '').split(/[\s()]+/).some((w) => norm(w) === want));
    if (hit) return hit;
  }
  return null;
}

async function findShop(call, settings) {
  const shops = await call('GET', '/shops.json');
  const list = Array.isArray(shops) ? shops : (shops?.data ?? []);
  const shop = settings.shopId ? list.find((s) => String(s.id) === settings.shopId) : list.length === 1 ? list[0] : null;
  if (shop) return { shop };
  return {
    error: list.length
      ? `There are ${list.length} stores in your Printify account. Set PRINTIFY_SHOP_ID in Netlify to the one to use: ${list.map((s) => `${s.id} (${s.title})`).join(', ')}.`
      : 'Your Printify account has no store yet. In Printify, add a store and pick the API option, then scan again.',
  };
}

// Scans Printify's catalog for one garment and saves the best setup it finds,
// next to what's already saved for the others. Picks the printer that can do
// the most cities in close colors, unless one is pinned (PRINTIFY_PROVIDER_ID,
// or `pinProvider` when the owner is only changing colors).
export async function scanCatalog({ env, config, shop, photos, storage, productId, pinProvider = null, fetchImpl = fetch, now = () => new Date(), timeBudgetMs = 8000 }) {
  const started = Date.now();
  const settings = printifySettings(env);
  if (!settings.tokenSet) return { error: 'Add PRINTIFY_API_TOKEN in Netlify first.' };
  const productIds = printifyProducts(config, shop);
  if (!productIds.includes(productId)) return { error: `Printify isn't set up for ${productId}.` };
  const product = config.products[productId];
  const catalogProduct = shop.catalog.products.find((p) => p.id === productId);
  const call = printifyClient(env, fetchImpl);
  const ful = storage.store('fulfillment');
  const saved = (await ful.get(KEY_CATALOG)) ?? { products: {} };

  const found = await findShop(call, settings);
  if (found.error) return { error: found.error };

  // Which Printify garment. Reuses the last answer while the list of models
  // hasn't changed, because the full catalog is a big download.
  const modelsKey = JSON.stringify(product.models);
  const before = saved.products?.[productId];
  let blueprint = before?.modelsKey === modelsKey ? { id: before.blueprintId, title: before.blueprintTitle, model: before.blueprintModel } : null;
  if (!blueprint) {
    const all = await call('GET', '/catalog/blueprints.json');
    const hit = pickBlueprint(Array.isArray(all) ? all : (all?.data ?? []), product.models);
    if (!hit) return { error: `Printify doesn't list any of these for ${catalogProduct.name}: ${product.models.join(', ')}. Add one it does carry in src/data/printify.json.` };
    blueprint = { id: hit.id, title: [hit.brand, hit.model].filter(Boolean).join(' ') || hit.title, model: hit.model ?? '' };
  }
  const siteStyle = photos?.garments?.[productId]?.style;
  const sameGarment = Boolean(siteStyle) && norm(blueprint.model ?? saved.products?.[productId]?.blueprintModel) === norm(siteStyle);

  let providers = await call('GET', `/catalog/blueprints/${blueprint.id}/print_providers.json`);
  const pinned = pinProvider ?? settings.providerId ?? null;
  if (pinned) providers = providers.filter((p) => Number(p.id) === Number(pinned));
  if (!providers.length) return { error: pinned ? `Printer ${pinned} doesn't make the ${blueprint.title}. Clear PRINTIFY_PROVIDER_ID and scan again.` : `Printify lists no printers for the ${blueprint.title}.` };

  const overrides = ((await ful.get(KEY_OVERRIDES)) ?? {})[productId] ?? {};
  const shape = {
    teams: shop.teams,
    sizes: catalogProduct.variants.map((v) => v.size),
    targets: targetsFor(productId, shop.teams, photos),
    hexes: blankHexes(config, photos),
    config,
    overrides,
    preferred: product.preferred ?? {},
    sameGarment,
  };
  const results = [];
  let partial = false;
  for (let i = 0; i < providers.length; i += 5) {
    if (Date.now() - started > timeBudgetMs) {
      partial = true;
      break;
    }
    const scanned = await Promise.all(
      providers.slice(i, i + 5).map(async (p) => {
        try {
          const res = await call('GET', `/catalog/blueprints/${blueprint.id}/print_providers/${p.id}/variants.json`);
          return { provider: p, ...mapProvider({ variants: res?.variants ?? res ?? [], ...shape }) };
        } catch (err) {
          return { provider: p, error: err.message, score: -1 };
        }
      }),
    );
    results.push(...scanned);
  }
  const usable = results.filter((r) => !r.error);
  if (!usable.length) return { error: `Couldn't read any printer's colors from Printify. ${results[0]?.error ?? ''}`.trim() };
  usable.sort((a, b) => b.score - a.score || a.avgDistance - b.avgDistance);
  const best = usable[0];

  const at = now().toISOString();
  const mapping = {
    ...saved,
    scannedAt: at,
    shopId: found.shop.id,
    shopTitle: found.shop.title,
    products: {
      ...(saved.products ?? {}),
      [productId]: {
        scannedAt: at,
        modelsKey,
        blueprintId: blueprint.id,
        blueprintTitle: blueprint.title,
        blueprintModel: blueprint.model ?? saved.products?.[productId]?.blueprintModel ?? '',
        sameGarment,
        providerId: best.provider.id,
        providerTitle: best.provider.title,
        placeholder: best.placeholder,
        colorsAvailable: best.colorsAvailable,
        cities: best.cities,
        citiesReady: best.score,
        providers: results.map((r) => ({ id: r.provider.id, title: r.provider.title, citiesReady: r.score, avgDistance: r.avgDistance ?? null, error: r.error ?? null })),
        partial,
      },
    },
  };
  await ful.set(KEY_CATALOG, mapping);
  return { mapping, productId };
}

// A short summary of what's set up, for the setup report and the admin screen.
export function printifySummary(mapping, config, shop) {
  const ids = printifyProducts(config, shop);
  return ids.map((id) => {
    const m = mapping?.products?.[id];
    const name = shop.catalog.products.find((p) => p.id === id)?.name ?? id;
    return { id, name, scanned: Boolean(m), blueprint: m?.blueprintTitle ?? null, provider: m?.providerTitle ?? null, citiesReady: m?.citiesReady ?? 0, partial: Boolean(m?.partial) };
  });
}

// Where the lettering sits: centered, near the top of the front print area,
// sized to a share of its width.
export function placementFor(config, productId, productMapping, designId) {
  const place = config.products[productId]?.placement ?? { widthOfPrintArea: 0.86, topMarginOfPrintAreaWidth: 0.09 };
  const scale = place.widthOfPrintArea;
  const aspect = config.designs[designId]?.aspect;
  const W = productMapping?.placeholder?.width;
  const H = productMapping?.placeholder?.height;
  if (!aspect || !W || !H) return { x: 0.5, y: 0.3, scale };
  const top = place.topMarginOfPrintAreaWidth * W;
  const y = (top + 0.5 * scale * W * aspect) / H;
  return { x: 0.5, y: Math.round(y * 10000) / 10000, scale };
}

// The order as Printify wants it. Returns { payload } or { problems }.
export function buildPrintifyOrder({ order, mapping, config, shop, siteUrl }) {
  const problems = [];
  const line_items = [];
  (order.lines ?? []).forEach((l, i) => {
    const n = i + 1;
    const pm = mapping.products?.[l.product_id];
    const team = shop.city(l.team_id);
    const design = shop.design(l.design_id);
    if (!config.products[l.product_id]) return problems.push(`Item ${n}: Printify isn't set up for ${l.product_id}.`);
    if (!pm) return problems.push(`Item ${n}: scan Printify for ${l.product_id} in the admin screen first.`);
    if (!team || !design) return problems.push(`Item ${n}: unknown city or design.`);
    const city = pm.cities?.[l.team_id];
    if (!city?.color) return problems.push(`Item ${n}: no blank color picked for ${team.name} on ${l.product_id}. Pick one in the admin screen.`);
    const variantId = city.variants?.[l.size];
    if (!variantId) return problems.push(`Item ${n}: this printer has no ${l.size} in ${city.color}.`);
    if (!config.designs[design.id]?.aspect) return problems.push(`Item ${n}: there's no print file for ${design.name} yet.`);
    line_items.push({
      print_provider_id: pm.providerId,
      blueprint_id: pm.blueprintId,
      variant_id: variantId,
      quantity: l.quantity ?? 1,
      print_areas: { front: [{ src: `${siteUrl}/print/${printFileName(team, design)}`, ...placementFor(config, l.product_id, pm, design.id), angle: 0 }] },
    });
  });
  const s = order.shipTo;
  if (!s?.line1 || !s?.city || !s?.country) problems.push('The order has no full shipping address.');
  if (problems.length) return { problems };
  const [first, ...rest] = String(s.name ?? '').trim().split(/\s+/).filter(Boolean);
  return {
    payload: {
      external_id: order.id,
      label: orderRef(order.id),
      line_items,
      shipping_method: config.shippingMethod ?? 1,
      // Printify emails the customer the tracking number when it ships.
      send_shipping_notification: true,
      address_to: {
        first_name: first ?? 'Customer',
        last_name: rest.join(' ') || '.',
        email: order.email ?? '',
        phone: '',
        country: s.country,
        region: s.state ?? '',
        address1: s.line1,
        address2: s.line2 ?? '',
        city: s.city,
        zip: s.postalCode ?? '',
      },
    },
  };
}

// True once an order belongs to Printify, so it's never printed anywhere else.
export const inPrintify = (order) => Boolean(order?.printify?.printifyOrderId) || ['sending', 'on_hold', 'in_production'].includes(order?.printify?.status);

// Sends one paid order to Printify, once. Safe to call again for the same
// order. Returns { status } as one of:
//   on_hold        created in Printify, waiting for approval there
//   in_production  created and sent to print (PRINTIFY_AUTO_SEND=true)
//   already_sent   done before
//   in_progress    another call is sending it right now
//   needs_setup    the catalog hasn't been scanned yet
//   rejected       Printify or the checks here refused it. Needs fixing.
//   failed         Printify couldn't be reached or had an error. Try again.
//   not_configured / missing / in_print_run
// An order already in Printify is never sent twice, even by hand: Printify
// would make a second order and print it twice.
export async function submitToPrintify({ orderId, storage, shop, config, env, siteUrl, fetchImpl = fetch, now = () => new Date() }) {
  const settings = printifySettings(env);
  if (!settings.tokenSet) return { status: 'not_configured', missing: ['PRINTIFY_API_TOKEN'] };
  const orders = storage.store('orders');
  const order = await orders.get(`order/${orderId}`);
  if (!order) return { status: 'missing' };
  // Already handed to the vendor in a print run: never print it twice.
  if (order.printRun) return { status: 'in_print_run', error: `This order is in print run ${order.printRun}, so the vendor is printing it.` };
  const ful = storage.store('fulfillment');
  const key = orderKey(orderId);
  const prior = await ful.get(key);
  const save = async (state) => {
    await ful.set(key, state);
    order.printify = { status: state.status, at: state.at, printifyOrderId: state.printifyOrderId ?? prior?.printifyOrderId ?? null, error: state.error ?? null };
    await orders.set(`order/${orderId}`, order);
  };

  if (['on_hold', 'in_production'].includes(prior?.status)) return { status: 'already_sent', printifyOrderId: prior.printifyOrderId };
  const fresh = prior?.status === 'sending' && now().getTime() - new Date(prior.at).getTime() < STUCK_AFTER_MS;
  if (fresh) return { status: 'in_progress' };

  const mapping = await ful.get(KEY_CATALOG);
  const unscanned = [...new Set((order.lines ?? []).map((l) => l.product_id))].filter((id) => config.products[id] && !mapping?.products?.[id]);
  if (!mapping || unscanned.length) {
    const error = 'Scan the Printify catalog in the admin screen first.';
    await save({ status: 'needs_setup', at: now().toISOString(), error });
    return { status: 'needs_setup', error };
  }

  // Claim it before calling Printify. Printify makes a second order if it's
  // asked twice, so this is what keeps a repeat from printing twice.
  const attempt = (prior?.attempt ?? 0) + 1;
  const claim = { status: 'sending', at: now().toISOString(), attempt };
  if (!prior) {
    if (!(await ful.setIfNew(key, claim))) return { status: 'in_progress' };
  } else {
    await ful.set(key, claim);
  }

  const built = buildPrintifyOrder({ order, mapping, config, shop, siteUrl });
  if (built.problems) {
    const error = built.problems.join(' ');
    await save({ status: 'rejected', at: now().toISOString(), attempt, error });
    return { status: 'rejected', error };
  }

  const call = printifyClient(env, fetchImpl);
  let created;
  try {
    created = await call('POST', `/shops/${mapping.shopId}/orders.json`, built.payload);
  } catch (err) {
    // 4xx means Printify looked at it and said no. Anything else is worth
    // trying again.
    const status = err.status >= 400 && err.status < 500 && err.status !== 429 ? 'rejected' : 'failed';
    await save({ status, at: now().toISOString(), attempt, error: err.message.slice(0, 300) });
    return { status, error: err.message };
  }
  const printifyOrderId = created?.id ?? null;
  let status = 'on_hold';
  let error = null;
  if (settings.autoSend && printifyOrderId) {
    try {
      await call('POST', `/shops/${mapping.shopId}/orders/${printifyOrderId}/send_to_production.json`, {});
      status = 'in_production';
    } catch (err) {
      error = `Created in Printify, but it couldn't be sent to print: ${err.message}. Approve it in Printify.`;
    }
  }
  await save({ status, at: now().toISOString(), attempt, printifyOrderId, error });
  return { status, printifyOrderId, error };
}

// Approves an on-hold order so Printify prints it and charges for it.
export async function sendToProduction({ orderId, storage, env, fetchImpl = fetch, now = () => new Date() }) {
  const ful = storage.store('fulfillment');
  const state = await ful.get(orderKey(orderId));
  const mapping = await ful.get(KEY_CATALOG);
  if (!state?.printifyOrderId || !mapping) return { status: 'missing', error: 'This order is not in Printify yet.' };
  if (state.status === 'in_production') return { status: 'already_sent' };
  const call = printifyClient(env, fetchImpl);
  try {
    await call('POST', `/shops/${mapping.shopId}/orders/${state.printifyOrderId}/send_to_production.json`, {});
  } catch (err) {
    return { status: 'failed', error: err.message };
  }
  const next = { ...state, status: 'in_production', at: now().toISOString(), error: null };
  await ful.set(orderKey(orderId), next);
  const orders = storage.store('orders');
  const order = await orders.get(`order/${orderId}`);
  if (order) {
    order.printify = { ...(order.printify ?? {}), status: 'in_production', at: next.at, error: null };
    await orders.set(`order/${orderId}`, order);
  }
  return { status: 'in_production', printifyOrderId: state.printifyOrderId };
}

// A sample order, created on hold and never sent to print, so the owner can
// check the mockup in Printify before a real order comes in.
export async function sendTestOrder({ storage, shop, config, env, siteUrl, fetchImpl = fetch, now = () => new Date(), slug = 'dallas', productId = 'adult-tee' }) {
  const mapping = await storage.store('fulfillment').get(KEY_CATALOG);
  if (!mapping?.products?.[productId]) return { error: 'Scan Printify for this garment first.' };
  const sizes = shop.catalog.products.find((p) => p.id === productId)?.variants.map((v) => v.size) ?? ['L'];
  const order = {
    id: `test-${now().getTime()}`,
    email: '',
    shipTo: { name: 'Test Order', line1: '1 Test Street', line2: '', city: 'New York', state: 'NY', postalCode: '10001', country: 'US' },
    lines: [{ product_id: productId, design_id: shop.catalog.designs.find((d) => d.status === 'live')?.id ?? 'this-is-our-year', team_id: slug, size: sizes[Math.floor(sizes.length / 2)], quantity: 1 }],
  };
  const built = buildPrintifyOrder({ order, mapping, config, shop, siteUrl });
  if (built.problems) return { error: built.problems.join(' ') };
  built.payload.label = 'TEST - delete, do not print';
  built.payload.send_shipping_notification = false;
  try {
    const created = await printifyClient(env, fetchImpl)('POST', `/shops/${mapping.shopId}/orders.json`, built.payload);
    return { printifyOrderId: created?.id ?? null, payload: built.payload };
  } catch (err) {
    return { error: err.message, payload: built.payload };
  }
}
