// Sending paid orders to Printify: matching blank colors, building the order,
// sending it once, and the owner's controls. Printify itself is played by a
// stand-in that records every request.
import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import fs from 'node:fs';
import { realShop, fakeStripe, memoryStorage, data } from './fixtures.mjs';
import { makeWebhookHandler } from '../src/server/orders.js';
import { makeAdminHandler } from '../src/server/admin.js';
import { mapProvider, scanCatalog, placementFor, buildPrintifyOrder, colorDistance, KEY_CATALOG } from '../src/server/printify.js';
import { printFileName } from '../src/lib/print-file.js';
import { orderRef } from '../src/server/order-email.js';

const config = JSON.parse(fs.readFileSync(new URL('../src/data/printify.json', import.meta.url), 'utf8'));
const SECRET = 'whsec_unit_tests_only';
const SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const ALL_COLORS = Object.keys(config.colors);

// Variants as Printify's catalog lists them: one per color and size.
function variantsFor(colors, idBase) {
  let id = idBase;
  return colors.flatMap((color) => SIZES.map((size) => ({ id: id++, title: `${color} / ${size}`, options: { color, size }, placeholders: [{ position: 'front', width: 3852, height: 4398 }] })));
}

function fakePrintify({ shops = [{ id: 777, title: 'This Is Our Year', sales_channel: 'custom_integration' }], failOrders = 0, rejectOrders = false } = {}) {
  const calls = [];
  let orderCount = 0;
  let failures = 0;
  const catalogs = { 29: variantsFor(ALL_COLORS, 10000), 99: variantsFor(['Black', 'White'], 50000) };
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname.replace(/^\/v1/, '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path, body, auth: init.headers?.Authorization });
    const ok = (obj) => new Response(JSON.stringify(obj), { status: 200 });
    if (method === 'GET' && path === '/shops.json') return ok(shops);
    if (method === 'GET' && path === '/catalog/blueprints/12.json') return ok({ id: 12, title: 'Unisex Jersey Short Sleeve Tee', brand: 'Bella+Canvas', model: '3001' });
    if (method === 'GET' && path === '/catalog/blueprints/12/print_providers.json') return ok([{ id: 29, title: 'Big Printer' }, { id: 99, title: 'Small Printer' }]);
    const v = path.match(/^\/catalog\/blueprints\/12\/print_providers\/(\d+)\/variants\.json$/);
    if (method === 'GET' && v) return ok({ id: 12, title: 'tee', variants: catalogs[v[1]] ?? [] });
    if (method === 'POST' && /^\/shops\/777\/orders\.json$/.test(path)) {
      if (failures < failOrders) {
        failures++;
        return new Response(JSON.stringify({ message: 'Internal error' }), { status: 500 });
      }
      if (rejectOrders) return new Response(JSON.stringify({ message: 'Validation failed', errors: { address_to: 'region invalid' } }), { status: 422 });
      orderCount++;
      return ok({ id: `pf_${orderCount}` });
    }
    if (method === 'POST' && /^\/shops\/777\/orders\/pf_\d+\/send_to_production\.json$/.test(path)) return ok({ status: 'sending-to-production' });
    return new Response(JSON.stringify({ message: `no route ${method} ${path}` }), { status: 404 });
  };
  return { calls, fetchImpl, orders: () => calls.filter((c) => c.method === 'POST' && c.path.endsWith('/orders.json')) };
}

// One stand-in for both Printify and the email service, routed by host.
function services(opts) {
  const printify = fakePrintify(opts);
  const emails = [];
  const fetchImpl = async (url, init) => {
    if (String(url).startsWith('https://email.test')) {
      emails.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: `email_${emails.length}` }), { status: 200 });
    }
    return printify.fetchImpl(url, init);
  };
  return { printify, emails, fetchImpl };
}

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_unit_tests_only',
  STRIPE_WEBHOOK_SECRET: SECRET,
  SITE_URL: 'https://shirts.example',
  FULFILLMENT: 'printify',
  PRINTIFY_API_TOKEN: 'printify-test-token',
  PRINTIFY_API_BASE: 'https://printify.test/v1',
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_unit_tests_only',
  RESEND_API_BASE: 'https://email.test',
  EMAIL_FROM: 'This Is Our Year <orders@thisisouryear.team>',
  ORDER_EMAIL_TO: 'printer@example.com',
  ORDER_EMAIL_CC: 'owner@example.com',
  ADMIN_TOKEN: 'a-long-admin-token-for-tests',
};
const SHIP = { name: 'Jane Q Fan', address: { line1: '123 Main St', line2: 'Apt 4', city: 'Brooklyn', state: 'NY', postal_code: '11201', country: 'US' } };
const paidEvent = (id = 'cs_test_P1') => ({
  id: `evt_${id}`,
  type: 'checkout.session.completed',
  data: { object: { id, payment_status: 'paid', payment_intent: `pi_${id}`, amount_total: 22087, customer_details: { email: 'buyer@example.com' }, collected_information: { shipping_details: SHIP }, metadata: {} } },
});
async function signed(event) {
  const payload = JSON.stringify(event);
  const header = await new Stripe('sk_test_unit_tests_only').webhooks.generateTestHeaderStringAsync({ payload, secret: SECRET });
  return new Request('https://shirts.example/.netlify/functions/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': header }, body: payload });
}
const line = (over = {}) => ({ team_id: 'dallas', design_id: 'this-is-our-year', product_id: 'adult-tee', product_style: 'tee', audience: 'adult', size: 'L', purchase_mode: 'standard', ...over });

async function setup({ env = ENV, scan = true, lines = [line()], ...opts } = {}) {
  const stripe = fakeStripe();
  stripe.lineItems = lines.map((m) => ({ quantity: 12, amount_total: 21588, price: { product: { metadata: m } } }));
  const storage = memoryStorage();
  const svc = services(opts);
  const shop = realShop();
  const now = () => new Date('2026-10-16T01:00:00Z');
  if (scan) {
    const r = await scanCatalog({ env, config, teams: shop.teams, storage, fetchImpl: svc.fetchImpl, now });
    assert.ok(r.mapping, r.error);
  }
  const handler = makeWebhookHandler({ env, stripeFor: () => stripe, getStorage: async () => storage, shop, palettes: data.palettes, printifyConfig: config, fetchImpl: svc.fetchImpl, now });
  const admin = makeAdminHandler({ shop, palettes: data.palettes, history: data.history, env, getStorage: async () => storage, printifyConfig: config, fetchImpl: svc.fetchImpl, now });
  const call = async (body) => {
    const res = await admin(new Request('https://shirts.example/.netlify/functions/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.ADMIN_TOKEN}` }, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  return { storage, shop, handler, call, ...svc };
}

test('each city gets the closest blank color the printer has, in every size', () => {
  const shop = realShop();
  const m = mapProvider({ variants: variantsFor(ALL_COLORS, 1), teams: shop.teams, config });
  const pick = (slug) => m.cities[slug].color;
  assert.equal(pick('dallas'), 'Navy');
  assert.equal(pick('green-bay'), 'Forest');
  assert.equal(pick('kansas-city'), 'Red');
  assert.equal(pick('philadelphia'), 'Deep Teal');
  assert.equal(pick('washington'), 'Maroon');
  assert.equal(pick('pittsburgh'), 'Black');
  assert.equal(pick('cleveland'), 'Brown');
  assert.equal(pick('arizona'), 'Cardinal');
  assert.equal(pick('minnesota'), 'Team Purple');
  assert.equal(pick('jacksonville'), 'Teal', 'a solid beats a slightly closer heather');
  assert.equal(pick('los-angeles-royal'), 'True Royal', 'royal blue is not read as purple');
  assert.equal(pick('new-york-blue'), 'Navy', 'the preferred starting blank');
  assert.equal(m.cities['new-york-blue'].manual, false);
  for (const [slug, c] of Object.entries(m.cities)) {
    assert.deepEqual(Object.keys(c.variants), SIZES, slug);
    assert.ok(c.ok && c.distance <= config.closeEnough, `${slug} picked ${c.color} at ${c.distance}`);
  }
  assert.equal(m.score, 32);
  assert.deepEqual(m.placeholder, { width: 3852, height: 4398 });
});

test('a color picked by hand wins, and a city with no close color is flagged', () => {
  const shop = realShop();
  const hand = mapProvider({ variants: variantsFor(ALL_COLORS, 1), teams: shop.teams, config, overrides: { houston: 'Steel Blue' } });
  assert.equal(hand.cities.houston.color, 'Steel Blue');
  assert.equal(hand.cities.houston.manual, true);
  const thin = mapProvider({ variants: variantsFor(['Black', 'White'], 1), teams: shop.teams, config });
  assert.equal(thin.cities.pittsburgh.ok, true);
  assert.equal(thin.cities['kansas-city'].ok, false, 'red as black is not close enough');
  assert.ok(thin.score < 32);
});

test('the scan picks the printer that covers the most cities and saves the setup', async () => {
  const { storage, printify } = await setup();
  const mapping = await storage.store('fulfillment').get(KEY_CATALOG);
  assert.equal(mapping.providerId, 29);
  assert.equal(mapping.shopId, 777);
  assert.equal(mapping.blueprintTitle, 'Bella+Canvas 3001');
  assert.equal(mapping.citiesReady, 32);
  assert.equal(printify.calls[0].auth, 'Bearer printify-test-token');
});

test('the scan says what to do when the store is missing or ambiguous', async () => {
  const shop = realShop();
  const none = fakePrintify({ shops: [] });
  const r1 = await scanCatalog({ env: ENV, config, teams: shop.teams, storage: memoryStorage(), fetchImpl: none.fetchImpl });
  assert.match(r1.error, /no store yet/);
  const two = fakePrintify({ shops: [{ id: 1, title: 'A' }, { id: 2, title: 'B' }] });
  const r2 = await scanCatalog({ env: ENV, config, teams: shop.teams, storage: memoryStorage(), fetchImpl: two.fetchImpl });
  assert.match(r2.error, /PRINTIFY_SHOP_ID/);
  assert.match(r2.error, /1 \(A\), 2 \(B\)/);
});

test('the lettering sits centered near the top of the print area', () => {
  const p = placementFor(config, { placeholder: { width: 3852, height: 4398 } }, 'this-is-our-year');
  assert.equal(p.x, 0.5);
  assert.equal(p.scale, 0.86);
  // top margin 0.09 of the width, plus half the lettering's height
  const expected = (0.09 * 3852 + 0.5 * 0.86 * 3852 * 0.3683) / 4398;
  assert.ok(Math.abs(p.y - expected) < 0.0001);
});

test('a paid order goes to Printify once, on hold, with the right shirt, print file and address', async () => {
  const { handler, printify, emails, shop, storage } = await setup();
  assert.equal((await handler(await signed(paidEvent()))).status, 200);
  assert.equal((await handler(await signed(paidEvent()))).status, 200, 'Stripe repeats itself');
  assert.equal(printify.orders().length, 1, 'one Printify order, however many times Stripe calls');
  const body = printify.orders()[0].body;
  assert.equal(body.external_id, 'cs_test_P1');
  assert.equal(body.label, orderRef('cs_test_P1'));
  assert.equal(body.shipping_method, 1);
  assert.equal(body.send_shipping_notification, true);
  const li = body.line_items[0];
  const mapping = await storage.store('fulfillment').get(KEY_CATALOG);
  assert.equal(li.print_provider_id, 29);
  assert.equal(li.blueprint_id, 12);
  assert.equal(li.variant_id, mapping.cities.dallas.variants.L);
  assert.equal(li.quantity, 12);
  const art = li.print_areas.front[0];
  const team = shop.city('dallas');
  assert.equal(art.src, `https://shirts.example/print/${printFileName(team, shop.design('this-is-our-year'))}`);
  assert.equal(art.angle, 0);
  assert.deepEqual(body.address_to, { first_name: 'Jane', last_name: 'Q Fan', email: 'buyer@example.com', phone: '', country: 'US', region: 'NY', address1: '123 Main St', address2: 'Apt 4', city: 'Brooklyn', zip: '11201' });
  assert.equal(printify.calls.filter((c) => c.path.includes('send_to_production')).length, 0, 'waits for the owner\'s OK by default');
  const order = await storage.store('orders').get('order/cs_test_P1');
  assert.equal(order.printify.status, 'on_hold');
  assert.equal(order.printify.printifyOrderId, 'pf_1');
  // The owner gets a heads-up. The vendor email list is ignored in this mode.
  assert.equal(emails.length, 1);
  assert.deepEqual(emails[0].to, ['owner@example.com']);
  assert.equal(emails[0].cc, undefined);
  assert.match(emails[0].subject, /\(Printify, waiting for your OK\)$/);
  assert.match(emails[0].text, /PRINTIFY: Sent to Printify and waiting for your OK\. Printify order pf_1\./);
});

test('with PRINTIFY_AUTO_SEND on, the order goes straight to print', async () => {
  const { handler, printify, storage } = await setup({ env: { ...ENV, PRINTIFY_AUTO_SEND: 'true' } });
  await handler(await signed(paidEvent()));
  assert.deepEqual(printify.calls.filter((c) => c.path.includes('send_to_production')).map((c) => c.path), ['/shops/777/orders/pf_1/send_to_production.json']);
  assert.equal((await storage.store('orders').get('order/cs_test_P1')).printify.status, 'in_production');
});

test('if Printify has an error, Stripe is told, and the retry sends it once', async () => {
  const { handler, printify, storage } = await setup({ failOrders: 1 });
  assert.equal((await handler(await signed(paidEvent()))).status, 500);
  assert.equal((await storage.store('orders').get('order/cs_test_P1')).printify.status, 'failed');
  assert.equal((await handler(await signed(paidEvent()))).status, 200);
  assert.equal(printify.orders().length, 2, 'one failed try, one success');
  assert.equal((await storage.store('orders').get('order/cs_test_P1')).printify.status, 'on_hold');
});

test('if Printify refuses the order, the owner is told and can send it again from the admin screen', async () => {
  const { handler, emails, call, storage, printify } = await setup({ rejectOrders: true });
  assert.equal((await handler(await signed(paidEvent()))).status, 200, 'retrying would not help, so Stripe is not asked to');
  const order = await storage.store('orders').get('order/cs_test_P1');
  assert.equal(order.printify.status, 'rejected');
  assert.match(emails[0].subject, /NOT sent to Printify/);
  assert.match(emails[0].text, /region invalid/);
  const unconfirmed = await call({ action: 'orders.printify', id: 'cs_test_P1' });
  assert.equal(unconfirmed.status, 400, 'needs a typed SEND');
  const still = await call({ action: 'orders.printify', id: 'cs_test_P1', confirm: 'SEND' });
  assert.equal(still.status, 400);
  assert.match(still.body.error, /region invalid/);
  assert.equal(printify.orders().length, 2);
});

test('sending by hand works after a fix, and never makes a second Printify order', async () => {
  const { handler, call, printify, storage } = await setup({ scan: false });
  await handler(await signed(paidEvent()));
  assert.equal((await storage.store('orders').get('order/cs_test_P1')).printify.status, 'needs_setup');
  assert.equal((await call({ action: 'printify.scan' })).status, 200);
  const sent = await call({ action: 'orders.printify', id: 'cs_test_P1', confirm: 'SEND' });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.status, 'on_hold');
  const twice = await call({ action: 'orders.printify', id: 'cs_test_P1', confirm: 'SEND' });
  assert.equal(twice.status, 409);
  assert.match(twice.body.error, /won't be sent twice/);
  assert.equal(printify.orders().length, 1);
  const list = await call({ action: 'orders.list' });
  assert.equal(list.body.fulfillment, 'printify');
  assert.equal(list.body.orders[0].printify.status, 'on_hold');
});

test('before the catalog is scanned, nothing is sent and the owner is told to scan', async () => {
  const { handler, emails, printify, storage } = await setup({ scan: false });
  assert.equal((await handler(await signed(paidEvent()))).status, 200);
  assert.equal(printify.orders().length, 0);
  assert.equal((await storage.store('orders').get('order/cs_test_P1')).printify.status, 'needs_setup');
  assert.match(emails[0].text, /NOT sent to Printify: Scan the Printify catalog/);
});

test('with Printify off, orders still go to the vendor by email and never to Printify', async () => {
  const { handler, emails, printify } = await setup({ env: { ...ENV, FULFILLMENT: '' } });
  await handler(await signed(paidEvent()));
  assert.equal(printify.orders().length, 0);
  assert.deepEqual(emails[0].to, ['printer@example.com']);
  assert.deepEqual(emails[0].cc, ['owner@example.com']);
});

test('the owner approves an on-hold order with a typed PRINT, and picks colors by hand', async () => {
  const { handler, call, printify } = await setup();
  await handler(await signed(paidEvent()));
  assert.equal((await call({ action: 'orders.produce', id: 'cs_test_P1' })).status, 400);
  const ok = await call({ action: 'orders.produce', id: 'cs_test_P1', confirm: 'PRINT' });
  assert.equal(ok.body.status, 'in_production');
  assert.equal(printify.calls.filter((c) => c.path.includes('send_to_production')).length, 1);
  const colors = await call({ action: 'printify.colors', overrides: { houston: 'Steel Blue' } });
  assert.equal(colors.body.mapping.cities.houston.color, 'Steel Blue');
  assert.equal(colors.body.mapping.providerId, 29, 'same printer');
  const status = await call({ action: 'printify.status' });
  assert.equal(status.body.overrides.houston, 'Steel Blue');
  assert.equal(status.body.on, true);
  assert.ok(!JSON.stringify(status.body).includes('printify-test-token'), 'the token never comes back');
});

test('a test order is created on hold, labeled, and never sent to print', async () => {
  const { call, printify } = await setup();
  const r = await call({ action: 'printify.test_order', slug: 'green-bay' });
  assert.equal(r.status, 200);
  assert.equal(r.body.printifyOrderId, 'pf_1');
  const body = printify.orders()[0].body;
  assert.match(body.label, /^TEST/);
  assert.equal(body.send_shipping_notification, false);
  assert.match(body.line_items[0].print_areas.front[0].src, /\/print\/green-bay-this-is-our-year-[0-9a-f]{8}\.png$/);
  assert.equal(printify.calls.filter((c) => c.path.includes('send_to_production')).length, 0);
});

test('the setup report says what Printify still needs', async () => {
  const { call } = await setup({ scan: false, env: { ...ENV, PRINTIFY_API_TOKEN: '' } });
  const s = await call({ action: 'status' });
  const names = s.body.missing.map((m) => m.name);
  assert.ok(names.includes('PRINTIFY_API_TOKEN'));
  assert.ok(names.includes('PRINTIFY_AUTO_SEND'));
  assert.equal(s.body.fulfillment, 'printify');
});

test('an order item Printify is not set up for is refused before anything is sent', () => {
  const shop = realShop();
  const mapping = { providerId: 29, placeholder: { width: 3852, height: 4398 }, cities: { dallas: { color: 'Navy', variants: { L: 5 } } } };
  const r = buildPrintifyOrder({ order: { id: 'x', shipTo: { name: 'A B', line1: '1 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' }, lines: [line({ product_id: 'kids-tee' })] }, mapping, config, shop, siteUrl: 'https://s.example' });
  assert.match(r.problems[0], /isn't set up for kids-tee/);
  const noSize = buildPrintifyOrder({ order: { id: 'x', shipTo: { name: 'A', line1: '1 St', city: 'NYC', country: 'US' }, lines: [line({ size: '3XL' })] }, mapping, config, shop, siteUrl: 'https://s.example' });
  assert.match(noSize.problems[0], /no 3XL in Navy/);
});

test('color distance behaves', () => {
  assert.equal(colorDistance('#000000', '#000000'), 0);
  assert.ok(colorDistance('#000000', '#FFFFFF') > 90);
  assert.ok(colorDistance('#0C2340', '#1B2236') < colorDistance('#0C2340', '#1D4C9C'));
});
