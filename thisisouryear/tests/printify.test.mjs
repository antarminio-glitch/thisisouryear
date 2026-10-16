// Sending paid orders to Printify: the right product and size, once per
// order, and nothing sent when it isn't set up.
import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { realShop, fakeStripe, memoryStorage } from './fixtures.mjs';
import printifyMap from '../src/data/printify.json' with { type: 'json' };
import { makeWebhookHandler } from '../src/server/orders.js';
import { orderRef } from '../src/server/order-email.js';
import { variantForSize, splitName, planLines, printifySettings } from '../src/server/printify.js';

const SECRET = 'whsec_unit_tests_only';
const ENV = { STRIPE_SECRET_KEY: 'sk_test_unit_tests_only', STRIPE_WEBHOOK_SECRET: SECRET, PRINTIFY_API_TOKEN: 'printify_unit_tests_only', PRINTIFY_API_BASE: 'https://printify.test/v1' };
const MAP = { shopId: '111', products: { dallas: { 'adult-tee': 'p_tee', 'adult-hoodie': 'p_hood' } } };

// A Printify product with one color and the usual sizes. 3XL is switched off.
const product = (id) => ({
  id,
  options: [
    { name: 'Colors', type: 'color', values: [{ id: 1, title: 'Navy' }] },
    { name: 'Sizes', type: 'size', values: ['S', 'M', 'L', 'XL', '2XL', '3XL'].map((title, i) => ({ id: 10 + i, title })) },
  ],
  variants: ['S', 'M', 'L', 'XL', '2XL', '3XL'].map((s, i) => ({ id: Number(`${id === 'p_tee' ? 1 : 2}00${i}`), title: `Navy / ${s}`, options: [1, 10 + i], is_enabled: s !== '3XL' })),
});

function fakePrintify({ fail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    if (fail) return new Response(JSON.stringify({ message: 'down' }), { status: 503 });
    const m = url.match(/\/products\/(\w+)\.json$/);
    if (m) return new Response(JSON.stringify(product(m[1])), { status: 200 });
    if (url.endsWith('/orders.json')) return new Response(JSON.stringify({ id: 'po_1' }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  return { calls, fetchImpl, orders: () => calls.filter((c) => c.url.endsWith('/orders.json')) };
}

const SHIP = { name: 'Jane Q Fan', address: { line1: '123 Main St', line2: 'Apt 4', city: 'Brooklyn', state: 'NY', postal_code: '11201', country: 'US' } };
const paidEvent = (id = 'evt_1') => ({ id, type: 'checkout.session.completed', data: { object: { id: 'cs_test_P', payment_status: 'paid', payment_intent: 'pi_P', amount_total: 9000, customer_details: { email: 'buyer@example.com', name: 'Jane Q Fan' }, collected_information: { shipping_details: SHIP }, metadata: {} } } });
async function signed(event) {
  const payload = JSON.stringify(event);
  const header = await new Stripe('sk_test_unit_tests_only').webhooks.generateTestHeaderStringAsync({ payload, secret: SECRET });
  return new Request('https://example.test/.netlify/functions/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': header }, body: payload });
}
const meta = (over = {}) => ({ team_id: 'dallas', design_id: 'this-is-our-year', product_id: 'adult-tee', size: 'L', purchase_mode: 'standard', ...over });

function setup({ env = ENV, map = MAP, fail = false, lines = [[meta(), 2]] } = {}) {
  const stripe = fakeStripe();
  stripe.lineItems = lines.map(([m, quantity]) => ({ quantity, amount_total: 2499 * quantity, price: { product: { metadata: m } } }));
  const storage = memoryStorage();
  const printify = fakePrintify({ fail });
  const handler = makeWebhookHandler({ env, stripeFor: () => stripe, getStorage: async () => storage, printify: map, fetchImpl: printify.fetchImpl, now: () => new Date('2026-10-16T02:00:00Z') });
  return { storage, printify, handler };
}

test('a paid order becomes one Printify order with the right product, size, quantity and address', async () => {
  const { storage, printify, handler } = setup({ lines: [[meta(), 2], [meta({ product_id: 'adult-hoodie', size: '2XL' }), 1]] });
  assert.equal((await handler(await signed(paidEvent()))).status, 200);
  const [order] = printify.orders();
  assert.equal(order.url, 'https://printify.test/v1/shops/111/orders.json');
  assert.equal(order.headers.Authorization, 'Bearer printify_unit_tests_only');
  assert.deepEqual(order.body.line_items, [
    { product_id: 'p_tee', variant_id: 1002, quantity: 2 },
    { product_id: 'p_hood', variant_id: 2004, quantity: 1 },
  ]);
  assert.equal(order.body.external_id, orderRef('cs_test_P'));
  assert.deepEqual(order.body.address_to, { first_name: 'Jane Q', last_name: 'Fan', country: 'US', region: 'NY', address1: '123 Main St', address2: 'Apt 4', city: 'Brooklyn', zip: '11201' });
  assert.ok(!JSON.stringify(order.body).includes('buyer@example.com'), 'no customer email, as the privacy page says');
  assert.equal(printify.calls.filter((c) => c.url.includes('send_to_production')).length, 0, 'waits for approval by default');
  const saved = await storage.store('orders').get('order/cs_test_P');
  assert.equal(saved.printify.status, 'created');
  assert.equal(saved.printify.id, 'po_1');
});

test('Stripe repeating the message never makes a second Printify order', async () => {
  const { printify, handler } = setup();
  await handler(await signed(paidEvent()));
  await handler(await signed(paidEvent()));
  await handler(await signed({ ...paidEvent('evt_2'), type: 'checkout.session.async_payment_succeeded' }));
  assert.equal(printify.orders().length, 1);
});

test('PRINTIFY_AUTO_SEND=true sends the order straight to production', async () => {
  const { storage, printify, handler } = setup({ env: { ...ENV, PRINTIFY_AUTO_SEND: 'true' } });
  await handler(await signed(paidEvent()));
  assert.ok(printify.calls.some((c) => c.method === 'POST' && c.url === 'https://printify.test/v1/shops/111/orders/po_1/send_to_production.json'));
  assert.equal((await storage.store('orders').get('order/cs_test_P')).printify.status, 'created');
});

test('items with no Printify product, like the kids tee, are left out and listed on the order', async () => {
  const { storage, printify, handler } = setup({ lines: [[meta(), 1], [meta({ product_id: 'kids-tee', size: 'YM' }), 1], [meta({ size: '3XL' }), 1]] });
  await handler(await signed(paidEvent()));
  assert.deepEqual(printify.orders()[0].body.line_items, [{ product_id: 'p_tee', variant_id: 1002, quantity: 1 }]);
  const { printify: p } = await storage.store('orders').get('order/cs_test_P');
  assert.deepEqual(p.skipped.map((s) => s.item), [2, 3]);
});

test('an order with nothing Printify can make sends nothing', async () => {
  const { storage, printify, handler } = setup({ lines: [[meta({ team_id: 'chicago' }), 1]] });
  assert.equal((await handler(await signed(paidEvent()))).status, 200);
  assert.equal(printify.calls.length, 0);
  assert.equal((await storage.store('orders').get('order/cs_test_P')).printify.status, 'nothing_to_send');
});

test('without a token nothing is sent, and the order is still recorded', async () => {
  const env = { ...ENV };
  delete env.PRINTIFY_API_TOKEN;
  const { storage, printify, handler } = setup({ env });
  assert.equal((await handler(await signed(paidEvent()))).status, 200);
  assert.equal(printify.calls.length, 0);
  const saved = await storage.store('orders').get('order/cs_test_P');
  assert.equal(saved.status, 'paid');
  assert.equal(saved.printify.status, 'not_configured');
});

test('if Printify is down, Stripe is told so it tries again, and the retry sends it', async () => {
  const s = setup({ fail: true });
  assert.equal((await s.handler(await signed(paidEvent()))).status, 500);
  assert.equal((await s.storage.store('orders').get('order/cs_test_P')).printify.status, 'failed');
  const ok = fakePrintify();
  const retry = makeWebhookHandler({ env: ENV, stripeFor: () => fakeStripe(), getStorage: async () => s.storage, printify: MAP, fetchImpl: ok.fetchImpl, now: () => new Date('2026-10-16T02:05:00Z') });
  assert.equal((await retry(await signed(paidEvent()))).status, 200);
  assert.equal(ok.orders().length, 1);
});

test('sizes match the product options, and only switched-on variants count', () => {
  const p = product('p_tee');
  assert.equal(variantForSize(p, 'S').id, 1000);
  assert.equal(variantForSize(p, '2xl').id, 1004);
  assert.equal(variantForSize(p, '3XL'), null);
  assert.equal(variantForSize(p, 'YM'), null);
  assert.equal(variantForSize({ variants: [{ id: 9, title: 'Black / M' }] }, 'M').id, 9, 'falls back to the variant title');
});

test('names split into first and last for Printify', () => {
  assert.deepEqual(splitName('Jane Fan'), { first_name: 'Jane', last_name: 'Fan' });
  assert.deepEqual(splitName('Cher'), { first_name: 'Cher', last_name: 'Cher' });
  assert.deepEqual(splitName(''), { first_name: 'Customer', last_name: 'Customer' });
});

test('settings: the shop comes from printify.json unless PRINTIFY_SHOP_ID overrides it', () => {
  assert.equal(printifySettings({ PRINTIFY_API_TOKEN: 'x' }, MAP).shopId, '111');
  assert.equal(printifySettings({ PRINTIFY_API_TOKEN: 'x', PRINTIFY_SHOP_ID: '222' }, MAP).shopId, '222');
  assert.deepEqual(printifySettings({}, { products: {} }).missing, ['PRINTIFY_API_TOKEN', 'PRINTIFY_SHOP_ID']);
  assert.deepEqual(planLines({ lines: [meta()] }, MAP).lines, [{ item: 1, productId: 'p_tee', size: 'L', quantity: 1 }]);
});

test('every city in printify.json is a real city with real garments', () => {
  const shop = realShop();
  for (const [slug, products] of Object.entries(printifyMap.products)) {
    assert.ok(shop.city(slug), `${slug} is not a city`);
    for (const id of Object.keys(products)) assert.ok(shop.product(id), `${slug}: ${id} is not a product`);
  }
});
