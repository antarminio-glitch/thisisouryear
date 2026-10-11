// Starts a Stripe Checkout session for one shirt.
//
// The browser sends only two things: which city (slug) and which size.
// Everything else, including the price, is decided here on the server from
// the two data files below. A price sent from the browser is ignored.
//
// Needs these environment variables, set in Netlify (never in this repo):
//   STRIPE_SECRET_KEY   your Stripe secret key (test key first, live key later)
//   SITE_URL            optional, e.g. https://thisisouryear.team

import Stripe from 'stripe';
import teams from '../../src/data/teams.json' with { type: 'json' };
import product from '../../src/data/product.json' with { type: 'json' };

const CURRENCY = 'usd';

function reply(wantsJson, status, message) {
  const headers = { 'Cache-Control': 'no-store' };
  return wantsJson
    ? Response.json({ error: message }, { status, headers })
    : new Response(`${message} Go back and try again.`, { status, headers });
}

// The buy button sends JSON. A plain HTML form post (no JavaScript) works too.
async function readOrder(req) {
  const type = req.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/json')) {
      const body = await req.json();
      return { slug: body?.slug, size: body?.size, wantsJson: true };
    }
    const form = await req.formData();
    return { slug: form.get('slug'), size: form.get('size'), wantsJson: false };
  } catch {
    return { slug: null, size: null, wantsJson: type.includes('application/json') };
  }
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  const { slug, size, wantsJson } = await readOrder(req);

  // Only accept a city and a size that actually exist.
  const team = typeof slug === 'string' ? teams.find((t) => t.slug === slug) : undefined;
  if (!team) return reply(wantsJson, 400, "We don't have that city.");
  if (typeof size !== 'string' || !product.sizes.includes(size)) {
    return reply(wantsJson, 400, "We don't have that size.");
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('STRIPE_SECRET_KEY is not set. Add it in Netlify under Environment variables.');
    return reply(wantsJson, 500, "Checkout isn't set up yet.");
  }

  // The price is set here and only here.
  const upcharge = product.upchargeSizes.includes(size) ? product.upchargeCents : 0;
  const unitAmount = product.priceCents + upcharge;

  // Where Stripe sends the customer afterwards. Uses SITE_URL if it's set,
  // otherwise whatever address this request came in on.
  const site = (process.env.SITE_URL || new URL(req.url).origin).replace(/\/+$/, '');

  // This is the line the print vendor reads, so it spells everything out.
  const itemName = `${product.name}, ${team.name}, ${team.colors}, Size ${size}`;
  const metadata = { city: team.name, colors: team.colors, size, slug: team.slug };
  const tax = product.automaticTax === true;

  try {
    const stripe = new Stripe(key);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          adjustable_quantity: { enabled: true, minimum: 1, maximum: product.maxQuantity },
          price_data: {
            currency: CURRENCY,
            unit_amount: unitAmount,
            ...(tax ? { tax_behavior: 'exclusive' } : {}),
            product_data: { name: itemName, metadata },
          },
        },
      ],
      shipping_address_collection: { allowed_countries: ['US'] },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            display_name: product.shippingLabel,
            fixed_amount: { amount: product.shippingCents, currency: CURRENCY },
            ...(tax ? { tax_behavior: 'exclusive' } : {}),
            delivery_estimate: {
              minimum: { unit: 'business_day', value: product.shipMinDays },
              maximum: { unit: 'business_day', value: product.shipMaxDays },
            },
          },
        },
      ],
      ...(tax ? { automatic_tax: { enabled: true } } : {}),
      // Saved on the checkout session and on the payment, so the city, colors
      // and size show up wherever you look in the Stripe dashboard.
      metadata,
      payment_intent_data: { description: itemName, metadata },
      success_url: `${site}/success/`,
      cancel_url: `${site}/cancel/?city=${team.slug}`,
    });

    if (wantsJson) {
      return Response.json({ url: session.url }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return new Response(null, { status: 303, headers: { Location: session.url, 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('Stripe could not start checkout:', err?.message ?? err);
    return reply(wantsJson, 502, "Checkout didn't open.");
  }
};
