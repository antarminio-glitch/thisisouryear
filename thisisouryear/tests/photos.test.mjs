// The real product photos: color matching, the lookup, and the data file that
// "npm run photos" writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nearestColor, colorDistance, deltaE, skipTest, photoFor, productIdFor, photosForBrowser } from '../src/lib/photos.js';
import { garmentSvg } from '../src/lib/garment.js';
import { data } from './fixtures.mjs';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const garments = read('garments.json');
const photos = read('garment-photos.json');

// Fabric colors as measured from the vendor's photos.
const BLANKS = [
  { code: 'JetBlack', name: 'Jet Black', hex: '#1C1C1E' },
  { code: 'TrueNavy', name: 'True Navy', hex: '#23273A' },
  { code: 'Royal', name: 'Royal', hex: '#2B4C9B' },
  { code: 'Purple', name: 'Purple', hex: '#3E3579' },
  { code: 'Red', name: 'Red', hex: '#AB1A29' },
  { code: 'Coral', name: 'Coral', hex: '#E8706E' },
  { code: 'Orange', name: 'Orange', hex: '#E25B1E' },
  { code: 'Cardinal', name: 'Cardinal', hex: '#6E2735' },
  { code: 'DkChocBrn', name: 'Dark Chocolate Brown', hex: '#3F3029' },
  { code: 'White', name: 'White', hex: '#EDF1F4' },
];

test('the closest blank is picked the way a fan would pick it', () => {
  const pick = (hex) => nearestColor(hex, BLANKS).color.code;
  assert.equal(pick('#0C2340'), 'TrueNavy'); // Dallas navy
  assert.equal(pick('#000000'), 'JetBlack');
  assert.equal(pick('#00338D'), 'Royal'); // Buffalo royal is a blue, not a purple
  assert.equal(pick('#4F2683'), 'Purple'); // Minnesota
  assert.equal(pick('#E31837'), 'Red'); // Kansas City red is a red, not coral or orange
  assert.equal(pick('#97233F'), 'Cardinal'); // Arizona
  assert.equal(pick('#311D00'), 'DkChocBrn'); // Cleveland brown is not black
  assert.equal(pick('#FFFFFF'), 'White');
  assert.equal(nearestColor('#000000', []), null);
  assert.equal(colorDistance('#AB1A29', '#AB1A29'), 0);
  assert.ok(colorDistance('#000000', '#FFFFFF') > 40);
  assert.ok(deltaE('#000000', '#FFFFFF') > 90);
});

test('heathers, camo and neons are skipped unless named by hand', () => {
  const skip = skipTest(garments.skipColors);
  for (const name of ['Athletic Heather', 'Heather Navy', 'Dark Hthr Grey', 'Woodland Camo', 'Neon Pink', 'Ash', 'S. Orange', 'Flush Pink', 'Coral', 'Light Blue']) assert.ok(skip(name), name);
  for (const name of ['Jet Black', 'True Navy', 'Red', 'Kelly', 'Sapphire', 'Dark Green']) assert.ok(!skip(name), name);
});

test('every garment in garments.json is a product in the catalog, with a print position', () => {
  for (const [id, g] of Object.entries(garments.garments)) {
    assert.ok(data.catalog.products.some((p) => p.id === id), `${id} is not a product`);
    assert.match(g.style, /^[A-Z0-9]+$/, `${id} style`);
    for (const k of ['x', 'top', 'width', 'capHeight', 'rowGap']) assert.equal(typeof g.print[k], 'number', `${id} print.${k}`);
  }
  assert.equal(productIdFor(data.catalog.products, 'tee', 'adult'), 'adult-tee');
  assert.equal(productIdFor(data.catalog.products, 'hoodie', 'kids'), 'kids-hoodie');
});

test('garment-photos.json points every city at a photo that exists', () => {
  assert.ok(Object.keys(photos.garments).length > 0, 'run "npm run photos" first');
  for (const [id, g] of Object.entries(photos.garments)) {
    assert.ok(garments.garments[id], `${id} is in garment-photos.json but not garments.json`);
    for (const t of data.teams) {
      const city = g.cities[t.slug];
      assert.ok(city, `${id}: ${t.slug} has no photo. Run "npm run photos".`);
      const c = g.colors[city.color];
      assert.ok(c, `${id}: ${t.slug} points at "${city.color}", which has no photo`);
      assert.match(c.hex, /^#[0-9A-F]{6}$/, `${id} ${city.color} hex`);
      assert.ok(fs.existsSync(new URL(`../public${c.src}`, import.meta.url)), `${id} ${city.color}: ${c.src} is missing from public/`);
      assert.match(c.sourcePage, /^https:\/\/www\.sanmar\.com\/p\//, 'the source page is recorded');
    }
  }
});

test('a city gets its photo, no city gets no photo at all, and unknown products get nothing', () => {
  const p = photoFor(photos, 'adult-tee', 'dallas');
  assert.ok(p?.src.startsWith('/images/garments/'));
  assert.ok(p.hex && p.print);
  assert.equal(photoFor(photos, 'adult-tee', ''), null, 'no city, no shirt picture');
  assert.equal(photoFor(photos, 'not-a-product', 'dallas'), null);
  assert.equal(photoFor(null, 'adult-tee', 'dallas'), null);
  const slim = photosForBrowser(photos);
  assert.ok(slim.garments['adult-tee'].cities.dallas.color);
  assert.equal(slim.garments['adult-tee'].colors[slim.garments['adult-tee'].cities.dallas.color].sourcePage, undefined, 'source links stay out of the page');
});

test('with a photo the garment is the photo plus lettering, without one it is the drawing', () => {
  const photo = photoFor(photos, 'adult-tee', 'dallas');
  const real = garmentSvg({ style: 'tee', audience: 'adult', photo, label: 'x' });
  assert.ok(real.includes('shirt-real'));
  assert.ok(real.includes(`<image href="${photo.src}"`));
  assert.ok(real.includes(`--shirt:${photo.hex}`), 'the lettering keyline takes the measured fabric color');
  assert.ok(real.includes('varsity-artwork'), 'the same reference lettering as everywhere else');
  assert.ok(!real.includes('tee-fill'), 'no drawn shirt under the photo');
  const drawn = garmentSvg({ style: 'tee', audience: 'adult', label: 'x' });
  assert.ok(drawn.includes('tee-fill'));
  assert.ok(!drawn.includes('shirt-real'));
  // Kids photos are already kids-sized; only the drawing is scaled down.
  const kids = garmentSvg({ style: 'tee', audience: 'kids', photo, label: 'x' });
  assert.ok(!kids.includes('scale(0.86)'));
});

test('all four configured garments resolve identically on the server and browser for all 32 cities', () => {
  const browser = photosForBrowser(photos);
  assert.equal(data.teams.length, 32);
  assert.equal(Object.keys(garments.garments).length, 4);
  for (const [id, config] of Object.entries(garments.garments)) {
    assert.ok(photos.garments[id], `${id}: the entire garment mapping is missing`);
    for (const city of data.teams) {
      const photo = photoFor(photos, id, city.slug);
      assert.ok(photo, `${id}/${city.slug}: missing preview`);
      assert.deepEqual(photoFor(browser, id, city.slug), photo);
      assert.deepEqual(photo.print, config.print, `${id}/${city.slug}: wrong garment placement`);
      const svg = garmentSvg({ photo });
      assert.ok(svg.includes('preserveAspectRatio="xMidYMid meet"'), 'show the entire garment');
    }
  }
});

test('a city is one color scheme: the tee, hoodie, kids tee and kids hoodie are all the same blank color', () => {
  const garments = ['adult-tee', 'adult-hoodie', 'kids-tee', 'kids-hoodie'];
  const photos = JSON.parse(fs.readFileSync(new URL('../src/data/garment-photos.json', import.meta.url), 'utf8'));
  // SanMar calls the same burgundy "Athletic Maroon" on tees and "Maroon" on hoodies.
  const shade = (name) => name.replace(/^Athletic /, '');
  for (const t of data.teams) {
    const names = garments.map((id) => {
      const g = photos.garments[id];
      const city = g.cities?.[t.slug];
      assert.ok(city, `${t.slug} has no ${id} blank`);
      return shade(g.colors[city.color].name);
    });
    assert.equal(new Set(names).size, 1, `${t.slug} mixes blanks: ${names.join(' / ')}`);
  }
});
