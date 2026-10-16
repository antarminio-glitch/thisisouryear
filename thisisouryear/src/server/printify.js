// Sends paid orders to Printify, which prints and ships them.
//
// It runs once for every paid order, right after the order email. Each item
// is matched to the Printify product made for that city and garment
// (src/data/printify.json), and the size picks the variant. Items with no
// Printify product, such as kids sizes, are left out and listed on the
// order, so they can be made by hand from the order email.
//
// Settings (Netlify environment variables):
//   PRINTIFY_API_TOKEN   from Printify: Account > Connections > API tokens.
//   PRINTIFY_SHOP_ID     optional. Overrides shopId in printify.json.
//   PRINTIFY_AUTO_SEND   "true" sends each order straight to production.
//                        Otherwise it waits in Printify for you to approve.
//
// Printify charges for an order only when it goes to production.
import { orderRef } from './order-email.js';

const API = 'https://api.printify.com/v1';
// Same idea as the order email: a send that started but never finished can
// be tried again after this long.
const STUCK_AFTER_MS = 15 * 60 * 1000;

export function printifySettings(env, map) {
  const shopId = env.PRINTIFY_SHOP_ID || map?.shopId || '';
  const missing = [];
  if (!env.PRINTIFY_API_TOKEN) missing.push('PRINTIFY_API_TOKEN');
  if (!shopId) missing.push('PRINTIFY_SHOP_ID');
  return { ready: missing.length === 0, shopId: String(shopId), autoSend: env.PRINTIFY_AUTO_SEND === 'true', missing };
}

function client(env, shopId, fetchImpl) {
  const base = env.PRINTIFY_API_BASE || API;
  return async (method, path, body) => {
    const res = await fetchImpl(`${base}/shops/${shopId}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.PRINTIFY_API_TOKEN}`,
        'Content-Type': 'application/json;charset=utf-8',
        'User-Agent': 'thisisouryear.team',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data?.errors ? JSON.stringify(data.errors) : (data?.message ?? data?.error ?? 'no detail');
      throw new Error(`Printify said ${res.status}: ${String(detail).slice(0, 160)}`);
    }
    return data;
  };
}

// The variant of a Printify product for one size, from the product's own
// size options. Only variants switched on in Printify count.
export function variantForSize(product, size) {
  const want = String(size).trim().toUpperCase();
  const sizes = (product?.options ?? []).find((o) => o.type === 'size' || /size/i.test(o.name ?? ''));
  const value = sizes?.values?.find((v) => String(v.title).trim().toUpperCase() === want);
  const enabled = (product?.variants ?? []).filter((v) => v.is_enabled !== false);
  const hit = value
    ? enabled.find((v) => (v.options ?? []).includes(value.id))
    : enabled.find((v) => String(v.title ?? '').split('/').pop().trim().toUpperCase() === want);
  return hit ?? null;
}

// Printify wants a first and last name.
export function splitName(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: 'Customer', last_name: 'Customer' };
  if (parts.length === 1) return { first_name: parts[0], last_name: parts[0] };
  return { first_name: parts.slice(0, -1).join(' '), last_name: parts.at(-1) };
}

export function addressTo(shipTo) {
  if (!shipTo) return null;
  return {
    ...splitName(shipTo.name),
    country: shipTo.country,
    region: shipTo.state,
    address1: shipTo.line1,
    address2: shipTo.line2 || '',
    city: shipTo.city,
    zip: shipTo.postalCode,
  };
}

// Which Printify product each item of an order is, before any sizes are
// looked up. Items without one are returned in `skipped` with the reason.
export function planLines(order, map) {
  const lines = [];
  const skipped = [];
  (order.lines ?? []).forEach((l, i) => {
    const productId = map?.products?.[l.team_id]?.[l.product_id] ?? null;
    if (productId) lines.push({ item: i + 1, productId, size: l.size, quantity: l.quantity ?? 1 });
    else skipped.push({ item: i + 1, product: l.product_id, city: l.team_id, size: l.size, reason: 'no Printify product for this city and garment' });
  });
  return { lines, skipped };
}

// Creates the Printify order once. Safe to call again for the same order.
// Returns { status } as one of: created, already_created, in_progress,
// not_configured, nothing_to_send, missing, failed.
export async function sendToPrintify({ orderId, storage, map, env, fetchImpl = fetch, now = () => new Date() }) {
  const orders = storage.store('orders');
  const order = await orders.get(`order/${orderId}`);
  if (!order) return { status: 'missing' };

  const settings = printifySettings(env, map);
  const key = `printify/${orderId}`;
  const prior = await orders.get(key);
  const save = async (state) => {
    await orders.set(key, state);
    order.printify = { status: state.status, at: state.at, id: state.id ?? null, skipped: state.skipped ?? [], error: state.error ?? null };
    await orders.set(`order/${orderId}`, order);
  };

  if (prior?.status === 'created' || prior?.status === 'nothing_to_send') return { status: prior.status === 'created' ? 'already_created' : prior.status };
  if (!settings.ready) {
    await save({ status: 'not_configured', at: now().toISOString(), missing: settings.missing });
    return { status: 'not_configured', missing: settings.missing };
  }
  if (prior?.status === 'sending' && now().getTime() - new Date(prior.at).getTime() < STUCK_AFTER_MS) return { status: 'in_progress' };

  // Claim it before calling Printify, so two deliveries of the same Stripe
  // message can't make two Printify orders.
  const claim = { status: 'sending', at: now().toISOString(), attempt: (prior?.attempt ?? 0) + 1 };
  if (!prior) {
    if (!(await orders.setIfNew(key, claim))) return { status: 'in_progress' };
  } else {
    await orders.set(key, claim);
  }

  const { lines, skipped } = planLines(order, map);
  if (lines.length === 0) {
    await save({ status: 'nothing_to_send', at: now().toISOString(), skipped });
    return { status: 'nothing_to_send', skipped };
  }

  const call = client(env, settings.shopId, fetchImpl);
  try {
    const address = addressTo(order.shipTo);
    if (!address) throw new Error('The order has no shipping address.');

    const products = new Map();
    const lineItems = [];
    for (const l of lines) {
      if (!products.has(l.productId)) products.set(l.productId, await call('GET', `/products/${l.productId}.json`));
      const variant = variantForSize(products.get(l.productId), l.size);
      if (!variant) {
        skipped.push({ item: l.item, size: l.size, reason: 'that size is not switched on in the Printify product' });
        continue;
      }
      lineItems.push({ product_id: l.productId, variant_id: variant.id, quantity: l.quantity });
    }
    if (lineItems.length === 0) {
      await save({ status: 'nothing_to_send', at: now().toISOString(), skipped });
      return { status: 'nothing_to_send', skipped };
    }

    const ref = orderRef(orderId);
    const created = await call('POST', '/orders.json', {
      external_id: ref,
      label: ref,
      line_items: lineItems,
      shipping_method: 1,
      send_shipping_notification: false,
      address_to: address,
    });
    // Saved before anything else can fail, so a retry never orders twice.
    const done = { status: 'created', at: now().toISOString(), attempt: claim.attempt, id: created?.id ?? null, sentToProduction: false, skipped };
    await save(done);
    if (settings.autoSend && created?.id) {
      try {
        await call('POST', `/orders/${created.id}/send_to_production.json`);
        done.sentToProduction = true;
      } catch (err) {
        done.error = `Created, but not sent to production: ${String(err?.message ?? err).slice(0, 160)}`;
      }
      await save(done);
    }
    return { status: 'created', id: done.id, sentToProduction: done.sentToProduction, skipped };
  } catch (err) {
    const error = String(err?.message ?? err).slice(0, 200);
    await save({ status: 'failed', at: now().toISOString(), attempt: claim.attempt, error, skipped });
    return { status: 'failed', error };
  }
}
