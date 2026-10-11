// Starts Stripe Checkout, and prices carts for the cart page.
//
// The browser sends choices only: which item, which city, which size, how
// many. Prices, availability and the words on the order are all worked out
// here from the data files. A price sent from the browser is ignored, except
// to tell the shopper it has changed.
import { json, readJson } from './http.js';

const clip = (text, max) => (text.length > max ? text.slice(0, max - 1) + '…' : text);
const unique = (list) => [...new Set(list.filter(Boolean))];

// The original buy button sends { slug, size } for one adult tee. Carts send
// { items: [...] }. A plain HTML form post (no JavaScript) works too.
async function readOrder(req) {
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = await readJson(req);
    if (body.error) return { items: null, wantsJson: true };
    const v = body.value;
    if (Array.isArray(v.items)) return { items: v.items, favoriteSlug: v.favoriteSlug, wantsJson: true, single: false };
    return { items: [legacyItem(v.slug, v.size)], wantsJson: true, single: true };
  }
  try {
    const form = await req.formData();
    return { items: [legacyItem(form.get('slug'), form.get('size'))], wantsJson: false, single: true };
  } catch {
    return { items: null, wantsJson: false };
  }
}

function legacyItem(slug, size) {
  return { productId: 'adult-tee', designId: 'this-is-our-year', slug, size, quantity: 1, mode: 'standard' };
}

function fail(wantsJson, status, message, extra = {}) {
  return wantsJson
    ? json({ error: message, ...extra }, status)
    : new Response(`${message} Go back and try again.`, { status, headers: { 'Cache-Control': 'no-store' } });
}

// What the cart page needs to show: each line marked ok or not, and the totals.
function publicQuote(quote) {
  return {
    ok: quote.ok,
    problems: quote.problems,
    subtotalCents: quote.subtotalCents,
    shippingCents: quote.shippingCents,
    totalCents: quote.totalCents,
    lines: quote.lines.map((l) => ({
      index: l.index,
      ok: l.ok,
      code: l.code,
      message: l.message,
      notices: l.notices,
      unitCents: l.unitCents ?? null,
      regularUnitCents: l.regularUnitCents ?? null,
      lineCents: l.lineCents ?? null,
      name: l.name ?? null,
    })),
    bulk: quote.bulk ?? null,
  };
}

export function makeQuoteHandler({ shop }) {
  return async (req) => {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    const body = await readJson(req);
    if (body.error || !Array.isArray(body.value.items)) return json({ error: "We couldn't read that cart." }, 400);
    return json(publicQuote(shop.quote(body.value.items)));
  };
}

export function makeCheckoutHandler({ shop, env, stripeFor }) {
  const { store, catalog } = shop;

  return async (req) => {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });

    const order = await readOrder(req);
    if (!order.items) return fail(order.wantsJson, 400, "We couldn't read that order.");

    const quote = shop.quote(order.items);
    if (!quote.ok) {
      return fail(order.wantsJson, 400, quote.problems[0] ?? "That order can't be placed.", { quote: publicQuote(quote) });
    }

    const key = env.STRIPE_SECRET_KEY;
    if (!key) {
      console.error('STRIPE_SECRET_KEY is not set. Add it in Netlify under Environment variables.');
      return fail(order.wantsJson, 500, "Checkout isn't set up yet.");
    }

    // Where Stripe sends the customer afterwards. Uses SITE_URL if it's set,
    // otherwise whatever address this request came in on.
    const site = (env.SITE_URL || new URL(req.url).origin).replace(/\/+$/, '');
    const tax = store.automaticTax === true;
    const lines = quote.lines;
    const one = lines.length === 1 ? lines[0] : null;

    // Saved on the checkout session and on the payment, so the order reads
    // clearly wherever you look in the Stripe dashboard.
    const summary = one
      ? { city: one.cityName, colors: one.colors, size: one.size, slug: one.slug, ...one.metadata }
      : {
          line_count: String(lines.length),
          item_count: String(lines.reduce((n, l) => n + l.quantity, 0)),
          purchase_modes: unique(lines.map((l) => l.mode)).join(','),
          purchased_colorway_team_ids: clip(unique(lines.map((l) => l.slug)).join(','), 480),
          bundle_ids: clip(unique(lines.map((l) => l.bundleId)).join(','), 480),
          league_order_ids: clip(unique(lines.map((l) => l.leagueOrderId)).join(','), 480),
          league_name: unique(lines.map((l) => l.leagueName))[0] ?? '',
        };
    if (quote.bulk?.percentOff) summary.bulk_percent_off = String(quote.bulk.percentOff);
    for (const k of Object.keys(summary)) if (summary[k] === '') delete summary[k];

    // The shopper's own city is optional and kept apart from what they bought.
    // Buying a rival's colors as a joke doesn't make you their fan.
    if (shop.city(order.favoriteSlug)) summary.customer_favorite_team_id = order.favoriteSlug;

    const description = one ? one.name : clip(`${summary.item_count} items: ${lines.map((l) => `${l.quantity} x ${l.name}`).join('; ')}`, 350);

    try {
      const stripe = stripeFor(key);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: lines.map((l) => ({
          quantity: l.quantity,
          // Only a plain single-item order can change quantity on Stripe's
          // page. Sets and league orders keep the exact quantities chosen.
          // The most it allows stays under the first bulk tier, so nobody pays
          // full price for an order that should have been discounted.
          ...(one && one.mode === 'standard' && order.single
            ? { adjustable_quantity: { enabled: true, minimum: 1, maximum: Math.max(1, Math.min(store.maxQuantity, (shop.bulkTiers[0]?.minQuantity ?? store.maxQuantity + 1) - 1)) } }
            : {}),
          price_data: {
            currency: catalog.currency,
            unit_amount: l.unitCents,
            ...(tax ? { tax_behavior: 'exclusive' } : {}),
            product_data: {
              name: l.name,
              ...(l.unitCents < l.regularUnitCents ? { description: `Bulk price: ${quote.bulk.percentOff}% off ${quote.bulk.minQuantity}+ items.` } : {}),
              metadata: l.metadata,
            },
          },
        })),
        shipping_address_collection: { allowed_countries: ['US'] },
        shipping_options: [
          {
            shipping_rate_data: {
              type: 'fixed_amount',
              display_name: store.shippingLabel,
              fixed_amount: { amount: store.shippingCents, currency: catalog.currency },
              ...(tax ? { tax_behavior: 'exclusive' } : {}),
              delivery_estimate: {
                minimum: { unit: 'business_day', value: store.shipMinDays },
                maximum: { unit: 'business_day', value: store.shipMaxDays },
              },
            },
          },
        ],
        ...(tax ? { automatic_tax: { enabled: true } } : {}),
        // Asks the shopper whether they want marketing email. Their answer is
        // the only thing that ever makes them eligible for a campaign.
        ...(store.collectMarketingConsent === true ? { consent_collection: { promotions: 'auto' } } : {}),
        metadata: summary,
        payment_intent_data: { description, metadata: summary },
        success_url: `${site}/success/`,
        cancel_url: one && order.single ? `${site}/cancel/?city=${one.slug}` : `${site}/cart/?canceled=1`,
      });

      if (order.wantsJson) return json({ url: session.url });
      return new Response(null, { status: 303, headers: { Location: session.url, 'Cache-Control': 'no-store' } });
    } catch (err) {
      console.error('Stripe could not start checkout:', err?.message ?? err);
      return fail(order.wantsJson, 502, "Checkout didn't open.");
    }
  };
}
