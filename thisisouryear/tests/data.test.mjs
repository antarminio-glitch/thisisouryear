import test from 'node:test';
import assert from 'node:assert/strict';
import { data } from './fixtures.mjs';
import { validateData } from '../src/lib/validate-data.js';

test('the real data files pass validation', () => {
  const { errors } = validateData(data);
  assert.deepEqual(errors, []);
});

test('there are 32 cities and every one has a palette, a story and a history record', () => {
  assert.equal(data.teams.length, 32);
  for (const t of data.teams) {
    assert.ok(data.palettes.colorways[t.slug], `${t.slug} palette`);
    assert.ok(data.stories[t.slug], `${t.slug} story`);
    assert.ok(data.history.cities[t.slug], `${t.slug} history`);
  }
});

test('every applied color is a default palette row with the same HEX the site shows', () => {
  for (const t of data.teams) {
    const rows = data.palettes.colorways[t.slug].colors;
    for (const [surface, key] of Object.entries(t.apply)) {
      if (key === null) continue;
      const row = rows.find((r) => r.key === key);
      assert.ok(row, `${t.slug}.${surface} -> ${key}`);
      assert.equal(row.default, true, `${key} must be a default row`);
      assert.equal(row.hex, t[surface].toUpperCase(), `${t.slug}.${surface}`);
    }
  }
});

test('optional rows (metallic, variants, candidates) are never in a default palette', () => {
  let optional = 0;
  for (const cw of Object.values(data.palettes.colorways)) {
    for (const c of cw.colors) {
      if (/metallic|variant|candidate|alternate/i.test(c.role)) {
        optional++;
        assert.equal(c.default, false, c.key);
        assert.ok(!cw.defaults.includes(c.key), c.key);
      }
    }
  }
  assert.equal(optional, 15);
});

test('print references stay separate from screen colors, and missing Pantone stays null', () => {
  const rows = Object.values(data.palettes.colorways).flatMap((c) => c.colors);
  assert.equal(rows.length, 131);
  assert.ok(rows.some((r) => r.pantone === null));
  assert.ok(rows.every((r) => r.pantone === null || typeof r.pantone === 'string'));
  assert.ok(rows.every((r) => r.vendorPrintSelection === null), 'no vendor selection has been invented');
  assert.equal(rows.filter((r) => r.unresolved).length, 21);
  assert.equal(data.palettes.productionApproved, false);
});

test('validation catches a malformed HEX, an unknown palette key and an optional row used as a default', () => {
  const bad = structuredClone(data);
  bad.teams[0].shirt = '#12345';
  bad.teams[1].apply.shirt = 'nope-not-real';
  const optionalKey = bad.palettes.colorways[bad.teams[2].slug].colors.find((c) => !c.default).key;
  bad.teams[2].apply.outline = optionalKey;
  const { errors } = validateData(bad);
  assert.ok(errors.some((e) => e.includes('#RRGGBB')), 'malformed hex');
  assert.ok(errors.some((e) => e.includes('nope-not-real')), 'unknown key');
  assert.ok(errors.some((e) => e.includes('optional row')), 'optional as default');
});

test('validation refuses a product marked sellable without a price or sizes', () => {
  const bad = structuredClone(data);
  bad.catalog.products.find((p) => p.id === 'kids-hoodie').sellable = true;
  const { errors } = validateData(bad);
  assert.ok(errors.some((e) => e.includes('kids-hoodie') && e.includes('no price')));
  assert.ok(errors.some((e) => e.includes('kids-hoodie') && e.includes('no sizes')));
});

test('city stories are all different', () => {
  const heads = new Set(Object.values(data.stories).map((s) => s.headline));
  const bodies = new Set(Object.values(data.stories).map((s) => s.story));
  assert.equal(heads.size, 32);
  assert.equal(bodies.size, 32);
});
