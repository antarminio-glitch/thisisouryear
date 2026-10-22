import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { realShop, fixtureShop, fakeStripe, post, memoryStorage } from './fixtures.mjs';
import { makeCheckoutHandler, makeQuoteHandler } from '../src/server/checkout.js';
import { makeWebhookHandler } from '../src/server/orders.js';
import { makeQuoteRequestHandler } from '../src/server/quotes.js';

const KEY = { STRIPE_SECRET_KEY: 'sk_test_unit_tests_only' };
function setup(shop = realShop(), env = KEY) {
  const stripe = fakeStripe();
  return { stripe, handler: makeCheckoutHandler({ shop, env, stripeFor: () => stripe }) };
}
const item = (over = {}) => ({ productId: 'adult-tee', designId: 'this-is-our-year', slug: 'dallas', size: 'L', quantity: 1, mode: 'standard', ...over });

test('the original buy button still works: { slug, size } opens checkout for one tee', async () => {
  const { stripe, handler } = setup();
  const res = await handler(post({ slug: 'dallas', size: 'L', price: 1 }));
  assert.equal(res.status, 200);
  assert.match((await res.json()).url, /^https:\/\/checkout\.stripe\.com\//);
  const p = stripe.calls[0];
  assert.equal(p.mode, 'payment');
  assert.equal(p.line_items.length, 1);
  assert.equal(p.line_items[0].price_data.unit_amount, 2499);
  assert.equal(p.line_items[0].price_data.product_data.name, 'This Is Our Year Tee, Dallas, Navy / Silver, Size L');
  // Capped one below the first bulk tier, and below the free-shipping line (4 tees is $99.96).
  assert.deepEqual(p.line_items[0].adjustable_quantity, { enabled: true, minimum: 1, maximum: 4 });
  assert.deepEqual(p.shipping_address_collection, { allowed_countries: ['US'] });
  assert.equal(p.shipping_options[0].shipping_rate_data.fixed_amount.amount, 750);
  assert.equal(p.metadata.city, 'Dallas');
  assert.equal(p.metadata.colors, 'Navy / Silver');
  assert.equal(p.metadata.size, 'L');
  assert.equal(p.payment_intent_data.metadata.team_id, 'dallas');
  assert.equal(p.success_url, 'https://example.test/success/');
  assert.equal(p.cancel_url, 'https://example.test/cancel/?city=dallas');
  assert.equal(p.consent_collection, undefined, 'marketing consent is off until switched on');
  assert.equal(p.automatic_tax, undefined);
});

test('a plain form post works without JavaScript and redirects to Stripe', async () => {
  const { handler } = setup();
  const res = await handler(new Request('https://example.test/x', { method: 'POST', body: new URLSearchParams({ slug: 'green-bay', size: '3XL' }) }));
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /checkout\.stripe\.com/);
});

test('bad input never reaches Stripe', async () => {
  const { stripe, handler } = setup();
  for (const body of [{ slug: 'nowhere', size: 'L' }, { slug: 'dallas', size: '9XL' }, { slug: 'dallas' }, { slug: { a: 1 }, size: 'L' }, '{not json', { items: [] }, { items: [item({ productId: 'kids-hoodie' })] }]) {
    const res = await handler(post(body));
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal((await handler(new Request('https://example.test/x'))).status, 405);
  assert.equal(stripe.calls.length, 0);
});

test('a missing Stripe key is reported honestly', async () => {
  const { stripe, handler } = setup(realShop(), {});
  const res = await handler(post({ slug: 'dallas', size: 'L' }));
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, "Checkout isn't set up yet.");
  assert.equal(stripe.calls.length, 0);
});

test('SITE_URL is used for the return addresses when it is set', async () => {
  const { stripe, handler } = setup(realShop(), { ...KEY, SITE_URL: 'https://thisisouryear.team/' });
  await handler(post({ slug: 'dallas', size: 'L' }));
  assert.equal(stripe.calls[0].success_url, 'https://thisisouryear.team/success/');
});

test('a hoodie order reaches checkout once hoodies are in the catalog', async () => {
  const { stripe, handler } = setup(fixtureShop());
  const res = await handler(post({ items: [item({ productId: 'adult-hoodie', size: 'M', slug: 'chicago' })] }));
  assert.equal(res.status, 200);
  const li = stripe.calls[0].line_items[0];
  assert.equal(li.price_data.unit_amount, 4400);
  assert.equal(li.price_data.product_data.name, 'This Is Our Year Hoodie, Chicago, Navy / Orange, Size M');
  assert.equal(li.price_data.product_data.metadata.product_style, 'hoodie');
  assert.equal(li.price_data.product_data.metadata.provider_variant_id, 'TEST-adult-hoodie-M');
  assert.equal(li.adjustable_quantity, undefined);
  assert.equal(stripe.calls[0].cancel_url, 'https://example.test/cart/?canceled=1');
});

test('a kids order reaches checkout once kids items are in the catalog', async () => {
  const { stripe, handler } = setup(fixtureShop());
  const res = await handler(post({ items: [item({ productId: 'kids-hoodie', size: 'YS', slug: 'miami', quantity: 2 })] }));
  assert.equal(res.status, 200);
  const li = stripe.calls[0].line_items[0];
  assert.equal(li.quantity, 2);
  assert.equal(li.price_data.product_data.metadata.audience, 'kids');
});

test('a matching set checks out as two line items with one bundle id', async () => {
  const { stripe, handler } = setup(fixtureShop());
  const res = await handler(post({ items: [
    item({ mode: 'matching_set', bundleId: 'B-77', size: 'XL', slug: 'detroit' }),
    item({ mode: 'matching_set', bundleId: 'B-77', productId: 'kids-tee', size: 'YS', slug: 'detroit' }),
  ] }));
  assert.equal(res.status, 200);
  const p = stripe.calls[0];
  assert.equal(p.line_items.length, 2);
  assert.deepEqual(p.line_items.map((l) => l.price_data.product_data.metadata.bundle_id), ['B-77', 'B-77']);
  assert.deepEqual(p.line_items.map((l) => l.price_data.unit_amount), [2499, 1500]);
  assert.equal(p.metadata.bundle_ids, 'B-77');
  assert.equal(p.metadata.purchase_modes, 'matching_set');
});

test('half a matching set is refused with the reason, and nothing is charged', async () => {
  const { stripe, handler } = setup(fixtureShop());
  const res = await handler(post({ items: [
    item({ mode: 'matching_set', bundleId: 'B-78' }),
    item({ mode: 'matching_set', bundleId: 'B-78', productId: 'kids-tee', size: 'YL' }),
  ] }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.quote.lines[0].code, 'set_incomplete');
  assert.equal(body.quote.lines[1].code, 'out_of_stock');
  assert.equal(stripe.calls.length, 0);
});

test('a rival gift does not turn the buyer into a fan of the colors they bought', async () => {
  const { stripe, handler } = setup();
  const res = await handler(post({ favoriteSlug: 'philadelphia', items: [item({ mode: 'rival_gift', slug: 'dallas', recipientSlug: 'philadelphia' })] }));
  assert.equal(res.status, 200);
  const p = stripe.calls[0];
  assert.equal(p.metadata.customer_favorite_team_id, 'philadelphia');
  assert.equal(p.metadata.team_id, 'dallas');
  assert.equal(p.metadata.recipient_team_id, 'philadelphia');
  assert.equal(p.metadata.purchase_mode, 'rival_gift');
  assert.equal(p.line_items[0].adjustable_quantity, undefined);
});

test('a favorite city is never guessed from what was bought', async () => {
  const { stripe, handler } = setup();
  await handler(post({ items: [item()] }));
  await handler(post({ favoriteSlug: 'not-a-city', items: [item()] }));
  assert.equal(stripe.calls[0].metadata.customer_favorite_team_id, undefined);
  assert.equal(stripe.calls[1].metadata.customer_favorite_team_id, undefined);
});

test('a mixed-size league order checks out with exact quantities and its league id', async () => {
  const { stripe, handler } = setup();
  const rows = [['S', 2], ['M', 4], ['2XL', 1]].map(([size, quantity]) => item({ mode: 'fantasy_punishment', slug: 'kansas-city', size, quantity, leagueOrderId: 'LG-9', leagueName: 'Sunday Regrets' }));
  const res = await handler(post({ items: rows }));
  assert.equal(res.status, 200);
  const p = stripe.calls[0];
  assert.deepEqual(p.line_items.map((l) => l.quantity), [2, 4, 1]);
  assert.deepEqual(p.line_items.map((l) => l.price_data.unit_amount), [2499, 2499, 2699]);
  assert.equal(p.metadata.league_order_ids, 'LG-9');
  assert.equal(p.metadata.league_name, 'Sunday Regrets');
  assert.equal(p.metadata.item_count, '7');
  assert.ok(Object.values(p.metadata).every((v) => String(v).length <= 500));
  assert.ok(Object.keys(p.metadata).length <= 50);
});

test('marketing consent is only requested when the store setting is on', async () => {
  const { stripe, handler } = setup(fixtureShop({ collectMarketingConsent: true }));
  await handler(post({ slug: 'dallas', size: 'L' }));
  assert.deepEqual(stripe.calls[0].consent_collection, { promotions: 'auto' });
});

test('the cart price check returns server prices and per-line problems', async () => {
  const quote = makeQuoteHandler({ shop: realShop() });
  const res = await quote(post({ items: [item({ seenPriceCents: 1500 }), item({ productId: 'kids-hoodie' })] }));
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.lines[0].ok, true);
  assert.equal(body.lines[0].unitCents, 2499);
  assert.equal(body.lines[0].notices[0].code, 'price_changed');
  assert.equal(body.lines[1].code, 'product_unavailable');
  assert.equal(body.totalCents, 0);
});

// ---- payment webhook
const SECRET = 'whsec_unit_tests_only';
async function signed(event) {
  const payload = JSON.stringify(event);
  const header = await new Stripe('sk_test_unit_tests_only').webhooks.generateTestHeaderStringAsync({ payload, secret: SECRET });
  return new Request('https://example.test/.netlify/functions/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': header }, body: payload });
}
function webhookSetup(env = { ...KEY, STRIPE_WEBHOOK_SECRET: SECRET }) {
  const stripe = fakeStripe();
  const storage = memoryStorage();
  stripe.lineItems = [{ quantity: 2, amount_total: 3998, price: { product: { metadata: { team_id: 'dallas', design_id: 'this-is-our-year', product_id: 'adult-tee', size: 'L', purchase_mode: 'standard' } } } }];
  return { stripe, storage, handler: makeWebhookHandler({ env, stripeFor: () => stripe, getStorage: async () => storage, now: () => new Date('2026-10-10T12:00:00Z') }) };
}
const paidEvent = (over = {}) => ({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_A', payment_status: 'paid', payment_intent: 'pi_A', amount_total: 4497, customer_details: { email: 'Fan@Example.com' }, consent: { promotions: 'opt_in' }, metadata: { customer_favorite_team_id: 'dallas' }, ...over } } });

test('a signed payment message records the order once, even if Stripe sends it twice', async () => {
  const { storage, handler } = webhookSetup();
  assert.equal((await handler(await signed(paidEvent()))).status, 200);
  assert.equal((await handler(await signed(paidEvent()))).status, 200);
  const keys = await storage.store('orders').list('order/');
  assert.deepEqual(keys, ['order/cs_test_A']);
  const order = await storage.store('orders').get('order/cs_test_A');
  assert.equal(order.email, 'fan@example.com');
  assert.equal(order.status, 'paid');
  assert.equal(order.marketingConsent, 'opt_in');
  assert.equal(order.lines[0].team_id, 'dallas');
  assert.equal(order.lines[0].quantity, 2);
});

test('an unsigned or tampered message is rejected and records nothing', async () => {
  const { storage, handler } = webhookSetup();
  const forged = new Request('https://example.test/x', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=deadbeef' }, body: JSON.stringify(paidEvent()) });
  assert.equal((await handler(forged)).status, 400);
  const req = await signed(paidEvent());
  const tampered = new Request(req.url, { method: 'POST', headers: req.headers, body: (await req.text()).replace('4497', '1') });
  assert.equal((await handler(tampered)).status, 400);
  assert.deepEqual(await storage.store('orders').list(''), []);
});

test('an unpaid session is not recorded as a sale', async () => {
  const { storage, handler } = webhookSetup();
  await handler(await signed(paidEvent({ payment_status: 'unpaid' })));
  assert.deepEqual(await storage.store('orders').list('order/'), []);
});

test('a refund marks the order so campaigns leave it alone', async () => {
  const { storage, handler } = webhookSetup();
  await handler(await signed(paidEvent()));
  await handler(await signed({ id: 'evt_2', type: 'charge.refunded', data: { object: { payment_intent: 'pi_A', refunded: true, amount_refunded: 4497 } } }));
  assert.equal((await storage.store('orders').get('order/cs_test_A')).status, 'refunded');
});

test('without the signing secret the webhook does nothing', async () => {
  const { storage, handler } = webhookSetup(KEY);
  const res = await handler(await signed(paidEvent()));
  assert.equal(res.status, 503);
  assert.deepEqual(await storage.store('orders').list(''), []);
});

// ---- bulk quote requests
function quoteSetup(shop = realShop(), failing = false) {
  const storage = memoryStorage();
  const getStorage = failing ? async () => { throw new Error('storage down'); } : async () => storage;
  return { storage, handler: makeQuoteRequestHandler({ shop, getStorage, now: () => new Date('2026-10-10T12:00:00Z') }) };
}
const quoteBody = (over = {}) => ({ email: 'commish@example.com', slug: 'dallas', leagueName: 'Sunday Regrets', rows: [{ productId: 'adult-tee', size: 'L', quantity: 12 }, { productId: 'kids-hoodie', size: 'L', quantity: 2 }], ...over });

test('a bulk quote request is really saved, with what could be bought today', async () => {
  const { storage, handler } = quoteSetup();
  const res = await handler(post(quoteBody()));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.saved, true);
  assert.match(body.reference, /^Q-[2-9A-Z]{8}$/);
  const saved = await storage.store('quotes').get(`quote/${body.reference}`);
  assert.equal(saved.totalQuantity, 14);
  assert.equal(saved.rows[0].availableNow, true);
  assert.equal(saved.rows[0].unitCentsToday, 2499);
  assert.equal(saved.rows[1].availableNow, false);
  assert.equal(saved.regularTotalCentsToday, null, 'no total is invented when a row has no price');
  assert.equal(body.regularTotal, null);
  assert.equal(saved.status, 'new');
});

test('if a quote cannot be saved the shopper is told, not shown a fake success', async () => {
  const { handler } = quoteSetup(realShop(), true);
  const res = await handler(post(quoteBody()));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).saved, false);
});

test('quote requests are validated', async () => {
  const { storage, handler } = quoteSetup();
  for (const bad of [quoteBody({ email: 'nope' }), quoteBody({ slug: 'nowhere' }), quoteBody({ rows: [] }), quoteBody({ rows: [{ productId: 'adult-tee', size: 'L', quantity: 0 }] }), quoteBody({ rows: [{ productId: 'socks', size: 'L', quantity: 1 }] }), quoteBody({ website: 'http://spam' }), quoteBody({ leagueName: 'x'.repeat(61) })]) {
    assert.equal((await handler(post(bad))).status, 400);
  }
  assert.deepEqual(await storage.store('quotes').list(''), []);
});
