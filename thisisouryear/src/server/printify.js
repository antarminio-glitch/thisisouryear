// Sends paid orders to Printify, which prints them and ships them straight to
// the customer.
//
// Turned on with FULFILLMENT=printify in Netlify, plus PRINTIFY_API_TOKEN.
// Before the first order, the owner scans Printify's catalog from the admin
// screen. That picks a printer and, for each city, the blank shirt color
// closest to the city's garment color, and saves the result.
//
// Each order is created in Printify "on hold" unless PRINTIFY_AUTO_SEND is
// "true". On hold means nothing is printed or charged until the owner approves
// it in Printify, which is the safe way to check the first few.
//
// Printify charges the card on the owner's Printify account when an order goes
// into production. Nothing here handles money.
import { printFileName } from '../lib/print-file.js';
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

// ---- matching blank shirt colors to each city

function hexToLab(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

// How far apart two colors look (CIEDE2000, which judges blues and purples
// better than plain distance). Under about 5 is close; over about 20 is a
// different color.
export function colorDistance(a, b) {
  const [L1, a1, b1] = hexToLab(a);
  const [L2, a2, b2] = hexToLab(b);
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cm7 / (Cm7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (x, y) => (x === 0 && y === 0 ? 0 : (Math.atan2(y, x) / rad + 360) % 360);
  const h1p = hue(a1p, b1);
  const h2p = hue(a2p, b2);
  const dL = L2 - L1;
  const dC = C2p - C1p;
  let dh = 0;
  if (C1p * C2p !== 0) {
    dh = h2p - h1p;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * rad);
  const Lm = (L1 + L2) / 2;
  const Cm = (C1p + C2p) / 2;
  let hm = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hm += h1p + h2p < 360 ? 360 : -360;
    hm /= 2;
  }
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const SC = 1 + 0.045 * Cm;
  const SH = 1 + 0.015 * Cm * T;
  const Cm7p = Cm ** 7;
  const RT = -2 * Math.sqrt(Cm7p / (Cm7p + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad);
  const d = Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
  return Math.round(d * 10) / 10;
}

// Printify names variants like "Black / L" (or the other way round), and
// usually gives the parts separately too.
function splitVariant(v, sizes) {
  if (v.options?.color && v.options?.size) return { color: String(v.options.color), size: String(v.options.size) };
  const parts = String(v.title ?? '').split(' / ').map((s) => s.trim());
  const size = parts.find((p) => sizes.includes(p));
  const color = parts.find((p) => p !== size);
  return { color: color ?? '', size: size ?? '' };
}

// Works out, for one printer, which blank and which size variant each city
// gets. `overrides` are colors the owner picked by hand.
export function mapProvider({ variants, teams, config, overrides = {} }) {
  const wantedSizes = Object.values(config.sizes);
  const byColor = new Map();
  let placeholder = null;
  for (const v of variants) {
    const { color, size } = splitVariant(v, wantedSizes);
    if (!color || !size) continue;
    if (!byColor.has(color)) byColor.set(color, {});
    byColor.get(color)[size] = v.id;
    const front = (v.placeholders ?? []).find((p) => p.position === 'front');
    if (front && !placeholder) placeholder = { width: front.width, height: front.height };
  }
  const known = [...byColor.keys()].filter((c) => config.colors[c]);
  const cities = {};
  for (const team of teams) {
    const pick = overrides[team.slug] ?? config.overrides?.[team.slug];
    let color = null;
    let distance = null;
    let manual = false;
    const preferred = config.preferred?.[team.slug];
    if (pick && byColor.has(pick)) {
      color = pick;
      manual = true;
      distance = config.colors[pick] ? colorDistance(team.shirt, config.colors[pick]) : null;
    } else if (preferred && byColor.has(preferred) && config.colors[preferred]) {
      color = preferred;
      distance = colorDistance(team.shirt, config.colors[preferred]);
    } else {
      // Solid blanks win close calls: heathers print mottled.
      let best = null;
      for (const c of known) {
        const d = colorDistance(team.shirt, config.colors[c]);
        const score = d + (/heather/i.test(c) ? (config.heatherPenalty ?? 0) : 0);
        if (best === null || score < best) [best, color, distance] = [score, c, d];
      }
    }
    const sizes = color ? byColor.get(color) : {};
    const variantIds = {};
    const missingSizes = [];
    for (const [ours, theirs] of Object.entries(config.sizes)) {
      if (sizes[theirs]) variantIds[ours] = sizes[theirs];
      else missingSizes.push(ours);
    }
    const ok = Boolean(color) && missingSizes.length === 0 && (manual || distance <= config.closeEnough);
    cities[team.slug] = { color, approxHex: color ? (config.colors[color] ?? null) : null, distance, manual, ok, variants: variantIds, missingSizes };
  }
  const matched = Object.values(cities).filter((c) => c.ok);
  const avg = matched.length ? matched.reduce((n, c) => n + (c.distance ?? 0), 0) / matched.length : Infinity;
  return { cities, placeholder, colorsAvailable: [...byColor.keys()].sort(), score: matched.length, avgDistance: Math.round(avg * 10) / 10 };
}

// Looks through Printify's catalog and saves the best setup it finds. Picks
// the printer that can do the most cities in close colors, unless one is
// pinned with PRINTIFY_PROVIDER_ID.
export async function scanCatalog({ env, config, teams, storage, fetchImpl = fetch, now = () => new Date(), timeBudgetMs = 8000 }) {
  const started = Date.now();
  const settings = printifySettings(env);
  if (!settings.tokenSet) return { error: 'Add PRINTIFY_API_TOKEN in Netlify first.' };
  const call = printifyClient(env, fetchImpl);

  const shops = await call('GET', '/shops.json');
  const list = Array.isArray(shops) ? shops : (shops?.data ?? []);
  const shop = settings.shopId ? list.find((s) => String(s.id) === settings.shopId) : list.length === 1 ? list[0] : null;
  if (!shop) {
    return {
      error: list.length
        ? `There are ${list.length} stores in your Printify account. Set PRINTIFY_SHOP_ID in Netlify to the one to use: ${list.map((s) => `${s.id} (${s.title})`).join(', ')}.`
        : 'Your Printify account has no store yet. In Printify, add a store and pick the API option, then scan again.',
    };
  }

  const product = config.products['adult-tee'];
  const blueprint = await call('GET', `/catalog/blueprints/${product.blueprintId}.json`);
  let providers = await call('GET', `/catalog/blueprints/${product.blueprintId}/print_providers.json`);
  const pinned = settings.providerId ?? config.printProviderId ?? null;
  if (pinned) providers = providers.filter((p) => Number(p.id) === Number(pinned));
  if (!providers.length) return { error: pinned ? `Printer ${pinned} doesn't make this shirt. Clear PRINTIFY_PROVIDER_ID and scan again.` : 'Printify lists no printers for this shirt.' };

  const overrides = (await storage.store('fulfillment').get(KEY_OVERRIDES)) ?? {};
  const results = [];
  let partial = false;
  for (let i = 0; i < providers.length; i += 5) {
    if (Date.now() - started > timeBudgetMs) {
      partial = true;
      break;
    }
    const batch = providers.slice(i, i + 5);
    const scanned = await Promise.all(
      batch.map(async (p) => {
        try {
          const res = await call('GET', `/catalog/blueprints/${product.blueprintId}/print_providers/${p.id}/variants.json`);
          return { provider: p, ...mapProvider({ variants: res?.variants ?? res ?? [], teams, config, overrides }) };
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

  const mapping = {
    scannedAt: now().toISOString(),
    shopId: shop.id,
    shopTitle: shop.title,
    blueprintId: product.blueprintId,
    blueprintTitle: [blueprint?.brand, blueprint?.model].filter(Boolean).join(' ') || blueprint?.title || product.name,
    providerId: best.provider.id,
    providerTitle: best.provider.title,
    placeholder: best.placeholder,
    colorsAvailable: best.colorsAvailable,
    cities: best.cities,
    citiesReady: best.score,
    providers: results.map((r) => ({ id: r.provider.id, title: r.provider.title, citiesReady: r.score, avgDistance: r.avgDistance ?? null, error: r.error ?? null })),
    partial,
  };
  await storage.store('fulfillment').set(KEY_CATALOG, mapping);
  return { mapping };
}

// Where the lettering sits: centered, near the top of the front print area,
// sized to a share of its width.
export function placementFor(config, mapping, designId) {
  const scale = config.placement.widthOfPrintArea;
  const aspect = config.designs[designId]?.aspect;
  const W = mapping?.placeholder?.width;
  const H = mapping?.placeholder?.height;
  if (!aspect || !W || !H) return { x: 0.5, y: 0.25, scale };
  const top = config.placement.topMarginOfPrintAreaWidth * W;
  const y = (top + 0.5 * scale * W * aspect) / H;
  return { x: 0.5, y: Math.round(y * 10000) / 10000, scale };
}

// The order as Printify wants it. Returns { payload } or { problems }.
export function buildPrintifyOrder({ order, mapping, config, shop, siteUrl }) {
  const problems = [];
  const line_items = [];
  (order.lines ?? []).forEach((l, i) => {
    const n = i + 1;
    const product = config.products[l.product_id];
    const team = shop.city(l.team_id);
    const design = shop.design(l.design_id);
    const city = mapping.cities?.[l.team_id];
    if (!product) return problems.push(`Item ${n}: Printify isn't set up for ${l.product_id}.`);
    if (!team || !design) return problems.push(`Item ${n}: unknown city or design.`);
    if (!city?.color) return problems.push(`Item ${n}: no blank shirt color picked for ${team.name}. Pick one in the admin screen.`);
    const variantId = city.variants?.[l.size];
    if (!variantId) return problems.push(`Item ${n}: this printer has no ${l.size} in ${city.color}.`);
    if (!config.designs[design.id]?.aspect) return problems.push(`Item ${n}: there's no print file for ${design.name} yet.`);
    line_items.push({
      print_provider_id: mapping.providerId,
      blueprint_id: product.blueprintId,
      variant_id: variantId,
      quantity: l.quantity ?? 1,
      print_areas: { front: [{ src: `${siteUrl}/print/${printFileName(team, design)}`, ...placementFor(config, mapping, design.id), angle: 0 }] },
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

// Sends one paid order to Printify, once. Safe to call again for the same
// order. Returns { status } as one of:
//   on_hold        created in Printify, waiting for approval there
//   in_production  created and sent to print (PRINTIFY_AUTO_SEND=true)
//   already_sent   done before
//   in_progress    another call is sending it right now
//   needs_setup    the catalog hasn't been scanned yet
//   rejected       Printify or the checks here refused it. Needs fixing.
//   failed         Printify couldn't be reached or had an error. Try again.
//   not_configured / missing
// An order already in Printify is never sent twice, even by hand: Printify
// would make a second order and print it twice.
export async function submitToPrintify({ orderId, storage, shop, config, env, siteUrl, fetchImpl = fetch, now = () => new Date() }) {
  const settings = printifySettings(env);
  if (!settings.tokenSet) return { status: 'not_configured', missing: ['PRINTIFY_API_TOKEN'] };
  const orders = storage.store('orders');
  const order = await orders.get(`order/${orderId}`);
  if (!order) return { status: 'missing' };
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
  if (!mapping) {
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
export async function sendTestOrder({ storage, shop, config, env, siteUrl, fetchImpl = fetch, now = () => new Date(), slug = 'dallas', size = 'L' }) {
  const mapping = await storage.store('fulfillment').get(KEY_CATALOG);
  if (!mapping) return { error: 'Scan the Printify catalog first.' };
  const stamp = now().getTime();
  const order = {
    id: `test-${stamp}`,
    email: '',
    shipTo: { name: 'Test Order', line1: '1 Test Street', line2: '', city: 'New York', state: 'NY', postalCode: '10001', country: 'US' },
    lines: [{ product_id: 'adult-tee', design_id: 'this-is-our-year', team_id: slug, size, quantity: 1 }],
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
