// Records paid orders, from Stripe's own verified messages.
//
// Stripe calls this after a payment goes through. The message is signed, and
// the signature is checked before anything is believed. Without the signing
// secret this does nothing at all.
//
// Paid orders are what campaigns and reports are built from. A button click on
// the site is never counted as a sale.
import { json, sha256 } from './http.js';
import { shipToFrom, sendOrderEmail } from './order-email.js';
import { sendToPrintify } from './printify.js';

const LINE_KEYS = [
  'team_id', 'design_id', 'product_id', 'product_style', 'audience', 'size', 'purchase_mode', 'bundle_id',
  'league_order_id', 'recipient_team_id', 'variant_key', 'provider_variant_id', 'artwork_version', 'colorway_version',
  'league_name', 'gift_note', 'print_approval', 'bulk_percent_off',
];

export const customerIdFor = (email) => `c_${sha256(String(email).trim().toLowerCase()).slice(0, 24)}`;

export async function recordPaidOrder({ session, stripe, storage, now }) {
  const orders = storage.store('orders');
  const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100, expand: ['data.price.product'] });
  const email = String(session.customer_details?.email ?? '').trim().toLowerCase();
  const record = {
    id: session.id,
    paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null),
    createdAt: now().toISOString(),
    email,
    customerId: email ? customerIdFor(email) : null,
    // Stripe reports "opt_in", "opt_out" or nothing. Nothing is not consent.
    marketingConsent: session.consent?.promotions ?? 'unknown',
    favoriteTeamId: session.metadata?.customer_favorite_team_id ?? null,
    status: 'paid',
    totalCents: session.amount_total ?? null,
    // Where the vendor ships it. Stripe collected it at checkout.
    shipTo: shipToFrom(session),
    bulkPercentOff: session.metadata?.bulk_percent_off ? Number(session.metadata.bulk_percent_off) : 0,
    lines: (items.data ?? []).map((li) => {
      const meta = li.price?.product?.metadata ?? {};
      const line = { quantity: li.quantity ?? 1, amountCents: li.amount_total ?? null };
      for (const k of LINE_KEYS) if (meta[k]) line[k] = meta[k];
      return line;
    }),
  };
  // Stripe can deliver the same message more than once. Only the first counts.
  const saved = await orders.setIfNew(`order/${session.id}`, record);
  if (saved && record.paymentIntent) await orders.set(`pi/${record.paymentIntent}`, { orderId: session.id });
  return { saved, record };
}

export async function markRefunded({ charge, storage, now }) {
  const orders = storage.store('orders');
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  const link = pi ? await orders.get(`pi/${pi}`) : null;
  if (!link) return { found: false };
  const order = await orders.get(`order/${link.orderId}`);
  if (!order) return { found: false };
  order.status = charge.refunded === true ? 'refunded' : 'partially_refunded';
  order.refundedCents = charge.amount_refunded ?? null;
  order.refundedAt = now().toISOString();
  await orders.set(`order/${link.orderId}`, order);
  return { found: true, order };
}

// `shop` and `palettes` are only needed for the order email to the vendor,
// and `printify` (src/data/printify.json) for sending orders to Printify.
export function makeWebhookHandler({ env, stripeFor, getStorage, shop = null, palettes = null, printify = null, fetchImpl = fetch, now = () => new Date() }) {
  return async (req) => {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    const secret = env.STRIPE_WEBHOOK_SECRET;
    const key = env.STRIPE_SECRET_KEY;
    if (!secret || !key) {
      return json({ error: 'webhook_not_configured', message: 'Set STRIPE_WEBHOOK_SECRET and STRIPE_SECRET_KEY in Netlify to record paid orders.' }, 503);
    }

    const stripe = stripeFor(key);
    const payload = await req.text();
    let event;
    try {
      event = await stripe.webhooks.constructEventAsync(payload, req.headers.get('stripe-signature') ?? '', secret);
    } catch (err) {
      console.error('Rejected a webhook with a bad signature:', err?.message ?? err);
      return json({ error: 'bad_signature' }, 400);
    }

    const storage = await getStorage();
    try {
      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        const session = event.data.object;
        // "completed" can arrive before a slow payment method has paid.
        if (session.payment_status === 'paid') {
          await recordPaidOrder({ session, stripe, storage, now });
          // Tell the vendor. Runs again on Stripe's repeats, but only ever
          // sends once. If it fails, Stripe is told, and tries again later.
          let sent = null;
          if (shop) {
            sent = await sendOrderEmail({ orderId: session.id, storage, shop, palettes, env, fetchImpl, now });
            if (sent.status === 'not_configured') console.warn(`Order ${session.id} recorded, but no order email went out. Missing: ${sent.missing.join(', ')}.`);
          }
          // Printify prints and ships it. Also only ever once per order.
          const made = printify ? await sendToPrintify({ orderId: session.id, storage, map: printify, env, fetchImpl, now }) : null;
          if (made?.status === 'not_configured') console.warn(`Order ${session.id} recorded, but not sent to Printify. Missing: ${made.missing.join(', ')}.`);
          if (made?.skipped?.length) console.warn(`Order ${session.id}: ${made.skipped.length} item(s) not sent to Printify. See the order email.`);
          const failed = [sent?.status === 'failed' && `Order email failed: ${sent.error}`, made?.status === 'failed' && `Printify failed: ${made.error}`].filter(Boolean);
          if (failed.length) throw new Error(failed.join(' '));
        }
      } else if (event.type === 'charge.refunded') {
        await markRefunded({ charge: event.data.object, storage, now });
      }
    } catch (err) {
      // Tell Stripe it failed so it tries again later.
      console.error('Could not record a Stripe event:', err?.message ?? err);
      return json({ error: 'not_recorded' }, 500);
    }
    return json({ received: true });
  };
}
