// The cost and margin guard: no price on the site, and no order we ship for
// free, keeps less than the minimum margin over what Printify charges us.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { data } from './fixtures.mjs';
import { checkMargins, floorCents, priceFloors, orderCostCents, orderFloorCents } from '../src/lib/margin.js';

const realCosts = JSON.parse(fs.readFileSync(new URL('../src/data/costs.json', import.meta.url), 'utf8'));

// Made-up costs with every number filled in, so the rules can be tested
// whatever the real file says. They never reach the site.
const costs = () => ({
  minimumMarginPercent: 15,
  products: {
    'adult-tee': { sizes: { S: 1175, M: 1175, L: 1175, XL: 1175, '2XL': 1500, '3XL': 1600 }, shipping: { firstItemCents: 495, extraItemCents: 200 } },
    'adult-hoodie': { sizes: { S: 2267, M: 2267, L: 2267, XL: 2267, '2XL': 2500, '3XL': 2669 }, shipping: { firstItemCents: 879, extraItemCents: 400 } },
    'kids-tee': { sizes: { XS: 924, S: 924, M: 924, L: 924, XL: 924 }, shipping: { firstItemCents: 495, extraItemCents: 200 } },
  },
});
const catalog = () => structuredClone(data.catalog);
const store = (over = {}) => ({ ...data.store, ...over });
const errorsOf = (args) => checkMargins(args).errors;
const priced = (cat, id, priceCents) => Object.assign(cat.products.find((p) => p.id === id), { priceCents });

test('the floor is cost plus the margin, rounded up to the cent', () => {
  assert.equal(floorCents(1175, 15), 1352); // 13.5125 rounds up
  assert.equal(floorCents(1000, 15), 1150);
  assert.equal(floorCents(1000, 0), 1000);
});

test('the real costs file has a margin and a cost for every size on sale, and every price clears it', () => {
  assert.equal(realCosts.minimumMarginPercent, 15, 'the margin the owner chose');
  const { errors } = checkMargins({ catalog: data.catalog, store: data.store, costs: realCosts });
  assert.deepEqual(errors, []);
});

test('with the costs filled in, the real prices keep the margin, shipping and free shipping included', () => {
  const { errors, warnings } = checkMargins({ catalog: catalog(), store: store(), costs: costs() });
  assert.deepEqual(errors, []);
  assert.match(warnings[0], /^Margins: every price keeps at least 15% over cost/);
});

test('a missing cost names the product and size and stops the build', () => {
  const c = costs();
  c.products['adult-tee'].sizes['2XL'] = null;
  c.products['kids-tee'].shipping.extraItemCents = null;
  const errors = errorsOf({ catalog: catalog(), store: store(), costs: c });
  assert.ok(errors.some((e) => e.includes('"adult-tee": no cost for size 2XL')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('"kids-tee": shipping.extraItemCents')), errors.join('\n'));
  assert.ok(errorsOf({ catalog: catalog(), store: store(), costs: null })[0].includes('costs.json is missing'));
  assert.ok(errorsOf({ catalog: catalog(), store: store(), costs: { ...costs(), minimumMarginPercent: '15' } })[0].includes('minimumMarginPercent'));
});

test('a product for sale with no costs at all is refused', () => {
  const c = costs();
  delete c.products['kids-tee'];
  const errors = errorsOf({ catalog: catalog(), store: store(), costs: c });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /nothing for "kids-tee"/);
});

test('a price under cost plus margin is refused, with the floor in the message', () => {
  const cat = catalog();
  priced(cat, 'kids-tee', 1000); // costs 9.24, floor 10.63
  const errors = errorsOf({ catalog: cat, store: store(), costs: costs() });
  assert.ok(errors.some((e) => e.startsWith('Kids tee XS, S, M, L, XL sells for $10.00 but costs $9.24. With 15% on cost the lowest price is $10.63.')), errors.join('\n'));
  assert.equal(errors.filter((e) => e.startsWith('Kids tee')).length, 1, 'sizes that share a cost share one message');
});

test('a shipping fee under what Printify charges to ship one hoodie is caught', () => {
  // The hoodie ships for 8.79 and the fee is 7.50, so the price has to cover the gap. At 27.00 it clears cost plus margin but not that.
  const cat = catalog();
  priced(cat, 'adult-hoodie', 2700);
  const alone = (errors) => errors.filter((e) => e.startsWith('One Hoodie'));
  const errors = errorsOf({ catalog: cat, store: store(), costs: costs() });
  assert.equal(alone(errors)[0], 'One Hoodie S, M, L, XL ordered alone brings in $34.50 ($27.00 plus $7.50 shipping) but costs $31.46 to make and ship. With 15% on cost that order needs $36.18. Raise shippingCents in store.json or the price.');
  // A shipping fee that covers it makes that message go away.
  assert.deepEqual(alone(errorsOf({ catalog: cat, store: store({ shippingCents: 1200 }), costs: costs() })), []);
});

test('a free-shipping order of the thinnest item has to keep the margin after we eat the shipping', () => {
  // 7 kids tees at 14.99 ship free and cost 7 x 9.24 + 4.95 + 6 x 3.60 shipping: $104.93 against a floor of $104.92.
  const c = costs();
  c.products['kids-tee'].shipping.extraItemCents = 360;
  assert.deepEqual(errorsOf({ catalog: catalog(), store: store(), costs: c }), []);
  // At 3.70 each extra tee still clears on its own, but the order does not.
  c.products['kids-tee'].shipping.extraItemCents = 370;
  const errors = errorsOf({ catalog: catalog(), store: store(), costs: c });
  assert.ok(errors.some((e) => e.startsWith('Free shipping starts at $100.00. An order of 7 Kids tee XS comes to $104.93, ships free')), errors.join('\n'));
  // No free shipping, no problem.
  assert.deepEqual(errorsOf({ catalog: catalog(), store: store({ freeShippingMinCents: 0 }), costs: c }), []);
});

test('a dear-to-ship item filled out with the thinnest one is checked too', () => {
  // One hoodie's first-item shipping lands on an order of mostly kids tees.
  const c = costs();
  c.products['adult-hoodie'].shipping.firstItemCents = 3500;
  const errors = errorsOf({ catalog: catalog(), store: store({ shippingCents: 3500 }), costs: c });
  assert.ok(errors.some((e) => e.includes('An order of 1 Hoodie S and 4 Kids tee XS')), errors.join('\n'));
});

test('bulk tiers are checked at their discounted prices only while they are on', () => {
  const cat = catalog();
  cat.bulk.enabled = true; // 20% off at 48: the kids tee drops to 11.99 against cost plus shipping of 11.24
  const errors = errorsOf({ catalog: cat, store: store(), costs: costs() });
  assert.ok(errors.some((e) => e.startsWith('Bulk tier 48+ at 20% off: Kids tee XS, S, M, L, XL drops to $11.99, and 48 of them bring in $575.52 against a floor of $623.85')), errors.join('\n'));
  cat.bulk.enabled = false;
  assert.deepEqual(errorsOf({ catalog: cat, store: store(), costs: costs() }), []);
});

test('the floors the admin screen shows: alone, and inside an order we ship', () => {
  const rows = priceFloors({ catalog: catalog(), costs: costs() });
  const tee2xl = rows.find((r) => r.productId === 'adult-tee' && r.size === '2XL');
  assert.deepEqual(tee2xl, { productId: 'adult-tee', productName: 'Tee', size: '2XL', priceCents: 2699, costCents: 1500, floorCents: 1725, shippedFloorCents: 1955, missing: [] });
  const c = costs();
  c.products['adult-tee'].sizes['2XL'] = null;
  const missing = priceFloors({ catalog: catalog(), costs: c }).find((r) => r.productId === 'adult-tee' && r.size === '2XL');
  assert.equal(missing.floorCents, null);
  assert.deepEqual(missing.missing, ['cost']);
  assert.equal(rows.some((r) => r.productId === 'kids-hoodie'), false, 'not for sale, so no floor');
});

test('a whole order costs every item plus shipping, with the dearest first-item rate counted once', () => {
  const rows = [
    { productId: 'adult-hoodie', size: 'S', quantity: 2 },
    { productId: 'kids-tee', size: 'M', quantity: 3 },
  ];
  // 2 x (22.67 + 4.00) + 3 x (9.24 + 2.00) + (8.79 - 4.00)
  assert.equal(orderCostCents(costs(), rows), 2 * 2667 + 3 * 1124 + 479);
  assert.equal(orderFloorCents(costs(), rows), floorCents(2 * 2667 + 3 * 1124 + 479, 15));
  assert.equal(orderCostCents(costs(), [{ productId: 'adult-tee', size: '9XL', quantity: 1 }]), null);
  assert.equal(orderCostCents(costs(), []), null);
});
