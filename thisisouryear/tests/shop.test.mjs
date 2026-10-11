import test from 'node:test';
import assert from 'node:assert/strict';
import { realShop, fixtureShop } from './fixtures.mjs';

const tee = (over = {}) => ({ productId: 'adult-tee', designId: 'this-is-our-year', slug: 'dallas', size: 'L', quantity: 1, mode: 'standard', ...over });

test('the tee, the hoodie and the kids tee are for sale in the real catalog; the kids hoodie is not yet', () => {
  const shop = realShop();
  for (const id of ['adult-tee', 'adult-hoodie', 'kids-tee']) assert.equal(shop.isSellable(shop.product(id)), true, id);
  assert.equal(shop.isSellable(shop.product('kids-hoodie')), false);
  assert.ok(shop.missingFor(shop.product('kids-hoodie')).includes('priceCents'));
  assert.equal(shop.priceRange('kids-hoodie'), null);
  assert.deepEqual(shop.priceRange('adult-tee'), { lowCents: 1999, highCents: 2199 });
  assert.deepEqual(shop.priceRange('adult-hoodie'), { lowCents: 4999, highCents: 5199 });
  assert.deepEqual(shop.priceRange('kids-tee'), { lowCents: 999, highCents: 999 });
});

test('prices come from the catalog: $19.99, and $2 more for 2XL and 3XL', () => {
  const shop = realShop();
  assert.equal(shop.availability(tee()).priceCents, 1999);
  assert.equal(shop.availability(tee({ size: '2XL' })).priceCents, 2199);
  assert.equal(shop.availability(tee({ size: '3XL' })).priceCents, 2199);
});

test('a size is never chosen for you', () => {
  const shop = realShop();
  for (const size of [undefined, null, '']) {
    const a = shop.availability(tee({ size }));
    assert.equal(a.ok, false);
    assert.equal(a.code, 'size_required');
  }
});

test('unsupported size, unknown city, unknown item and unknown design all say so', () => {
  const shop = realShop();
  assert.equal(shop.availability(tee({ size: '9XL' })).code, 'size_unavailable');
  assert.equal(shop.availability(tee({ slug: 'nowhere' })).code, 'unknown_city');
  assert.equal(shop.availability(tee({ slug: '__proto__' })).code, 'unknown_city');
  assert.equal(shop.availability(tee({ productId: 'socks' })).code, 'unknown_product');
  assert.equal(shop.availability(tee({ designId: 'nope' })).code, 'unknown_design');
});

test('the kids hoodie and the follow-up design are concept only in the real catalog', () => {
  const shop = realShop();
  assert.equal(shop.availability(tee({ productId: 'kids-hoodie', size: 'M' })).code, 'product_unavailable');
  assert.equal(shop.availability(tee({ productId: 'adult-hoodie' })).ok, true);
  assert.equal(shop.availability(tee({ productId: 'kids-tee', size: 'M' })).ok, true);
  assert.equal(shop.availability(tee({ productId: 'kids-tee', size: 'YM' })).code, 'size_unavailable');
  assert.equal(shop.availability(tee({ designId: 'wait-til-next-year' })).code, 'design_unavailable');
});

test('out of stock is reported, not skipped', () => {
  const shop = fixtureShop();
  const a = shop.availability({ productId: 'kids-tee', designId: 'this-is-our-year', slug: 'dallas', size: 'YL' });
  assert.equal(a.code, 'out_of_stock');
});

test('a quote prices every line on the server and adds flat shipping once', () => {
  const shop = realShop();
  const q = shop.quote([tee({ quantity: 2 }), tee({ slug: 'green-bay', size: '3XL' })]);
  assert.equal(q.ok, true);
  assert.equal(q.lines[0].lineCents, 3998);
  assert.equal(q.lines[1].unitCents, 2199);
  assert.equal(q.subtotalCents, 3998 + 2199);
  assert.equal(q.shippingCents, 499);
  assert.equal(q.totalCents, 3998 + 2199 + 499);
  assert.equal(q.lines[0].name, 'This Is Our Year Tee, Dallas, Navy / Silver, Size L');
});

test('a price sent by the browser is ignored, and a stale one is pointed out', () => {
  const shop = realShop();
  const q = shop.quote([tee({ seenPriceCents: 1, unitCents: 1, priceCents: 1 })]);
  assert.equal(q.lines[0].unitCents, 1999);
  assert.equal(q.lines[0].notices[0].code, 'price_changed');
  assert.match(q.lines[0].notices[0].message, /\$0\.01 to \$19\.99/);
});

test('every line carries the order details the brief asks for', () => {
  const shop = realShop();
  const m = shop.quote([tee()]).lines[0].metadata;
  for (const k of ['team_id', 'colorway_version', 'design_id', 'product_style', 'audience', 'size', 'provider_variant_id', 'artwork_version', 'purchase_mode']) {
    assert.ok(m[k], k);
  }
  assert.equal(m.team_id, 'dallas');
  assert.equal(m.colorway_version, '2026-10-10');
  assert.equal(m.provider_variant_id, 'unmapped');
  assert.equal(m.print_approval, 'label_only');
  assert.equal(m.purchase_mode, 'standard');
});

test('bad quantities and an oversized cart are refused', () => {
  const shop = realShop();
  assert.equal(shop.quote([tee({ quantity: 0 })]).lines[0].code, 'bad_quantity');
  assert.equal(shop.quote([tee({ quantity: 1.5 })]).lines[0].code, 'bad_quantity');
  assert.equal(shop.quote([tee({ quantity: 50 })]).lines[0].ok, true);
  assert.equal(shop.quote([tee({ quantity: 51 })]).lines[0].code, 'too_many');
  const huge = shop.quote([tee({ quantity: 50 }), tee({ quantity: 50, size: 'XL' }), tee({ quantity: 1, size: 'M' })]);
  assert.equal(huge.ok, false, 'more than 100 in one order goes through a quote');
  assert.match(huge.problems[0], /bulk quote/);
  assert.equal(shop.quote([]).ok, false);
  assert.equal(shop.quote(Array.from({ length: 41 }, () => tee())).ok, false);
  assert.equal(shop.quote('nonsense').ok, false);
  assert.equal(shop.quote([null]).ok, false);
});

test('a rival gift keeps the friend\'s own city separate from the colors they have to wear', () => {
  const shop = realShop();
  const q = shop.quote([tee({ mode: 'rival_gift', slug: 'dallas', recipientSlug: 'philadelphia' })]);
  assert.equal(q.ok, true);
  assert.equal(q.lines[0].metadata.team_id, 'dallas');
  assert.equal(q.lines[0].metadata.recipient_team_id, 'philadelphia');
  assert.equal(q.lines[0].metadata.purchase_mode, 'rival_gift');
  assert.equal(shop.quote([tee({ mode: 'rival_gift' })]).lines[0].code, 'recipient_required');
  assert.equal(shop.quote([tee({ mode: 'rival_gift', recipientSlug: 'dallas' })]).lines[0].code, 'same_city');
});

test('gift notes are cleaned and length-limited, and dropped while the feature is off', () => {
  const on = fixtureShop({ giftNotes: true });
  const ok = on.quote([tee({ mode: 'rival_gift', recipientSlug: 'philadelphia', giftNote: '  Enjoy\u0000 the\n\nshirt  ' })]);
  assert.equal(ok.lines[0].metadata.gift_note, 'Enjoy the shirt');
  assert.equal(on.quote([tee({ mode: 'rival_gift', recipientSlug: 'philadelphia', giftNote: 'x'.repeat(201) })]).lines[0].code, 'note_too_long');
  const off = realShop().quote([tee({ mode: 'rival_gift', recipientSlug: 'philadelphia', giftNote: 'hello' })]);
  assert.equal(off.lines[0].metadata.gift_note, undefined);
});

test('a matching set is two real lines sharing a bundle id', () => {
  const shop = fixtureShop();
  const set = [
    tee({ mode: 'matching_set', bundleId: 'B-1', size: 'L' }),
    { productId: 'kids-tee', designId: 'this-is-our-year', slug: 'dallas', size: 'YM', quantity: 1, mode: 'matching_set', bundleId: 'B-1' },
  ];
  const q = shop.quote(set);
  assert.equal(q.ok, true);
  assert.equal(q.lines.length, 2);
  assert.deepEqual(q.lines.map((l) => l.metadata.bundle_id), ['B-1', 'B-1']);
  assert.deepEqual(q.lines.map((l) => l.audience), ['adult', 'kids']);
  assert.equal(q.subtotalCents, 1999 + 1500, 'no discount is invented');
});

test('a matching set never goes through as half a set without saying why', () => {
  const shop = fixtureShop();
  const half = shop.quote([
    tee({ mode: 'matching_set', bundleId: 'B-2' }),
    { productId: 'kids-tee', designId: 'this-is-our-year', slug: 'dallas', size: 'YL', quantity: 1, mode: 'matching_set', bundleId: 'B-2' },
  ]);
  assert.equal(half.ok, false);
  assert.equal(half.lines[1].code, 'out_of_stock');
  assert.equal(half.lines[0].code, 'set_incomplete');
  assert.match(half.lines[0].message, /other half.*out of stock/);

  const alone = shop.quote([tee({ mode: 'matching_set', bundleId: 'B-3' })]);
  assert.equal(alone.lines[0].code, 'set_incomplete');

  const mixed = shop.quote([
    tee({ mode: 'matching_set', bundleId: 'B-4', slug: 'dallas' }),
    { productId: 'kids-tee', designId: 'this-is-our-year', slug: 'miami', size: 'YM', quantity: 1, mode: 'matching_set', bundleId: 'B-4' },
  ]);
  assert.equal(mixed.lines[0].code, 'set_incomplete');
  assert.match(mixed.lines[0].message, /different colors/);

  assert.equal(shop.quote([tee({ mode: 'matching_set' })]).lines[0].code, 'bundle_required');
});

test('with the real catalog a tee and kids tee set goes through, and a set with the kids hoodie is held', () => {
  const good = realShop().quote([
    tee({ mode: 'matching_set', bundleId: 'B-5' }),
    { productId: 'kids-tee', designId: 'this-is-our-year', slug: 'dallas', size: 'M', quantity: 1, mode: 'matching_set', bundleId: 'B-5' },
  ]);
  assert.equal(good.ok, true);
  assert.equal(good.subtotalCents, 1999 + 999);
  const held = realShop().quote([
    tee({ mode: 'matching_set', bundleId: 'B-6' }),
    { productId: 'kids-hoodie', designId: 'this-is-our-year', slug: 'dallas', size: 'M', quantity: 1, mode: 'matching_set', bundleId: 'B-6' },
  ]);
  assert.equal(held.ok, false);
  assert.equal(held.lines[1].code, 'product_unavailable');
  assert.equal(held.lines[0].code, 'set_incomplete');
});

test('a league order is mixed sizes in the winner\'s colors under one league id', () => {
  const shop = realShop();
  const rows = [['S', 2], ['L', 3], ['3XL', 1]].map(([size, quantity]) =>
    tee({ mode: 'fantasy_punishment', slug: 'kansas-city', size, quantity, leagueOrderId: 'LG-ABC', leagueName: '  The   Sunday Regrets ' }));
  const q = shop.quote(rows);
  assert.equal(q.ok, true);
  assert.equal(q.subtotalCents, 2 * 1999 + 3 * 1999 + 2199);
  assert.ok(q.lines.every((l) => l.metadata.league_order_id === 'LG-ABC' && l.metadata.league_name === 'The Sunday Regrets'));
  assert.equal(shop.quote([tee({ mode: 'fantasy_punishment' })]).lines[0].code, 'league_required');
  assert.equal(shop.quote([tee({ mode: 'fantasy_punishment', leagueOrderId: 'LG-1', leagueName: 'x'.repeat(61) })]).lines[0].code, 'league_name_too_long');
});

test('unknown order types and odd ids are refused', () => {
  const shop = realShop();
  assert.equal(shop.quote([tee({ mode: 'free_stuff' })]).lines[0].code, 'bad_mode');
  assert.equal(shop.quote([tee({ mode: 'matching_set', bundleId: '<script>' })]).lines[0].code, 'bundle_required');
});

test('colors can be required to have vendor approval before anything sells', () => {
  const strict = fixtureShop({ requireVendorApprovedColors: true });
  assert.equal(strict.availability(tee()).code, 'colors_not_approved');
  assert.equal(realShop().availability(tee()).ok, true);
});
