// Bulk pricing: 12+ items 10% off, 24+ 15% off, 48+ 20% off, counted across
// the whole order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { realShop, fixtureShop, fakeStripe, post, data } from './fixtures.mjs';
import { createShop } from '../src/lib/shop-core.js';
import { makeCheckoutHandler } from '../src/server/checkout.js';

const tee = (over = {}) => ({ productId: 'adult-tee', designId: 'this-is-our-year', slug: 'dallas', size: 'L', quantity: 1, mode: 'standard', ...over });

test('the tiers come from the catalog', () => {
  const shop = realShop();
  assert.deepEqual(shop.bulkTiers.map((t) => [t.minQuantity, t.percentOff]), [[12, 10], [24, 15], [48, 20]]);
});

test('the discount starts exactly at each tier', () => {
  const shop = realShop();
  const cases = [[1, 0, 2499], [11, 0, 2499], [12, 10, 2249], [23, 10, 2249], [24, 15, 2124], [47, 15, 2124], [48, 20, 1999]];
  for (const [n, pct, unit] of cases) {
    const q = shop.quote([tee({ quantity: n })]);
    assert.equal(q.ok, true, String(n));
    assert.equal(q.bulk.percentOff, pct, `${n} items`);
    assert.equal(q.lines[0].unitCents, unit, `${n} items`);
    assert.equal(q.lines[0].regularUnitCents, 2499);
    assert.equal(q.subtotalCents, unit * n);
    assert.equal(q.bulk.savingsCents, (2499 - unit) * n);
  }
});

test('every item in the order counts toward the tier: sizes, colors and kinds of order mixed', () => {
  const shop = realShop();
  const q = shop.quote([
    tee({ quantity: 5, size: 'M' }),
    tee({ quantity: 4, size: '2XL', slug: 'chicago' }),
    tee({ quantity: 3, mode: 'rival_gift', slug: 'miami', recipientSlug: 'buffalo' }),
  ]);
  assert.equal(q.ok, true);
  assert.equal(q.bulk.units, 12);
  assert.equal(q.bulk.percentOff, 10);
  assert.equal(q.lines[1].unitCents, 2429, 'the 2XL upcharge is discounted too: $26.99 becomes $24.29');
  for (const l of q.lines) assert.equal(l.metadata.bulk_percent_off, '10');
});

test('the next tier is reported, so the cart can say how close the shopper is', () => {
  const shop = realShop();
  assert.deepEqual(shop.quote([tee({ quantity: 9 })]).bulk.next, { minQuantity: 12, percentOff: 10, unitsAway: 3 });
  assert.deepEqual(shop.quote([tee({ quantity: 30 })]).bulk.next, { minQuantity: 48, percentOff: 20, unitsAway: 18 });
  assert.equal(shop.quote([tee({ quantity: 48 })]).bulk.next, null);
});

test('no discount at all when the catalog has no tiers', () => {
  const none = createShop({ ...data, catalog: { ...data.catalog, bulk: { quoteRequests: true, tiers: [] } } });
  const q = none.quote([tee({ quantity: 30 })]);
  assert.equal(q.bulk.percentOff, 0);
  assert.equal(q.subtotalCents, 2499 * 30);
  assert.deepEqual(data.catalog.bulk.tiers.length, 3, 'the real catalog was not touched');
});

test('checkout charges the bulk price, says so on the line, and records it', async () => {
  const stripe = fakeStripe();
  const handler = makeCheckoutHandler({ shop: realShop(), env: { STRIPE_SECRET_KEY: 'sk_test_unit_tests_only' }, stripeFor: () => stripe });
  const res = await handler(post({ items: [tee({ quantity: 10, size: 'M' }), tee({ quantity: 2, size: '3XL' })] }));
  assert.equal(res.status, 200);
  const p = stripe.calls[0];
  assert.deepEqual(p.line_items.map((l) => l.price_data.unit_amount), [2249, 2429]);
  assert.match(p.line_items[0].price_data.product_data.description, /10% off 12\+/);
  assert.equal(p.line_items[0].price_data.product_data.metadata.bulk_percent_off, '10');
  assert.equal(p.metadata.bulk_percent_off, '10');
  assert.equal(p.line_items[0].adjustable_quantity, undefined, 'a bulk order keeps its exact quantities');
});

test('a made-up discount from the browser is ignored', async () => {
  const stripe = fakeStripe();
  const handler = makeCheckoutHandler({ shop: realShop(), env: { STRIPE_SECRET_KEY: 'sk_test_unit_tests_only' }, stripeFor: () => stripe });
  await handler(post({ items: [tee({ quantity: 2, percentOff: 50, bulk: { percentOff: 50 }, unitCents: 1 })] }));
  assert.equal(stripe.calls[0].line_items[0].price_data.unit_amount, 2499);
  assert.equal(stripe.calls[0].line_items[0].price_data.product_data.description, undefined);
});

test('a matching set has no discount of its own, and counts toward bulk like anything else', () => {
  const shop = fixtureShop();
  const set = [
    { productId: 'adult-tee', designId: 'this-is-our-year', slug: 'chicago', size: 'L', quantity: 1, mode: 'matching_set', bundleId: 'B-AAAAAAAA' },
    { productId: 'kids-tee', designId: 'this-is-our-year', slug: 'chicago', size: 'YS', quantity: 1, mode: 'matching_set', bundleId: 'B-AAAAAAAA' },
  ];
  assert.equal(shop.quote(set).subtotalCents, 2499 + 1500);
  const q = shop.quote([...set, tee({ quantity: 10 })]);
  assert.equal(q.bulk.percentOff, 10);
  assert.equal(q.lines[1].unitCents, 1350);
});
