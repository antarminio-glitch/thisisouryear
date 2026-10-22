// The maker's specs: every garment for sale has real measurements for every
// size it sells, and the size chart page shows them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { data, realShop } from './fixtures.mjs';

const specs = JSON.parse(fs.readFileSync(new URL('../src/data/specs.json', import.meta.url), 'utf8'));
const shop = realShop();

test('every product has a spec with fabric, fit, care and a spec sheet link', () => {
  for (const p of data.catalog.products) {
    const s = specs.products[p.id];
    assert.ok(s, `${p.id} has no spec`);
    for (const k of ['style', 'maker', 'fabric', 'fit', 'care']) assert.ok(typeof s[k] === 'string' && s[k].length > 0, `${p.id}.${k}`);
    assert.match(s.specSheet, /^https:\/\/www\.sanmar\.com\/p\/.+\/specSheetMeasurements$/, `${p.id} spec sheet link`);
    assert.ok(Array.isArray(s.features) && s.features.length > 0, `${p.id} features`);
  }
});

test('every size on sale has a chest width and a fit range, and lengths are inches that make sense', () => {
  for (const p of data.catalog.products) {
    if (!shop.isSellable(p)) continue;
    const s = specs.products[p.id];
    for (const v of p.variants) {
      const m = s.measurements[v.size];
      assert.ok(m, `${p.id} ${v.size} has no measurements`);
      assert.ok(m.chest >= 12 && m.chest <= 40, `${p.id} ${v.size} chest ${m.chest}`);
      assert.match(m.fitsChest, /^\d+-\d+$/, `${p.id} ${v.size} fitsChest`);
      if (m.length != null) assert.ok(m.length >= 15 && m.length <= 40, `${p.id} ${v.size} length ${m.length}`);
      if (p.audience === 'kids') assert.ok(m.ages, `${p.id} ${v.size} ages`);
    }
    // Sizes get bigger, not smaller.
    const chests = p.variants.map((v) => s.measurements[v.size].chest);
    assert.deepEqual(chests, [...chests].sort((a, b) => a - b), `${p.id} chest widths are out of order`);
  }
});

test('the hoodie and the kids tee are priced as agreed and carry the maker\'s sizes', () => {
  assert.equal(shop.product('adult-hoodie').priceCents, 4999);
  assert.deepEqual(shop.product('adult-hoodie').variants.map((v) => v.size), ['S', 'M', 'L', 'XL', '2XL', '3XL']);
  assert.equal(shop.product('kids-tee').priceCents, 1499);
  assert.deepEqual(shop.product('kids-tee').variants.map((v) => v.size), ['XS', 'S', 'M', 'L', 'XL']);
  assert.equal(shop.product('adult-hoodie').sizeChart, '/size-chart/#adult-hoodie');
  assert.equal(shop.product('kids-tee').sizeChart, '/size-chart/#kids-tee');
});
