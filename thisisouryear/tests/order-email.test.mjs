// The order email to the print vendor: what it says, who gets it, and that it
// goes out exactly once per paid order.
import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { realShop, fixtureShop, fakeStripe, memoryStorage, data } from './fixtures.mjs';
import { makeWebhookHandler } from '../src/server/orders.js';
import { orderEmailContent, orderEmailSettings, sendOrderEmail, printColors, shipToFrom, orderRef, sampleOrder } from '../src/server/order-email.js';
import { makeAdminHandler } from '../src/server/admin.js';

const SECRET = 'whsec_unit_tests_only';
const EMAIL = {
  STRIPE_SECRET_KEY: 'sk_test_unit_tests_only',
  STRIPE_WEBHOOK_SECRET: SECRET,
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_unit_tests_only',
  EMAIL_FROM: 'This Is Our Year <orders@thisisouryear.team>',
  ORDER_EMAIL_TO: 'printer@example.com',
  ORDER_EMAIL_CC: 'owner@example.com',
  RESEND_API_BASE: 'https://email.test',
};

// A stand-in for the email service that records what it was asked to send.
function fakeEmailService({ failTimes = 0 } = {}) {
  const sent = [];
  let failures = 0;
  const fetchImpl = async (url, init) => {
    if (failures < failTimes) {
      failures++;
      return new Response(JSON.stringify({ message: 'temporarily unavailable' }), { status: 503 });
    }
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: `email_${sent.length}` }), { status: 200 });
  };
  return { sent, fetchImpl };
}

const SHIP = { name: 'Jane Fan', address: { line1: '123 Main St', line2: 'Apt 4', city: 'Brooklyn', state: 'NY', postal_code: '11201', country: 'US' } };
const paidEvent = (over = {}) => ({
  id: 'evt_1',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_ORDER1',
      payment_status: 'paid',
      payment_intent: 'pi_1',
      amount_total: 26385,
      customer_details: { email: 'buyer@example.com', name: 'Jane Fan' },
      collected_information: { shipping_details: SHIP },
      metadata: { bulk_percent_off: '10' },
      ...over,
    },
  },
});
async function signed(event) {
  const payload = JSON.stringify(event);
  const header = await new Stripe('sk_test_unit_tests_only').webhooks.generateTestHeaderStringAsync({ payload, secret: SECRET });
  return new Request('https://example.test/.netlify/functions/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': header }, body: payload });
}
const lineMeta = (over = {}) => ({
  team_id: 'dallas',
  design_id: 'this-is-our-year',
  product_id: 'adult-tee',
  product_style: 'tee',
  audience: 'adult',
  size: 'L',
  purchase_mode: 'standard',
  artwork_version: 'store-v1',
  variant_key: 'adult-tee:this-is-our-year:dallas:L',
  provider_variant_id: 'unmapped',
  print_approval: 'label_only',
  ...over,
});
function setup({ env = EMAIL, failTimes = 0, lines } = {}) {
  const stripe = fakeStripe();
  stripe.lineItems = (lines ?? [lineMeta()]).map((m, i) => ({ quantity: i === 0 ? 12 : 1, amount_total: 1799 * 12, price: { product: { metadata: m } } }));
  const storage = memoryStorage();
  const mail = fakeEmailService({ failTimes });
  const shop = realShop();
  const handler = makeWebhookHandler({ env, stripeFor: () => stripe, getStorage: async () => storage, shop, palettes: data.palettes, fetchImpl: mail.fetchImpl, now: () => new Date('2026-10-11T01:30:00Z') });
  return { stripe, storage, mail, shop, handler };
}

test('a paid order emails the vendor once, with a copy to the owner, even when Stripe repeats the message', async () => {
  const { storage, mail, handler } = setup();
  assert.equal((await handler(await signed(paidEvent()))).status, 200);
  assert.equal((await handler(await signed(paidEvent()))).status, 200);
  assert.equal((await handler(await signed({ ...paidEvent(), type: 'checkout.session.async_payment_succeeded', id: 'evt_2' }))).status, 200);
  assert.equal(mail.sent.length, 1, 'one email, however many times Stripe calls');
  const { body, headers } = mail.sent[0];
  assert.deepEqual(body.to, ['printer@example.com']);
  assert.deepEqual(body.cc, ['owner@example.com']);
  assert.deepEqual(body.reply_to, ['owner@example.com'], 'the vendor\'s replies come to the owner');
  assert.equal(body.headers, undefined, 'an order email has no unsubscribe header');
  assert.ok(headers['Idempotency-Key']);
  const order = await storage.store('orders').get('order/cs_test_ORDER1');
  assert.equal(order.vendorEmail.status, 'sent');
  assert.equal(order.shipTo.postalCode, '11201');
  assert.equal(order.bulkPercentOff, 10);
});

test('the email has the ship-to address, the item, and the exact colors, and nothing the vendor does not need', async () => {
  const { mail, handler } = setup();
  await handler(await signed(paidEvent()));
  const { subject, text } = mail.sent[0].body;
  assert.equal(subject, `New order ${orderRef('cs_test_ORDER1')}: 12 items to print, ship to NY`);
  for (const s of ['Jane Fan', '123 Main St', 'Apt 4', 'Brooklyn, NY 11201', 'United States']) assert.ok(text.includes(s), s);
  assert.match(text, /1\. Tee, size L\. Quantity 12\./);
  assert.match(text, /Design: This Is Our Year \(artwork store-v1\)\. Lettering: THIS IS \/ OUR YEAR/);
  assert.match(text, /Colors: Dallas, Navy \/ Silver/);
  assert.match(text, /Garment:\s+Navy\s+#0C2340/);
  assert.match(text, /Outline:\s+Silver\s+#87909A/);
  assert.match(text, /Ship standard\. The customer was told 5 to 10 business days\./);
  assert.ok(!text.includes('buyer@example.com'), 'no customer email address');
  assert.ok(!/\$\d/.test(text), 'no prices');
  assert.ok(!text.includes('—'));
});

test('gift, gift note, league name and matching set notes reach the vendor', async () => {
  const { mail, handler } = setup({
    lines: [
      lineMeta({ purchase_mode: 'rival_gift', recipient_team_id: 'green-bay', team_id: 'chicago', gift_note: 'Enjoy the colors.' }),
      lineMeta({ purchase_mode: 'fantasy_punishment', league_name: 'The Sunday Scaries', league_order_id: 'LG-AAAAAAAA' }),
      lineMeta({ purchase_mode: 'matching_set', bundle_id: 'B-AAAAAAAA' }),
      lineMeta({ purchase_mode: 'matching_set', bundle_id: 'B-AAAAAAAA', product_id: 'kids-tee', audience: 'kids', size: 'YS' }),
    ],
  });
  await handler(await signed(paidEvent()));
  const { text } = mail.sent[0].body;
  assert.match(text, /Item 1 is a gift\. Leave prices and receipts out of the box\./);
  assert.match(text, /Gift note to include with item 1: "Enjoy the colors\."/);
  assert.match(text, /League order: The Sunday Scaries\./);
  assert.match(text, /Items 3 and 4 are a matching set\./);
});

test('if the email service fails, Stripe is told, and the retry sends it', async () => {
  const { storage, mail, handler } = setup({ failTimes: 1 });
  assert.equal((await handler(await signed(paidEvent()))).status, 500, 'Stripe will try again');
  let order = await storage.store('orders').get('order/cs_test_ORDER1');
  assert.equal(order.status, 'paid', 'the order itself is still recorded');
  assert.equal(order.vendorEmail.status, 'failed');
  assert.equal((await handler(await signed(paidEvent()))).status, 200);
  order = await storage.store('orders').get('order/cs_test_ORDER1');
  assert.equal(order.vendorEmail.status, 'sent');
  assert.equal(mail.sent.length, 1);
});

test('without email settings the order is still recorded, nothing is sent, and Stripe is not asked to retry', async () => {
  const { storage, mail, handler } = setup({ env: { STRIPE_SECRET_KEY: 'sk_test_unit_tests_only', STRIPE_WEBHOOK_SECRET: SECRET } });
  assert.equal((await handler(await signed(paidEvent()))).status, 200);
  assert.equal(mail.sent.length, 0);
  const order = await storage.store('orders').get('order/cs_test_ORDER1');
  assert.equal(order.vendorEmail.status, 'not_configured');
});

test('an unpaid session sends nothing', async () => {
  const { mail, handler } = setup();
  await handler(await signed(paidEvent({ payment_status: 'unpaid' })));
  assert.equal(mail.sent.length, 0);
});

test('with only the owner\'s address set, the email comes to the owner to forward', () => {
  const s = orderEmailSettings({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'x', EMAIL_FROM: 'a@b.co', ORDER_EMAIL_CC: 'owner@example.com' });
  assert.equal(s.ready, true);
  assert.deepEqual(s.to, ['owner@example.com']);
  assert.deepEqual(s.cc, []);
  assert.equal(s.vendorSet, false);
  const none = orderEmailSettings({});
  assert.equal(none.ready, false);
  assert.deepEqual(none.missing, ['EMAIL_PROVIDER (set it to resend)', 'RESEND_API_KEY', 'EMAIL_FROM', 'ORDER_EMAIL_TO']);
  assert.deepEqual(orderEmailSettings({ ORDER_EMAIL_TO: 'a@x.co, not-an-email , b@y.co' }).to, ['a@x.co', 'b@y.co']);
});

test('colors come from the palette, with Pantone where the reference has one', () => {
  const shop = realShop();
  const colors = printColors(shop, data.palettes, 'dallas');
  assert.deepEqual(colors.map((c) => c.label), ['Garment', 'Line 1', 'Line 2', 'Outline']);
  assert.equal(colors[0].hex, '#0C2340');
  const custom = printColors(shop, data.palettes, 'houston')[0];
  assert.equal(custom.hex, '#03202F', 'a custom store color still goes to the vendor');
  assert.equal(custom.pantone, null);
});

test('the shipping address is read from where Stripe puts it now, and from the older place', () => {
  assert.equal(shipToFrom({ collected_information: { shipping_details: SHIP } }).city, 'Brooklyn');
  assert.equal(shipToFrom({ shipping_details: SHIP }).city, 'Brooklyn');
  assert.equal(shipToFrom({}), null);
});

test('the owner can resend on purpose, preview an order, and send a test email from the admin screen', async () => {
  const { storage, mail, handler } = setup();
  await handler(await signed(paidEvent()));
  const admin = makeAdminHandler({ shop: realShop(), palettes: data.palettes, history: data.history, env: { ...EMAIL, ADMIN_TOKEN: 'a-long-admin-token-for-tests' }, getStorage: async () => storage, fetchImpl: mail.fetchImpl, now: () => new Date('2026-10-11T02:00:00Z') });
  const call = async (body) => {
    const res = await admin(new Request('https://example.test/.netlify/functions/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer a-long-admin-token-for-tests' }, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  const list = await call({ action: 'orders.list' });
  assert.equal(list.body.orders[0].vendorEmail.status, 'sent');
  assert.equal(list.body.orders[0].units, 12);
  assert.equal((await call({ action: 'orders.email', id: 'cs_test_ORDER1' })).status, 400, 'resending needs a typed SEND');
  assert.equal((await call({ action: 'orders.email', id: 'cs_test_ORDER1', confirm: 'SEND' })).status, 200);
  assert.equal(mail.sent.length, 2);
  assert.notEqual(mail.sent[0].headers['Idempotency-Key'], mail.sent[1].headers['Idempotency-Key'], 'a deliberate resend is a new email');
  const preview = await call({ action: 'orders.preview', id: 'cs_test_ORDER1' });
  assert.match(preview.body.text, /SHIP TO/);
  const dry = await call({ action: 'orders.test_email' });
  assert.match(dry.body.preview.subject, /^\[TEST\]/);
  assert.equal(mail.sent.length, 2, 'a preview sends nothing');
  const sent = await call({ action: 'orders.test_email', send: true });
  assert.equal(sent.body.sent, true);
  assert.match(mail.sent[2].body.text, /THIS IS A TEST/);
});

test('the sample order uses a real item, so the test email looks like the real thing', () => {
  const shop = realShop();
  const content = orderEmailContent({ order: sampleOrder(shop, new Date('2026-10-11T02:00:00Z')), shop, palettes: data.palettes, test: true });
  assert.match(content.text, /Colors: Dallas, Navy \/ Silver/);
  assert.match(content.text, /THIS IS A TEST/);
});

test('a kids item says so', () => {
  const shop = fixtureShop();
  const order = { id: 'cs_x', createdAt: '2026-10-11T02:00:00Z', shipTo: null, lines: [lineMeta({ product_id: 'kids-tee', audience: 'kids', size: 'YM' })] };
  const { text } = orderEmailContent({ order, shop, palettes: data.palettes });
  assert.match(text, /Kids tee, size YM/);
  assert.match(text, /Not on this order\. Check the order in Stripe before shipping\./);
});

test('sending is safe to call again directly', async () => {
  const { storage, mail, handler } = setup();
  await handler(await signed(paidEvent()));
  const again = await sendOrderEmail({ orderId: 'cs_test_ORDER1', storage, shop: realShop(), palettes: data.palettes, env: EMAIL, fetchImpl: mail.fetchImpl });
  assert.equal(again.status, 'already_sent');
  assert.equal(mail.sent.length, 1);
});
