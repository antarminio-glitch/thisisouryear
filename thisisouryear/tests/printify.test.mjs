// Sending paid orders to Printify: finding each garment, matching blank
// colors, building the order, sending it once, and the owner's controls.
// Printify itself is played by a stand-in that records every request.
import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import fs from 'node:fs';
import { realShop, fakeStripe, memoryStorage, data } from './fixtures.mjs';
import { makeWebhookHandler } from '../src/server/orders.js';
import { makeAdminHandler } from '../src/server/admin.js';
import { waitingOrders } from '../src/server/print-runs.js';
import { scanCatalog, placementFor, buildPrintifyOrder, colorDistance, pickBlueprint, printifyProducts, submitToPrintify, KEY_CATALOG } from '../src/server/printify.js';
import { printFileName } from '../src/lib/print-file.js';
import { orderRef } from '../src/server/order-email.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../src/data/${f}`, import.meta.url), 'utf8'));
const config = read('printify.json');
const photos = read('garment-photos.json');
const SECRET = 'whsec_unit_tests_only';
const ADULT = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const KIDS = ['XS', 'S', 'M', 'L', 'XL'];
const sanmar = (pid) => Object.values(photos.garments[pid].colors).map((c) => c.name);
const GILDAN_KIDS = ['Black', 'White', 'Navy', 'Red', 'Cardinal Red', 'Antique Cherry Red', 'Maroon', 'Royal', 'Sapphire', 'Forest Green', 'Irish Green', 'Purple', 'Dark Chocolate', 'Jade Dome', 'Galapagos Blue', 'Carolina Blue', 'Gold', 'Orange', 'Sport Grey'];

// Variants as Printify's catalog lists them: one per color and size.
function variantsFor(colors, sizes, idBase) {
  let id = idBase;
  return colors.flatMap((color) => sizes.map((size) => ({ id: id++, title: `${color} / ${size}`, options: { color, size }, placeholders: [{ position: 'front', width: 3852, height: 4398 }] })));
}

const BLUEPRINTS = [
  { id: 12, brand: 'Bella+Canvas', model: '3001', title: 'Unisex Jersey Short Sleeve Tee' },
  { id: 1001, brand: 'Port & Company', model: 'PC54', title: 'Core Cotton Tee' },
  { id: 1002, brand: 'Port & Company', model: 'PC78H', title: 'Core Fleece Pullover Hooded Sweatshirt' },
  { id: 1003, brand: 'Gildan', model: '5000B', title: 'Kids Heavy Cotton Tee' },
];

function fakePrintify({ shops = [{ id: 777, title: 'This Is Our Year' }], failOrders = 0, rejectOrders = false, blueprints = BLUEPRINTS } = {}) {
  const calls = [];
  let orderCount = 0;
  let failures = 0;
  const providers = { 1001: [{ id: 29, title: 'Big Printer' }, { id: 99, title: 'Small Printer' }], 1002: [{ id: 29, title: 'Big Printer' }], 1003: [{ id: 50, title: 'Kid Printer' }], 12: [{ id: 3, title: 'Other' }] };
  const catalogs = {
    '1001/29': variantsFor(sanmar('adult-tee'), ADULT, 10000),
    '1001/99': variantsFor(['Jet Black', 'White'], ADULT, 20000),
    // This printer calls the big sizes XXL and XXXL.
    '1002/29': variantsFor(sanmar('adult-hoodie'), ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'], 30000),
    '1003/50': variantsFor(GILDAN_KIDS, KIDS, 40000),
  };
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname.replace(/^\/v1/, '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path, body, auth: init.headers?.Authorization });
    const ok = (obj) => new Response(JSON.stringify(obj), { status: 200 });
    if (method === 'GET' && path === '/shops.json') return ok(shops);
    if (method === 'GET' && path === '/catalog/blueprints.json') return ok(blueprints);
    const pp = path.match(/^\/catalog\/blueprints\/(\d+)\/print_providers\.json$/);
    if (method === 'GET' && pp) return ok(providers[pp[1]] ?? []);
    const v = path.match(/^\/catalog\/blueprints\/(\d+)\/print_providers\/(\d+)\/variants\.json$/);
    if (method === 'GET' && v) return ok({ variants: catalogs[`${v[1]}/${v[2]}`] ?? [] });
    if (method === 'POST' && path === '/shops/777/orders.json') {
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

async function scanAll({ env = ENV, shop, storage, fetchImpl, now }) {
  for (const productId of printifyProducts(config, shop)) {
    const r = await scanCatalog({ env, config, shop, photos, storage, productId, fetchImpl, now });
    assert.ok(r.mapping, r.error);
  }
  return storage.store('fulfillment').get(KEY_CATALOG);
}

async function setup({ env = ENV, scan = true, lines = [line()], ...opts } = {}) {
  const stripe = fakeStripe();
  stripe.lineItems = lines.map(({ qty = 12, ...m }) => ({ quantity: qty, amount_total: 21588, price: { product: { metadata: m } } }));
  const storage = memoryStorage();
  const svc = services(opts);
  const shop = realShop();
  const now = () => new Date('2026-10-16T01:00:00Z');
  if (scan) await scanAll({ env, shop, storage, fetchImpl: svc.fetchImpl, now });
  const handler = makeWebhookHandler({ env, stripeFor: () => stripe, getStorage: async () => storage, shop, palettes: data.palettes, printifyConfig: config, fetchImpl: svc.fetchImpl, now });
  const admin = makeAdminHandler({ shop, palettes: data.palettes, history: data.history, photos, env, getStorage: async () => storage, printifyConfig: config, fetchImpl: svc.fetchImpl, now });
  const call = async (body) => {
    const res = await admin(new Request('https://shirts.example/.netlify/functions/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.ADMIN_TOKEN}` }, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  return { storage, shop, handler, call, ...svc };
}

test('Printify is set up for every garment on sale', () => {
  const shop = realShop();
  const onSale = shop.catalog.products.filter((p) => p.sellable).map((p) => p.id);
  assert.deepEqual(printifyProducts(config, shop).sort(), onSale.sort());
  for (const id of onSale) assert.ok(config.products[id].placement.widthOfPrintArea > 0.5, id);
});

test('each garment is found by model, best first, or pinned by number', () => {
  assert.equal(pickBlueprint(BLUEPRINTS, ['PC54', '3001']).id, 1001);
  assert.equal(pickBlueprint(BLUEPRINTS, ['PC54Y', '5000B', '3001Y']).id, 1003, 'falls back when the first choice is not carried');
  assert.equal(pickBlueprint(BLUEPRINTS, [12, 'PC54']).id, 12);
  assert.equal(pickBlueprint(BLUEPRINTS, ['nope']), null);
  assert.equal(pickBlueprint([{ id: 5, brand: 'X', model: '', title: 'Heavy Tee (PC54)' }], ['pc54']).id, 5, 'by the title when the model field is empty');
});

test('when Printify carries the same blank as the site, every city gets it by name, in every size', async () => {
  const { storage, printify } = await setup();
  const m = await storage.store('fulfillment').get(KEY_CATALOG);
  const tee = m.products['adult-tee'];
  assert.equal(tee.blueprintId, 1001);
  assert.equal(tee.blueprintTitle, 'Port & Company PC54');
  assert.equal(tee.providerId, 29, 'the printer with the most cities');
  assert.equal(tee.citiesReady, 32);
  const g = photos.garments['adult-tee'];
  for (const [slug, c] of Object.entries(tee.cities)) {
    assert.equal(c.color, g.colors[g.cities[slug].color].name, slug);
    assert.equal(c.how, 'same');
    assert.deepEqual(Object.keys(c.variants), ADULT, slug);
  }
  // XXL and XXXL count as 2XL and 3XL.
  const hood = m.products['adult-hoodie'];
  assert.equal(hood.citiesReady, 32);
  assert.ok(hood.cities.dallas.variants['2XL'] && hood.cities.dallas.variants['3XL']);
  assert.equal(printify.calls[0].auth, 'Bearer printify-test-token');
  assert.equal(printify.calls.filter((c) => c.path === '/catalog/blueprints.json').length, 3, 'once per garment');
});

test('when Printify only has a substitute, each city gets the closest solid color to the site\'s blank', async () => {
  const { storage } = await setup();
  const kids = (await storage.store('fulfillment').get(KEY_CATALOG)).products['kids-tee'];
  assert.equal(kids.blueprintTitle, 'Gildan 5000B');
  const pick = (slug) => kids.cities[slug];
  assert.equal(pick('atlanta').color, 'Black');
  assert.equal(pick('dallas').color, 'Navy');
  assert.equal(pick('arizona').color, 'Red');
  assert.equal(pick('green-bay').color, 'Forest Green');
  assert.equal(pick('minnesota').color, 'Purple');
  for (const [slug, c] of Object.entries(kids.cities)) {
    assert.equal(c.how, 'closest', slug);
    assert.deepEqual(Object.keys(c.variants), KIDS, slug);
    if (c.ok) assert.ok(c.distance <= config.closeEnough, `${slug} picked ${c.color} at ${c.distance}`);
  }
  assert.ok(kids.citiesReady >= 28, `only ${kids.citiesReady} kids cities matched`);
});

test('a color picked by hand wins for that garment only, and rescanning keeps the printer', async () => {
  const { call } = await setup();
  const r = await call({ action: 'printify.colors', product: 'kids-tee', overrides: { houston: 'Galapagos Blue' } });
  assert.equal(r.status, 200);
  const kids = r.body.mapping.products['kids-tee'];
  assert.equal(kids.cities.houston.color, 'Galapagos Blue');
  assert.equal(kids.cities.houston.how, 'manual');
  assert.equal(kids.providerId, 50);
  assert.equal(r.body.mapping.products['adult-tee'].cities.houston.how, 'same', 'the tee is untouched');
  assert.equal((await call({ action: 'printify.colors', overrides: {} })).status, 400, 'needs a garment');
  const status = await call({ action: 'printify.status' });
  assert.equal(status.body.overrides['kids-tee'].houston, 'Galapagos Blue');
  assert.equal(status.body.garments.length, 3);
  assert.ok(!JSON.stringify(status.body).includes('printify-test-token'), 'the token never comes back');
});

test('the scan says what to do when the store is missing or ambiguous, or the garment isn\'t carried', async () => {
  const shop = realShop();
  const go = (fake, productId = 'adult-tee') => scanCatalog({ env: ENV, config, shop, photos, storage: memoryStorage(), productId, fetchImpl: fake.fetchImpl });
  assert.match((await go(fakePrintify({ shops: [] }))).error, /no store yet/);
  const two = await go(fakePrintify({ shops: [{ id: 1, title: 'A' }, { id: 2, title: 'B' }] }));
  assert.match(two.error, /PRINTIFY_SHOP_ID/);
  assert.match(two.error, /1 \(A\), 2 \(B\)/);
  assert.match((await go(fakePrintify({ blueprints: [] }))).error, /doesn't list any of these/);
  assert.match((await go(fakePrintify(), 'kids-hoodie')).error, /isn't set up for kids-hoodie/);
});

test('the lettering sits centered near the top of each garment\'s print area', () => {
  const pm = { placeholder: { width: 3852, height: 4398 } };
  const p = placementFor(config, 'adult-tee', pm, 'this-is-our-year');
  const place = config.products['adult-tee'].placement;
  assert.equal(p.x, 0.5);
  assert.equal(p.scale, place.widthOfPrintArea);
  const expected = (place.topMarginOfPrintAreaWidth * 3852 + 0.5 * place.widthOfPrintArea * 3852 * config.designs['this-is-our-year'].aspect) / 4398;
  assert.ok(Math.abs(p.y - expected) < 0.0001);
  assert.equal(placementFor(config, 'adult-hoodie', pm, 'this-is-our-year').scale, config.products['adult-hoodie'].placement.widthOfPrintArea);
});

test('a paid order goes to Printify once, on hold, each garment from its own printer, with the address', async () => {
  const lines = [line(), line({ product_id: 'adult-hoodie', product_style: 'hoodie', team_id: 'green-bay', size: '2XL', qty: 2 }), line({ product_id: 'kids-tee', audience: 'kids', size: 'XS', qty: 1 })];
  const { handler, printify, emails, shop, storage } = await setup({ lines });
  assert.equal((await handler(await signed(paidEvent()))).status, 200);
  assert.equal((await handler(await signed(paidEvent()))).status, 200, 'Stripe repeats itself');
  assert.equal(printify.orders().length, 1, 'one Printify order, however many times Stripe calls');
  const body = printify.orders()[0].body;
  assert.equal(body.external_id, 'cs_test_P1');
  assert.equal(body.label, orderRef('cs_test_P1'));
  assert.equal(body.shipping_method, 1);
  assert.equal(body.send_shipping_notification, true);
  const m = (await storage.store('fulfillment').get(KEY_CATALOG)).products;
  const [tee, hood, kid] = body.line_items;
  assert.deepEqual([tee.blueprint_id, tee.print_provider_id, tee.variant_id, tee.quantity], [1001, 29, m['adult-tee'].cities.dallas.variants.L, 12]);
  assert.deepEqual([hood.blueprint_id, hood.print_provider_id, hood.variant_id, hood.quantity], [1002, 29, m['adult-hoodie'].cities['green-bay'].variants['2XL'], 2]);
  assert.deepEqual([kid.blueprint_id, kid.print_provider_id, kid.variant_id, kid.quantity], [1003, 50, m['kids-tee'].cities.dallas.variants.XS, 1]);
  const art = tee.print_areas.front[0];
  assert.equal(art.src, `https://shirts.example/print/${printFileName(shop.city('dallas'), shop.design('this-is-our-year'))}`);
  assert.equal(art.angle, 0);
  assert.match(hood.print_areas.front[0].src, /\/print\/green-bay-this-is-our-year-[0-9a-f]{8}\.png$/);
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

test('an order sent to Printify never shows up in a print run, and one in a run is never sent to Printify', async () => {
  const { handler, storage, shop } = await setup();
  await handler(await signed(paidEvent()));
  const orders = storage.store('orders');
  const sent = await orders.get('order/cs_test_P1');
  assert.equal(waitingOrders([sent]).length, 0);
  // An order the vendor already has.
  await orders.set('order/cs_test_RUN', { ...sent, id: 'cs_test_RUN', printify: null, printRun: 'run_1' });
  const r = await submitToPrintify({ orderId: 'cs_test_RUN', storage, shop, config, env: ENV, siteUrl: 'https://shirts.example', fetchImpl: async () => assert.fail('Printify must not be called') });
  assert.equal(r.status, 'in_print_run');
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

test('if Printify refuses the order, the owner is told why', async () => {
  const { handler, emails, call, storage, printify } = await setup({ rejectOrders: true });
  assert.equal((await handler(await signed(paidEvent()))).status, 200, 'retrying would not help, so Stripe is not asked to');
  assert.equal((await storage.store('orders').get('order/cs_test_P1')).printify.status, 'rejected');
  assert.match(emails[0].subject, /NOT sent to Printify/);
  assert.match(emails[0].text, /region invalid/);
  assert.equal((await call({ action: 'orders.printify', id: 'cs_test_P1' })).status, 400, 'needs a typed SEND');
  const still = await call({ action: 'orders.printify', id: 'cs_test_P1', confirm: 'SEND' });
  assert.equal(still.status, 400);
  assert.match(still.body.error, /region invalid/);
  assert.equal(printify.orders().length, 2);
});

test('sending by hand works after a scan, and never makes a second Printify order', async () => {
  const { handler, call, printify, storage } = await setup({ scan: false });
  await handler(await signed(paidEvent()));
  assert.equal((await storage.store('orders').get('order/cs_test_P1')).printify.status, 'needs_setup');
  for (const product of ['adult-tee', 'adult-hoodie', 'kids-tee']) assert.equal((await call({ action: 'printify.scan', product })).status, 200);
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

test('an order for a garment that hasn\'t been scanned waits, and the owner is told to scan', async () => {
  const { handler, emails, printify, storage, shop, fetchImpl } = await setup({ scan: false, lines: [line({ product_id: 'adult-hoodie', product_style: 'hoodie' })] });
  await scanCatalog({ env: ENV, config, shop, photos, storage, productId: 'adult-tee', fetchImpl });
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

test('the owner approves an on-hold order with a typed PRINT', async () => {
  const { handler, call, printify } = await setup();
  await handler(await signed(paidEvent()));
  assert.equal((await call({ action: 'orders.produce', id: 'cs_test_P1' })).status, 400);
  const ok = await call({ action: 'orders.produce', id: 'cs_test_P1', confirm: 'PRINT' });
  assert.equal(ok.body.status, 'in_production');
  assert.equal(printify.calls.filter((c) => c.path.includes('send_to_production')).length, 1);
});

test('a test order is created on hold, labeled, in the garment asked for, and never sent to print', async () => {
  const { call, printify } = await setup();
  const r = await call({ action: 'printify.test_order', slug: 'green-bay', product: 'adult-hoodie' });
  assert.equal(r.status, 200);
  assert.equal(r.body.printifyOrderId, 'pf_1');
  const body = printify.orders()[0].body;
  assert.match(body.label, /^TEST/);
  assert.equal(body.send_shipping_notification, false);
  assert.equal(body.line_items[0].blueprint_id, 1002);
  assert.match(body.line_items[0].print_areas.front[0].src, /\/print\/green-bay-this-is-our-year-[0-9a-f]{8}\.png$/);
  assert.equal(printify.calls.filter((c) => c.path.includes('send_to_production')).length, 0);
});

test('the setup report says what Printify still needs, garment by garment', async () => {
  const { call, storage, shop, fetchImpl } = await setup({ scan: false });
  await scanCatalog({ env: ENV, config, shop, photos, storage, productId: 'adult-tee', fetchImpl });
  const s = await call({ action: 'status' });
  const catalogNeed = s.body.missing.find((m) => m.name === 'Printify catalog');
  assert.ok(catalogNeed, 'asks for a scan');
  const tee = shop.catalog.products.find((p) => p.id === 'adult-tee').name;
  assert.ok(!catalogNeed.why.includes(tee), 'the tee is scanned');
  assert.ok(s.body.missing.some((m) => m.name === 'PRINTIFY_AUTO_SEND'));
  assert.equal(s.body.fulfillment, 'printify');
  assert.equal(s.body.printify.garments.find((g) => g.id === 'adult-tee').citiesReady, 32);
  const noToken = await setup({ scan: false, env: { ...ENV, PRINTIFY_API_TOKEN: '' } });
  assert.ok((await noToken.call({ action: 'status' })).body.missing.some((m) => m.name === 'PRINTIFY_API_TOKEN'));
});

test('an order item Printify is not set up for is refused before anything is sent', () => {
  const shop = realShop();
  const pm = { providerId: 29, blueprintId: 1001, placeholder: { width: 3852, height: 4398 }, cities: { dallas: { color: 'True Navy', variants: { L: 5 } } } };
  const mapping = { products: { 'adult-tee': pm } };
  const ship = { name: 'A B', line1: '1 St', city: 'NYC', state: 'NY', postalCode: '10001', country: 'US' };
  const r = buildPrintifyOrder({ order: { id: 'x', shipTo: ship, lines: [line({ product_id: 'kids-hoodie' })] }, mapping, config, shop, siteUrl: 'https://s.example' });
  assert.match(r.problems[0], /isn't set up for kids-hoodie/);
  const unscanned = buildPrintifyOrder({ order: { id: 'x', shipTo: ship, lines: [line({ product_id: 'kids-tee' })] }, mapping, config, shop, siteUrl: 'https://s.example' });
  assert.match(unscanned.problems[0], /scan Printify for kids-tee/);
  const noSize = buildPrintifyOrder({ order: { id: 'x', shipTo: ship, lines: [line({ size: '3XL' })] }, mapping, config, shop, siteUrl: 'https://s.example' });
  assert.match(noSize.problems[0], /no 3XL in True Navy/);
});

test('color distance behaves', () => {
  assert.equal(colorDistance('#000000', '#000000'), 0);
  assert.ok(colorDistance('#000000', '#FFFFFF') > 90);
  assert.ok(colorDistance('#0C2340', '#1B2236') < colorDistance('#0C2340', '#1D4C9C'));
});
