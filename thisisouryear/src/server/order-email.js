// The email that tells the print vendor to make and ship an order.
//
// It goes out once for every paid order, after Stripe's signed message says
// the payment went through. It carries what the vendor needs and nothing
// more: where to ship, what to print, and the exact colors. No prices, and no
// customer email address.
//
// Settings (Netlify environment variables):
//   ORDER_EMAIL_TO   the vendor's address. Several can be separated by commas.
//   ORDER_EMAIL_CC   your own address, for a copy. Replies go here too.
//   EMAIL_PROVIDER, RESEND_API_KEY, EMAIL_FROM   the email service.
//
// With only ORDER_EMAIL_CC set, the email comes to you and you forward it.
import { sha256 } from './http.js';
import { emailSender } from './email.js';

const SURFACES = [
  ['shirt', 'Garment'],
  ['line1', 'Line 1'],
  ['line2', 'Line 2'],
  ['outline', 'Outline'],
];
// If a send was started but never recorded (the server stopped mid-way), it
// can be tried again after this long. The email service gets the same key, so
// it still won't go out twice.
const STUCK_AFTER_MS = 15 * 60 * 1000;

const addresses = (v) =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));

export const orderRef = (orderId) => `TIOY-${sha256(String(orderId)).slice(0, 6).toUpperCase()}`;

// What's set up, and what's missing, for order emails.
export function orderEmailSettings(env) {
  const to = addresses(env.ORDER_EMAIL_TO);
  const cc = addresses(env.ORDER_EMAIL_CC);
  const missing = [];
  if (env.EMAIL_PROVIDER !== 'resend') missing.push('EMAIL_PROVIDER (set it to resend)');
  if (!env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (!env.EMAIL_FROM) missing.push('EMAIL_FROM');
  if (!to.length && !cc.length) missing.push('ORDER_EMAIL_TO');
  // Nobody to send to directly? Send to the owner's copy address instead.
  return { ready: missing.length === 0, to: to.length ? to : cc, cc: to.length ? cc : [], replyTo: cc, missing, vendorSet: to.length > 0 };
}

// The shipping address Stripe collected at checkout.
export function shipToFrom(session) {
  const d = session?.collected_information?.shipping_details ?? session?.shipping_details ?? null;
  const a = d?.address;
  if (!a) return null;
  return {
    name: d.name ?? session?.customer_details?.name ?? '',
    line1: a.line1 ?? '',
    line2: a.line2 ?? '',
    city: a.city ?? '',
    state: a.state ?? '',
    postalCode: a.postal_code ?? '',
    country: a.country ?? '',
  };
}

// The four colored parts of a city's garment, with names, HEX and Pantone.
export function printColors(shop, palettes, slug) {
  const team = shop.city(slug);
  if (!team) return [];
  const rows = palettes?.colorways?.[slug]?.colors ?? [];
  const labels = team.colors.split('/').map((s) => s.trim());
  const sameAsShirt = team.line2.toUpperCase() === team.shirt.toUpperCase();
  const fallback = {
    shirt: labels[0],
    line1: 'White',
    line2: sameAsShirt ? labels[0] : (labels[1] ?? labels[0]),
    outline: sameAsShirt ? (labels[1] ?? 'Accent') : 'Accent',
  };
  return SURFACES.map(([surface, label]) => {
    const row = rows.find((r) => r.key === team.apply?.[surface]) ?? null;
    return {
      surface,
      label,
      name: row?.label ?? fallback[surface],
      hex: team[surface].toUpperCase(),
      pantone: row?.pantone ?? null,
      unresolved: row?.unresolved === true,
      vendorPrintSelection: row?.vendorPrintSelection ?? null,
    };
  });
}

const pad = (s, n) => String(s).padEnd(n, ' ');
const COUNTRY = { US: 'United States' };

export function orderEmailContent({ order, shop, palettes, timezone = 'America/New_York', test = false }) {
  const ref = orderRef(order.id);
  const units = (order.lines ?? []).reduce((n, l) => n + (l.quantity ?? 1), 0);
  const when = new Date(order.createdAt).toLocaleString('en-US', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' });
  const s = order.shipTo;
  const out = [];
  const say = (line = '') => out.push(line);

  if (test) say('THIS IS A TEST. Nothing was paid and nothing needs printing.\n');
  say(`New order to print and ship: ${ref}`);
  say('');
  say(`Paid: ${when} (Eastern)`);
  say(`Items: ${units}`);
  say(`Stripe reference: ${order.id}`);
  say('');
  say('SHIP TO');
  if (s) {
    if (s.name) say(s.name);
    if (s.line1) say(s.line1);
    if (s.line2) say(s.line2);
    say([s.city, [s.state, s.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', '));
    say(COUNTRY[s.country] ?? s.country);
  } else {
    say('Not on this order. Check the order in Stripe before shipping.');
  }
  say('');
  say(`Ship standard. The customer was told ${shop.store.shipMinDays} to ${shop.store.shipMaxDays} business days.`);
  say('');
  say('WHAT TO PRINT');

  const notes = [];
  const sets = new Map();
  (order.lines ?? []).forEach((l, i) => {
    const n = i + 1;
    const product = shop.product(l.product_id);
    const design = shop.design(l.design_id);
    const city = shop.city(l.team_id);
    say('');
    say(`${n}. ${product?.name ?? l.product_id}${l.audience === 'kids' && !/kids/i.test(product?.name ?? '') ? ' (kids)' : ''}, size ${l.size}. Quantity ${l.quantity ?? 1}.`);
    say(`   Design: ${design?.name ?? l.design_id}${l.artwork_version ? ` (artwork ${l.artwork_version})` : ''}. Lettering: ${(design?.lines ?? []).join(' / ')}`);
    if (city) {
      say(`   Colors: ${city.name}, ${city.colors}`);
      for (const c of printColors(shop, palettes, city.slug)) {
        const pms = c.pantone ? `Pantone ${c.pantone}${c.unresolved ? ' (reference not confirmed)' : ''}` : 'no Pantone reference';
        const approved = c.vendorPrintSelection ? `. Your approved ink: ${c.vendorPrintSelection}` : '';
        say(`     ${pad(`${c.label}:`, 10)}${pad(c.name, 18)}${pad(c.hex, 9)}${pms}${approved}`);
      }
    }
    say(`   Item code: ${l.variant_key ?? ''}`);
    say(`   Your product code: ${l.provider_variant_id && l.provider_variant_id !== 'unmapped' ? l.provider_variant_id : 'not set yet'}`);

    if (l.purchase_mode === 'rival_gift') notes.push(`Item ${n} is a gift. Leave prices and receipts out of the box.`);
    if (l.gift_note) notes.push(`Gift note to include with item ${n}: "${l.gift_note}"`);
    if (l.purchase_mode === 'matching_set' && l.bundle_id) sets.set(l.bundle_id, [...(sets.get(l.bundle_id) ?? []), n]);
    if (l.purchase_mode === 'fantasy_punishment' && l.league_name) notes.push(`League order: ${l.league_name}.`);
  });
  for (const [, items] of sets) notes.push(`Items ${items.join(' and ')} are a matching set. Same colors on purpose.`);

  const uniqueNotes = [...new Set(notes)];
  if (uniqueNotes.length) {
    say('');
    say('NOTES');
    for (const n of uniqueNotes) say(`- ${n}`);
  }
  say('');
  say('About the colors: HEX values are screen colors. Match the Pantone reference where there is one, otherwise go by the color name. If a color looks wrong for the city, ask before printing.');
  say('');
  say('Questions about this order? Reply to this email.');

  const subject = `${test ? '[TEST] ' : ''}New order ${ref}: ${units} ${units === 1 ? 'item' : 'items'} to print${s?.state ? `, ship to ${s.state}` : ''}`;
  return { ref, subject, text: out.join('\n') };
}

// Sends the order email once. Safe to call again for the same order: it
// won't send twice unless `again` is set by the owner on purpose.
// Returns { status } as one of: sent, already_sent, in_progress,
// not_configured, missing, failed.
export async function sendOrderEmail({ orderId, storage, shop, palettes, env, fetchImpl = fetch, now = () => new Date(), again = false }) {
  const orders = storage.store('orders');
  const order = await orders.get(`order/${orderId}`);
  if (!order) return { status: 'missing' };

  const settings = orderEmailSettings(env);
  const key = `email/${orderId}`;
  const prior = await orders.get(key);
  const save = async (state) => {
    await orders.set(key, state);
    order.vendorEmail = { status: state.status, at: state.at, to: state.to ?? [], error: state.error ?? null };
    await orders.set(`order/${orderId}`, order);
  };

  if (!settings.ready) {
    if (prior?.status !== 'sent') await save({ status: 'not_configured', at: now().toISOString(), missing: settings.missing });
    return { status: 'not_configured', missing: settings.missing };
  }
  if (prior?.status === 'sent' && !again) return { status: 'already_sent' };
  const fresh = prior?.status === 'sending' && now().getTime() - new Date(prior.at).getTime() < STUCK_AFTER_MS;
  if (fresh && !again) return { status: 'in_progress' };

  // Claim the send before making it, so two deliveries of the same Stripe
  // message can't both email the vendor.
  const attempt = prior?.status === 'failed' ? (prior.attempt ?? 1) + 1 : again ? (prior?.attempt ?? 1) + 1 : (prior?.attempt ?? 1);
  const claim = { status: 'sending', at: now().toISOString(), attempt };
  if (!prior || prior.status === 'not_configured') {
    if (prior) await orders.set(key, claim);
    else if (!(await orders.setIfNew(key, claim))) return { status: 'in_progress' };
  } else {
    await orders.set(key, claim);
  }

  const send = emailSender(env, fetchImpl);
  const content = orderEmailContent({ order, shop, palettes, timezone: shop.store.timezone });
  try {
    const result = await send({
      to: settings.to,
      cc: settings.cc,
      replyTo: settings.replyTo,
      subject: content.subject,
      text: content.text,
      idempotencyKey: sha256(`order-email/${orderId}/${attempt}`),
    });
    await save({ status: 'sent', at: now().toISOString(), attempt, to: settings.to, cc: settings.cc, providerId: result?.id ?? null });
    return { status: 'sent', to: settings.to };
  } catch (err) {
    const error = String(err?.message ?? err).slice(0, 200);
    await save({ status: 'failed', at: now().toISOString(), attempt, error });
    return { status: 'failed', error };
  }
}

// A sample order for checking the setup, so the first real order isn't the
// first time anyone sees the email.
export function sampleOrder(shop, now = new Date()) {
  const slug = 'dallas';
  const found = shop.availability({ productId: 'adult-tee', designId: 'this-is-our-year', slug, size: 'L' });
  return {
    id: `test_${now.getTime()}`,
    createdAt: now.toISOString(),
    status: 'test',
    shipTo: { name: 'Test Customer', line1: '1 Test Street', line2: '', city: 'New York', state: 'NY', postalCode: '10001', country: 'US' },
    lines: [
      {
        quantity: 1,
        team_id: slug,
        design_id: 'this-is-our-year',
        product_id: 'adult-tee',
        product_style: 'tee',
        audience: 'adult',
        size: 'L',
        purchase_mode: 'standard',
        artwork_version: found.design?.artworkVersion ?? 'store-v1',
        variant_key: `adult-tee:this-is-our-year:${slug}:L`,
        provider_variant_id: found.variant?.providerVariantId ?? 'unmapped',
      },
    ],
  };
}
