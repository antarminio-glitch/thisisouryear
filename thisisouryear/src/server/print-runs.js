// Print runs: the bulk order sheet.
//
// Shirts are printed in batches, because that is cheaper than one at a time.
// A print run gathers every paid order that hasn't been printed yet into two
// sheets the vendor can work from:
//
//   blanks    how many of each blank to buy: garment, SanMar style and color,
//             size, quantity
//   packing   one line per shirt: what to print on it, the exact ink colors,
//             and where it ships
//
// Starting a run stamps those orders with the run's id, so the next run only
// picks up new orders. The sheets are saved with the run, so what went to the
// vendor can always be downloaded again exactly as it was.
import { shortId } from './http.js';
import { readAll } from './storage.js';
import { orderRef, printColors, orderEmailSettings } from './order-email.js';
import { emailSender } from './email.js';
import { blankFor } from '../lib/photos.js';
import { cleanText } from '../lib/shop-core.js';

const byDate = (a, b) => String(a.createdAt).localeCompare(String(b.createdAt));

// Orders waiting to be printed: paid (or partly refunded, with a note), not
// in a run yet. Fully refunded orders and test orders never print.
export function waitingOrders(orders) {
  return orders.filter((o) => ['paid', 'partially_refunded'].includes(o.status) && !o.printRun).sort(byDate);
}

const COUNTRY = { US: 'United States' };
const day = (iso, timezone) => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: timezone, dateStyle: 'medium' }) : '');

// Where a size sits in the product's own order, so sheets read S, M, L, not
// alphabetically.
function sizeRank(product, size) {
  const i = (product?.variants ?? []).findIndex((v) => v.size === size);
  return i === -1 ? 999 : i;
}

function lineNotes(order, line) {
  const notes = [];
  if (line.purchase_mode === 'rival_gift') notes.push('Gift: no prices or receipts in the box');
  if (line.gift_note) notes.push(`Gift note: "${line.gift_note}"`);
  if (line.purchase_mode === 'matching_set' && line.bundle_id) notes.push(`Matching set ${line.bundle_id}`);
  if (line.purchase_mode === 'fantasy_punishment') notes.push(`League order${line.league_name ? `: ${line.league_name}` : ''}`);
  if (order.status === 'partially_refunded') notes.push('Partly refunded: check the order in Stripe before printing');
  return notes;
}

const ink = (c) => (c ? `${c.name} ${c.hex}${c.pantone ? ` (Pantone ${c.pantone})` : ''}` : '');

// The two sheets for a set of orders, as plain rows.
export function sheetRows({ orders, shop, palettes = null, photos = null }) {
  const timezone = shop.store?.timezone ?? 'America/New_York';
  const packing = [];
  const totals = new Map();
  let units = 0;

  for (const order of orders) {
    const s = order.shipTo ?? {};
    for (const line of order.lines ?? []) {
      const product = shop.product(line.product_id);
      const design = shop.design(line.design_id);
      const city = shop.city(line.team_id);
      const blank = blankFor(photos, line.product_id, line.team_id);
      const colors = city ? printColors(shop, palettes, city.slug) : [];
      const at = (surface) => colors.find((c) => c.surface === surface);
      const quantity = Number(line.quantity ?? 1) || 1;
      units += quantity;
      const notes = lineNotes(order, line);
      if (!blank) notes.push('No vendor blank matched: pick the blank from the city colors');

      packing.push({
        order: orderRef(order.id),
        paid: day(order.createdAt, timezone),
        garment: product?.name ?? line.product_id ?? '',
        style: blank?.style ?? '',
        blank: blank?.name ?? '',
        size: line.size ?? '',
        quantity,
        design: design?.name ?? line.design_id ?? '',
        line1: design?.lines?.[0] ?? '',
        line2: design?.lines?.[1] ?? '',
        city: city?.name ?? line.team_id ?? '',
        colors: city?.colors ?? '',
        ink1: ink(at('line1')),
        ink2: ink(at('line2')),
        outline: ink(at('outline')),
        notes: notes.join('. '),
        shipName: s.name ?? '',
        address1: s.line1 ?? '',
        address2: s.line2 ?? '',
        shipCity: s.city ?? '',
        state: s.state ?? '',
        zip: s.postalCode ?? '',
        country: COUNTRY[s.country] ?? s.country ?? '',
        stripeId: order.id,
      });

      const key = [line.product_id, blank?.code ?? '', line.size].join('|');
      const row = totals.get(key) ?? {
        garment: product?.name ?? line.product_id ?? '',
        style: blank?.style ?? '',
        blank: blank?.name ?? 'Not matched',
        code: blank?.code ?? '',
        size: line.size ?? '',
        quantity: 0,
        rank: [product?.id ?? '', blank?.name ?? '', sizeRank(product, line.size)],
      };
      row.quantity += quantity;
      totals.set(key, row);
    }
  }

  const blanks = [...totals.values()]
    .sort((a, b) => String(a.rank[0]).localeCompare(String(b.rank[0])) || String(a.rank[1]).localeCompare(String(b.rank[1])) || a.rank[2] - b.rank[2])
    .map(({ rank, ...row }) => row);

  return { packing, blanks, counts: { orders: orders.length, units } };
}

export const BLANK_COLUMNS = [
  ['garment', 'Garment'],
  ['style', 'SanMar style'],
  ['blank', 'Blank color'],
  ['code', 'Color code'],
  ['size', 'Size'],
  ['quantity', 'Quantity'],
];

export const PACKING_COLUMNS = [
  ['order', 'Order'],
  ['paid', 'Paid'],
  ['garment', 'Garment'],
  ['style', 'SanMar style'],
  ['blank', 'Blank color'],
  ['size', 'Size'],
  ['quantity', 'Quantity'],
  ['design', 'Design'],
  ['line1', 'Line 1'],
  ['line2', 'Line 2'],
  ['city', 'City'],
  ['colors', 'Colors'],
  ['ink1', 'Line 1 ink'],
  ['ink2', 'Line 2 ink'],
  ['outline', 'Outline ink'],
  ['notes', 'Notes'],
  ['shipName', 'Ship to'],
  ['address1', 'Address 1'],
  ['address2', 'Address 2'],
  ['shipCity', 'City'],
  ['state', 'State'],
  ['zip', 'ZIP'],
  ['country', 'Country'],
  ['stripeId', 'Stripe reference'],
];

// A spreadsheet file. Every value is quoted, and anything a spreadsheet would
// read as a formula gets a leading apostrophe so it stays plain text.
export function toCsv(rows, columns) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = columns.map(([, label]) => cell(label)).join(',');
  const body = rows.map((r) => columns.map(([key]) => cell(r[key])).join(','));
  return [head, ...body].join('\r\n') + '\r\n';
}

// The same sheets as readable text, for the email to the vendor.
export function sheetText(run, { timezone = 'America/New_York' } = {}) {
  const out = [];
  const say = (line = '') => out.push(line);
  const when = new Date(run.createdAt).toLocaleString('en-US', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' });
  say(`Print run ${run.id}: ${run.counts.units} ${run.counts.units === 1 ? 'shirt' : 'shirts'} across ${run.counts.orders} ${run.counts.orders === 1 ? 'order' : 'orders'}`);
  say(`Started ${when} (Eastern)`);
  if (run.note) say(`Note: ${run.note}`);
  say('');
  say('BLANKS TO ORDER');
  for (const b of run.blanks) say(`  ${String(b.quantity).padStart(3)} x ${b.garment}, ${b.style ? `${b.style} ` : ''}${b.blank}, size ${b.size}`);
  say('');
  say('WHAT TO PRINT AND WHERE IT GOES');
  let last = null;
  for (const r of run.packing) {
    if (r.order !== last) {
      say('');
      say(`${r.order} (paid ${r.paid})`);
      say(`  Ship to: ${[r.shipName, r.address1, r.address2, [r.shipCity, [r.state, r.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), r.country].filter(Boolean).join(', ')}`);
      last = r.order;
    }
    say(`  ${r.quantity} x ${r.garment}, ${r.style ? `${r.style} ` : ''}${r.blank || 'blank not matched'}, size ${r.size}`);
    say(`      Print: ${r.design} ("${r.line1}" / "${r.line2}") in ${r.city} colors, ${r.colors}`);
    say(`      Line 1: ${r.ink1}. Line 2: ${r.ink2}. Outline: ${r.outline}.`);
    if (r.notes) say(`      Notes: ${r.notes}`);
  }
  say('');
  say('HEX values are screen colors. Match the Pantone reference where there is one, otherwise go by the color name.');
  say('Questions about this run? Reply to this email.');
  return out.join('\n');
}

export const runSheets = (run) => ({ blanksCsv: toCsv(run.blanks, BLANK_COLUMNS), packingCsv: toCsv(run.packing, PACKING_COLUMNS) });

// What is waiting right now, with the sheets ready to download.
export async function previewPrintRun(storage, { shop, palettes, photos }) {
  const orders = waitingOrders(await readAll(storage.store('orders'), 'order/'));
  const sheet = sheetRows({ orders, shop, palettes, photos });
  return { ...sheet, blanksCsv: toCsv(sheet.blanks, BLANK_COLUMNS), packingCsv: toCsv(sheet.packing, PACKING_COLUMNS) };
}

// Starts a run: saves the sheets and stamps every order in it.
export async function createPrintRun(storage, { shop, palettes, photos, actor = 'owner', note = '', now = new Date() }) {
  const store = storage.store('orders');
  const orders = waitingOrders(await readAll(store, 'order/'));
  if (!orders.length) return { error: 'Nothing is waiting to print.' };
  const sheet = sheetRows({ orders, shop, palettes, photos });
  const run = {
    id: shortId('R'),
    createdAt: now.toISOString(),
    actor,
    note: cleanText(note).slice(0, 300),
    orderIds: orders.map((o) => o.id),
    counts: sheet.counts,
    blanks: sheet.blanks,
    packing: sheet.packing,
    vendorEmail: null,
  };
  await store.set(`run/${run.id}`, run);
  for (const o of orders) {
    o.printRun = { id: run.id, at: run.createdAt };
    await store.set(`order/${o.id}`, o);
  }
  return { run };
}

export async function listPrintRuns(storage) {
  const runs = await readAll(storage.store('orders'), 'run/');
  return runs.sort((a, b) => byDate(b, a)).map(({ packing, ...rest }) => rest);
}

// Emails a run's sheets to the vendor. Same addresses as the order emails.
export async function emailPrintRun({ runId, storage, shop, env, fetchImpl = fetch, now = () => new Date() }) {
  const store = storage.store('orders');
  const run = await store.get(`run/${runId}`);
  if (!run) return { status: 'missing' };
  const settings = orderEmailSettings(env);
  if (!settings.ready) return { status: 'not_configured', missing: settings.missing };
  const send = emailSender(env, fetchImpl);
  const attempt = (run.vendorEmail?.attempt ?? 0) + 1;
  const text = sheetText(run, { timezone: shop.store?.timezone });
  try {
    const result = await send({
      to: settings.to,
      cc: settings.cc,
      replyTo: settings.replyTo,
      subject: `Print run ${run.id}: ${run.counts.units} ${run.counts.units === 1 ? 'shirt' : 'shirts'} to print`,
      text,
      idempotencyKey: `run-email/${run.id}/${attempt}`,
    });
    run.vendorEmail = { status: 'sent', at: now().toISOString(), attempt, to: settings.to, providerId: result?.id ?? null };
  } catch (err) {
    run.vendorEmail = { status: 'failed', at: now().toISOString(), attempt, error: String(err?.message ?? err).slice(0, 200) };
  }
  await store.set(`run/${run.id}`, run);
  return run.vendorEmail.status === 'sent' ? { status: 'sent', to: settings.to } : { status: 'failed', error: run.vendorEmail.error };
}
