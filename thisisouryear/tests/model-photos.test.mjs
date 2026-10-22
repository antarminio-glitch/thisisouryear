// On-model photos and the Pantone-based color matching.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { data } from './fixtures.mjs';
import { modelPhotoFor, modelPhotoForCity, cityForBlank, rotatingPick, modelKey } from '../src/lib/photos.js';
import { pantoneToHex, normalizePantone, shirtPantone, shirtHexFor } from '../src/lib/pantone.js';
import { modelPhotoSvg } from '../src/lib/garment.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const photos = read('garment-photos.json');
const models = read('model-photos.json');
const garments = read('garments.json');
const hero = read('hero-photos.json');

test('pantone references are read in any spelling and turned into one screen color', () => {
  assert.equal(normalizePantone('PMS 289C'), '289 C');
  assert.equal(normalizePantone('289'), '289 C');
  assert.equal(normalizePantone('Pantone 289 c'), '289 C');
  assert.equal(normalizePantone('Black 6 C'), 'BLACK 6 C');
  assert.equal(normalizePantone(null), null);
  assert.equal(pantoneToHex('289 C'), '#0C2340');
  assert.equal(pantoneToHex('pms 186c'), '#C8102E');
  assert.equal(pantoneToHex('9999 C'), null, 'unknown references give nothing, never a guess');
});

test('a city matches blanks by its Pantone when it has one, and by its hex when it does not', () => {
  const dallas = data.teams.find((t) => t.slug === 'dallas');
  assert.equal(shirtPantone(dallas, data.palettes), '289 C');
  assert.deepEqual(shirtHexFor(dallas, data.palettes), { hex: '#0C2340', pantone: '289 C', source: 'pantone' });

  const atlanta = data.teams.find((t) => t.slug === 'atlanta');
  assert.equal(shirtPantone(atlanta, data.palettes), null);
  assert.equal(shirtHexFor(atlanta, data.palettes).hex, atlanta.shirt);
  assert.equal(shirtHexFor(atlanta, data.palettes).source, 'hex (no pantone)');

  // A pantone field on the city itself wins over the palette.
  assert.equal(shirtHexFor({ ...dallas, pantone: '287 C' }, data.palettes).hex, '#003087');
});

test('every model photo in hero-photos.json was fetched, is for a known style, and its file exists', () => {
  const styles = new Set(Object.values(garments.garments).map((g) => g.style));
  for (const { style, color } of hero.models) {
    assert.ok(styles.has(style), `${style} is not a garment`);
    const m = modelPhotoFor(models, style, color);
    assert.ok(m, `${style} ${color}: run "npm run photos:models"`);
    assert.equal(m.style, style);
    assert.ok(garments.garments[m.productId], `${style} ${color}: productId ${m.productId}`);
    assert.match(m.hex, /^#[0-9A-F]{6}$/);
    assert.ok(fs.existsSync(new URL(`../public${m.src}`, import.meta.url)), `${m.src} is missing from public/`);
    assert.match(m.sourcePage, /^https:\/\/www\.sanmar\.com\/p\//);
  }
  assert.equal(modelPhotoFor(models, 'PC54', 'Purple'), null);
  assert.equal(modelKey('PC54', 'Red'), 'PC54:Red');
});

test('a city gets the model photo of its own blank, or nothing, and a missing file is not a crash', () => {
  // Buffalo's adult tee is True Royal, which has a model shot.
  const buffalo = modelPhotoForCity(models, photos, 'buffalo');
  assert.ok(buffalo);
  assert.equal(buffalo.color, 'TrueRoyal');
  assert.equal(buffalo.productId, 'adult-tee');
  // Detroit prints on Royal, which has none.
  assert.equal(modelPhotoForCity(models, photos, 'detroit'), null);
  assert.equal(modelPhotoForCity(models, photos, 'not-a-city'), null);
  assert.equal(modelPhotoForCity(null, photos, 'buffalo'), null);
  // Only the products asked for are considered: the adult hoodie in True
  // Royal has a model shot, the kids hoodie in True Royal does not.
  assert.equal(modelPhotoForCity(models, photos, 'buffalo', ['adult-hoodie'])?.productId, 'adult-hoodie');
  assert.equal(modelPhotoForCity(models, photos, 'buffalo', ['kids-hoodie']), null);
  assert.equal(modelPhotoForCity(models, photos, 'buffalo', []), null);
  // An entry whose file vanished still renders a figure; the page never fails to build.
  const svg = modelPhotoSvg({ photo: { src: '/images/models/gone.webp', hex: '#123456', productId: 'adult-tee' }, print: garments.garments['adult-tee'].modelPrint, label: 'x' });
  assert.ok(svg.includes('shirt-model'));
  assert.ok(svg.includes('rotate(0 '), 'the print sits straight and centered on the chest');
  assert.ok(svg.includes('--shirt:#123456'));
});

test('the hero rotates by day and every model shot has a city to wear', () => {
  const tees = hero.models.filter((m) => m.style === 'PC54');
  assert.equal(rotatingPick(tees, new Date('2026-10-11T12:00:00Z')).color, rotatingPick(tees, new Date('2026-10-11T23:00:00Z')).color, 'same day, same pick');
  const a = rotatingPick(tees, new Date('2026-10-11T00:00:00Z'));
  const b = rotatingPick(tees, new Date('2026-10-12T00:00:00Z'));
  assert.notEqual(a.color, b.color, 'next day, next pick');
  assert.equal(rotatingPick([], new Date()), null);
  for (const m of Object.values(models.photos)) {
    assert.ok(cityForBlank(photos, data.teams, m.productId, m.color), `${m.style} ${m.color} has no city printed on it`);
  }
});

test('every style has a model print placement', () => {
  for (const [id, g] of Object.entries(garments.garments)) {
    for (const k of ['x', 'top', 'width', 'capHeight', 'rowGap', 'rotate']) assert.equal(typeof g.modelPrint?.[k], 'number', `${id} modelPrint.${k}`);
  }
});

test('the kids prints sit on the chest, clear of the collar, the hood hem and the pocket', () => {
  // Measured on the youth model photos (600x900): the tee collar ends near row 310,
  // the hoodie's hood hem near row 350 and its pocket starts near row 555.
  const bottom = (p) => p.top + p.capHeight * 2 + p.rowGap;
  const tee = garments.garments['kids-tee'].modelPrint;
  assert.ok(tee.top >= 360, `kids tee print starts at ${tee.top}, too close to the collar`);
  assert.ok(Math.abs(tee.x - 298) <= 6, 'kids tee print is centered on the torso');
  const hood = garments.garments['kids-hoodie'].modelPrint;
  assert.ok(hood.top >= 390, `kids hoodie print starts at ${hood.top}, on the hood hem`);
  assert.ok(bottom(hood) <= 520, `kids hoodie print ends at ${bottom(hood)}, into the pocket`);
  assert.ok(Math.abs(hood.x - 301) <= 6, 'kids hoodie print is centered on the torso');
});
