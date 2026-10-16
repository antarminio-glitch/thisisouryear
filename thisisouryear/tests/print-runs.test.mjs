// Print runs: the bulk order sheet. What waits, how it's grouped, what the
// sheets say, and that starting a run stamps the orders.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { realShop, memoryStorage, data, post } from './fixtures.mjs';
import { waitingOrders, sheetRows, toCsv, sheetText, createPrintRun, listPrintRuns, BLANK_COLUMNS, PACKING_COLUMNS } from '../src/server/print-runs.js';
import { makeAdminHandler } from '../src/server/admin.js';

const photos = JSON.parse(fs.readFileSync(new URL('../src/data/garment-photos.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-10-12T15:00:00Z');
const shop = realShop();

const line = (over = {}) => ({
  quantity: 1,
  team_id: 'dallas',
  design_id: 'this-is-our-year',
  product_id: 'adult-tee',
  product_style: 'tee',
  audience: 'adult',
  size: 'L',
  purchase_mode: 'standard',
  ...over,
});
const order = (id, over = {}) => ({
  id,
  createdAt: '2026-10-11T20:00:00Z',
  status: 'paid',
  shipTo: { name: 'Jane Fan', line1: '123 Main St', line2: '', city: 'Brooklyn', state: 'NY', postalCode: '11201', country: 'US' },
  lines: [line()],
  ...over,
});

async function seeded(orders) {
  const storage = memoryStorage();
  for (const o of orders) await storage.store('orders').set(`order/${o.id}`, o);
  return storage;
}

test('only paid orders that are not in a run yet are waiting, oldest first', () => {
  const list = [
    order('cs_2', { createdAt: '2026-10-11T22:00:00Z' }),
    order('cs_1'),
    order('cs_refunded', { status: 'refunded' }),
    order('cs_done', { printRun: { id: 'R-OLD', at: '2026-10-10T00:00:00Z' } }),
    order('cs_partial', { status: 'partially_refunded', createdAt: '2026-10-11T23:00:00Z' }),
  ];
  assert.deepEqual(waitingOrders(list).map((o) => o.id), ['cs_1', 'cs_2', 'cs_partial']);
});

test('the blanks sheet totals by garment, vendor blank and size, in the product\'s size order', () => {
  const orders = [
    order('cs_1', { lines: [line({ size: 'XL', quantity: 2 }), line({ size: 'S' })] }),
    order('cs_2', { lines: [line({ size: 'XL' }), line({ team_id: 'kansas-city', size: 'M' })] }),
  ];
  const { blanks, counts } = sheetRows({ orders, shop, palettes: data.palettes, photos });
  assert.equal(counts.orders, 2);
  assert.equal(counts.units, 5);
  assert.deepEqual(
    blanks.map((b) => [b.garment, b.style, b.blank, b.size, b.quantity]),
    [
      ['Tee', 'PC54', 'Red', 'M', 1],
      ['Tee', 'PC54', 'True Navy', 'S', 1],
      ['Tee', 'PC54', 'True Navy', 'XL', 3],
    ],
  );
});

test('the packing list has one row per line with the print, the inks and the address', () => {
  const orders = [order('cs_1', { lines: [line({ purchase_mode: 'rival_gift', gift_note: 'Sorry, not sorry' })] })];
  const { packing } = sheetRows({ orders, shop, palettes: data.palettes, photos });
  assert.equal(packing.length, 1);
  const r = packing[0];
  assert.match(r.order, /^TIOY-[0-9A-F]{6}$/);
  assert.equal(r.garment, 'Tee');
  assert.equal(r.style, 'PC54');
  assert.equal(r.blank, 'True Navy');
  assert.equal(r.line1, 'THIS IS');
  assert.equal(r.line2, 'OUR YEAR');
  assert.equal(r.city, 'Dallas');
  assert.match(r.ink1, /#FFFFFF/);
  assert.match(r.ink2, /#0C2340/);
  assert.match(r.notes, /Gift: no prices/);
  assert.match(r.notes, /Sorry, not sorry/);
  assert.equal(r.shipName, 'Jane Fan');
  assert.equal(r.zip, '11201');
  assert.equal(r.country, 'United States');
  assert.equal(r.stripeId, 'cs_1');
});

test('a city with no matched blank is still listed, with a note, and a part refund is flagged', () => {
  const orders = [order('cs_1', { status: 'partially_refunded', lines: [line({ team_id: 'nowhere' })] })];
  const { packing, blanks } = sheetRows({ orders, shop, palettes: data.palettes, photos: null });
  assert.equal(blanks[0].blank, 'Not matched');
  assert.match(packing[0].notes, /No vendor blank matched/);
  assert.match(packing[0].notes, /Partly refunded/);
});

test('the spreadsheet file quotes every cell and defuses formulas', () => {
  const csv = toCsv([{ a: 'plain', b: '=SUM(A1)', c: 'say "hi"' }], [['a', 'A'], ['b', 'B'], ['c', 'C']]);
  assert.equal(csv, '"A","B","C"\r\n"plain","\'=SUM(A1)","say ""hi"""\r\n');
  assert.equal(BLANK_COLUMNS.length, 6);
  assert.equal(PACKING_COLUMNS.length, 24);
});

test('starting a run saves the sheets, stamps the orders, and the next run is empty', async () => {
  const storage = await seeded([order('cs_1'), order('cs_2', { lines: [line({ size: 'M', quantity: 3 })] })]);
  const first = await createPrintRun(storage, { shop, palettes: data.palettes, photos, actor: 'Anthony', note: 'First batch', now: NOW });
  assert.match(first.run.id, /^R-[0-9A-Z]{8}$/);
  assert.deepEqual(first.run.orderIds, ['cs_1', 'cs_2']);
  assert.equal(first.run.counts.units, 4);
  assert.equal(first.run.note, 'First batch');
  const stamped = await storage.store('orders').get('order/cs_1');
  assert.equal(stamped.printRun.id, first.run.id);

  const again = await createPrintRun(storage, { shop, palettes: data.palettes, photos, now: NOW });
  assert.equal(again.error, 'Nothing is waiting to print.');

  await storage.store('orders').set('order/cs_3', order('cs_3', { createdAt: '2026-10-12T00:00:00Z' }));
  const second = await createPrintRun(storage, { shop, palettes: data.palettes, photos, now: new Date('2026-10-13T00:00:00Z') });
  assert.deepEqual(second.run.orderIds, ['cs_3']);

  const runs = await listPrintRuns(storage);
  assert.deepEqual(runs.map((r) => r.id), [second.run.id, first.run.id], 'newest first');
  assert.equal(runs[0].packing, undefined, 'the list leaves the big sheet out');

  const text = sheetText(first.run);
  assert.match(text, /BLANKS TO ORDER/);
  assert.match(text, /3 x Tee, PC54 True Navy, size M/);
  assert.match(text, /Ship to: Jane Fan, 123 Main St/);
});

test('the admin screen can preview, start, download and email a run, with typed confirmations', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
  };
  const TOKEN = 'correct-horse-battery-staple';
  const env = { ADMIN_TOKEN: TOKEN, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_x', EMAIL_FROM: 'orders@example.com', ORDER_EMAIL_TO: 'printer@example.com', ORDER_EMAIL_CC: 'owner@example.com', RESEND_API_BASE: 'https://email.test' };
  const storage = await seeded([order('cs_1')]);
  const handler = makeAdminHandler({ shop, palettes: data.palettes, history: data.history, photos, env, getStorage: async () => storage, fetchImpl, now: () => NOW });
  const call = async (body) => {
    const res = await handler(post(body, 'https://example.test/.netlify/functions/admin', { Authorization: `Bearer ${TOKEN}` }));
    return { status: res.status, body: await res.json() };
  };

  const preview = await call({ action: 'runs.preview' });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.counts.units, 1);
  assert.match(preview.body.blanksCsv, /"Tee","PC54","True Navy","TrueNavy","L","1"/);
  assert.match(preview.body.packingCsv, /"Jane Fan"/);

  assert.equal((await call({ action: 'runs.create' })).status, 400, 'needs PRINT');
  const created = await call({ action: 'runs.create', confirm: 'PRINT', note: 'Batch one' });
  assert.equal(created.status, 200);
  assert.equal(created.body.run.counts.orders, 1);
  assert.ok(created.body.blanksCsv.includes('True Navy'));
  assert.equal((await call({ action: 'runs.create', confirm: 'PRINT' })).status, 409, 'nothing left');

  const list = await call({ action: 'runs.list' });
  assert.equal(list.body.waiting.counts.orders, 0);
  assert.equal(list.body.runs[0].id, created.body.run.id);

  const sheet = await call({ action: 'runs.sheet', id: created.body.run.id });
  assert.match(sheet.body.packingCsv, /"Dallas"/);
  assert.match(sheet.body.text, /Print run R-/);
  assert.equal((await call({ action: 'runs.sheet', id: 'R-NOPE' })).status, 404);

  assert.equal((await call({ action: 'runs.email', id: created.body.run.id })).status, 400, 'needs SEND');
  const emailed = await call({ action: 'runs.email', id: created.body.run.id, confirm: 'SEND' });
  assert.equal(emailed.status, 200);
  assert.deepEqual(sent[0].body.to, ['printer@example.com']);
  assert.deepEqual(sent[0].body.cc, ['owner@example.com']);
  assert.match(sent[0].body.subject, /^Print run R-[0-9A-Z]+: 1 shirt to print$/);
  assert.match(sent[0].body.text, /BLANKS TO ORDER/);
  assert.ok(sent[0].headers['Idempotency-Key']);
  const run = await storage.store('orders').get(`run/${created.body.run.id}`);
  assert.equal(run.vendorEmail.status, 'sent');

  const audit = await storage.store('audit').list('log/');
  assert.equal(audit.length, 2, 'the run and the email are both in the audit log');
});
