// Seasonal campaigns: what they are, who would get an email, and the rules
// that keep anything from going out by accident.
//
// Everything starts switched off. A campaign only does something after a
// person turns it on in the admin screen. Email only goes out when, on top of
// that, an email service is fully set up and CAMPAIGNS_LIVE is "true". Until
// then every run is a dry run: it shows who would get what and sends nothing.
import { readAll } from './storage.js';
import { sha256 } from './http.js';
import { dollars } from '../lib/shop-core.js';

export const CAMPAIGNS = [
  {
    id: 'schedule_release',
    name: 'Schedule release',
    kind: 'window',
    sendsEmail: false,
    designId: 'this-is-our-year',
    needs: 'The real start and end of the window for that season.',
    heroTitle: 'The schedule is out.',
    heroLine: 'Circle the dates. Order the shirt. Start talking.',
  },
  {
    id: 'week_1',
    name: 'Week 1',
    kind: 'window',
    sendsEmail: false,
    designId: 'this-is-our-year',
    needs: 'The real start and end of opening week for that season.',
    heroTitle: 'Week 1. Everybody is undefeated.',
    heroLine: 'Say it now, while it is still technically true.',
  },
  {
    id: 'elimination',
    name: 'Elimination follow-up',
    kind: 'event',
    sendsEmail: true,
    designId: 'wait-til-next-year',
    needs: 'A city confirmed as eliminated, and the follow-up design for sale.',
  },
  {
    id: 'playoff_bandwagon',
    name: 'Playoff bandwagon',
    kind: 'state',
    sendsEmail: false,
    designId: 'this-is-our-year',
    needs: 'A confirmed playoff round and a confirmed status for every city.',
    heroTitle: 'Still alive.',
    heroLine: 'Room on the bandwagon. Pick a survivor.',
  },
  {
    id: 'win_sharing',
    name: 'Wins and fan sharing',
    kind: 'event',
    sendsEmail: false,
    designId: 'this-is-our-year',
    needs: 'A confirmed win, or a fan photo you choose to feature.',
  },
];

export const campaignById = (id) => CAMPAIGNS.find((c) => c.id === id);

const SEASON = /^\d{4}$/;
const validDate = (v) => typeof v === 'string' && !Number.isNaN(new Date(v).getTime());

export function defaultConfig(id) {
  return { id, enabled: false, seasonId: null, startsAt: null, endsAt: null, activatedAt: null, activatedBy: null, updatedAt: null };
}

export async function loadConfigs(storage) {
  const saved = await readAll(storage.store('campaigns'), 'config/');
  return CAMPAIGNS.map((c) => ({ ...defaultConfig(c.id), ...(saved.find((s) => s.id === c.id) ?? {}) }));
}

// What is missing before email could really go out. Empty means ready.
export function emailBlockers(env) {
  const missing = [];
  if (env.CAMPAIGNS_LIVE !== 'true') missing.push('CAMPAIGNS_LIVE is not "true"');
  if (!env.EMAIL_PROVIDER) missing.push('EMAIL_PROVIDER is not set');
  if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) missing.push('RESEND_API_KEY is not set');
  if (env.EMAIL_PROVIDER && env.EMAIL_PROVIDER !== 'resend') missing.push(`EMAIL_PROVIDER "${env.EMAIL_PROVIDER}" is not one this site knows`);
  if (!env.EMAIL_FROM) missing.push('EMAIL_FROM is not set');
  if (!env.EMAIL_POSTAL_ADDRESS) missing.push('EMAIL_POSTAL_ADDRESS is not set (marketing email must show a mailing address)');
  if (!env.UNSUBSCRIBE_SECRET || env.UNSUBSCRIBE_SECRET.length < 16) missing.push('UNSUBSCRIBE_SECRET is not set (16 characters or more)');
  return missing;
}

// Checks a change to a campaign's settings. Turning one on takes a typed
// confirmation, so it can't happen with a stray click.
export function applyConfigUpdate(current, update, { env, now }) {
  const def = campaignById(current.id);
  if (!def) return { error: 'No such campaign.' };
  const next = { ...current, updatedAt: now.toISOString() };

  if ('seasonId' in update) {
    if (update.seasonId !== null && !SEASON.test(String(update.seasonId))) return { error: 'Season has to be a four-digit year, like 2026.' };
    next.seasonId = update.seasonId === null ? null : String(update.seasonId);
  }
  for (const k of ['startsAt', 'endsAt']) {
    if (k in update) {
      if (update[k] !== null && !validDate(update[k])) return { error: 'Dates have to be real dates and times.' };
      next[k] = update[k] === null ? null : new Date(update[k]).toISOString();
    }
  }
  if (next.startsAt && next.endsAt && next.endsAt <= next.startsAt) return { error: 'The end has to be after the start.' };

  if (update.enabled === false) {
    next.enabled = false;
    next.activatedAt = null;
    next.activatedBy = null;
  }
  if (update.enabled === true) {
    if (update.confirm !== `ACTIVATE ${current.id}`) return { error: `To turn this on, type exactly: ACTIVATE ${current.id}` };
    if (!next.seasonId) return { error: 'Set the season first.' };
    if (def.kind === 'window') {
      if (!next.startsAt || !next.endsAt) return { error: 'Set the real start and end of the window first. Last year\'s dates don\'t count.' };
      if (new Date(next.endsAt) <= now) return { error: 'That window has already passed, so it can\'t be scheduled as upcoming.' };
    }
    if (def.sendsEmail) {
      const blockers = emailBlockers(env);
      if (blockers.length) return { error: `Email isn't set up, so this campaign can't be turned on: ${blockers.join('; ')}.` };
    }
    next.enabled = true;
    next.activatedAt = now.toISOString();
    next.activatedBy = String(update.actor ?? '').trim().slice(0, 60) || 'owner';
  }
  return { next };
}

// The message at the top of the home page, if a window campaign is running
// right now. Null the rest of the time.
export function activeHero(configs, now) {
  for (const def of CAMPAIGNS) {
    if (def.kind !== 'window') continue;
    const c = configs.find((x) => x.id === def.id);
    if (!c?.enabled || !c.startsAt || !c.endsAt) continue;
    if (new Date(c.startsAt) <= now && now < new Date(c.endsAt)) return { id: def.id, heroTitle: def.heroTitle, heroLine: def.heroLine };
  }
  return null;
}

// ---------- elimination follow-up ----------

// A send that was claimed but never finished (the server stopped mid-way) can
// be picked up again after this long. The email service gets the same key, so
// it still won't send twice.
export const STUCK_AFTER_MS = 15 * 60 * 1000;
const isStuck = (d, now) => d?.status === 'sending' && now.getTime() - new Date(d.claimedAt ?? 0).getTime() > STUCK_AFTER_MS;

export const deliveryKey = ({ customerId, seasonId, slug, campaignId }) => `delivery/${campaignId}/${seasonId}/${slug}/${customerId}`;
export const emailHash = (email) => sha256(String(email).trim().toLowerCase());
const maskEmail = (email) => String(email).replace(/^(.).*(@.*)$/, '$1***$2');

// Is there anything to actually buy in the follow-up design, in this city?
function followUpOffer(shop, slug, designId) {
  for (const p of shop.catalog.products) {
    if (!shop.isSellable(p) || p.audience !== 'adult') continue;
    const size = p.variants.find((v) => v.inStock)?.size;
    if (!size) continue;
    const found = shop.availability({ productId: p.id, designId, slug, size });
    if (found.ok) return { product: p, range: shop.priceRange(p.id), path: `/${slug}/?design=${designId}${p.style === 'tee' ? '' : `&style=${p.style}`}` };
  }
  return null;
}

// The words. Drafts, editable here. The gift version never assumes the
// buyer supports the city whose colors they bought.
export function eliminationCopy({ segment, cityName, offer, siteUrl, unsubscribeUrl, postalAddress }) {
  const link = `${siteUrl}${offer.path}`;
  const price = offer.range ? (offer.range.lowCents === offer.range.highCents ? dollars(offer.range.lowCents) : `from ${dollars(offer.range.lowCents)}`) : '';
  const lead =
    segment === 'standard'
      ? "There's always next year. Same colors. Revised timeline."
      : `The ${cityName} colors you ordered have a revised timeline. Same colors. Next year.`;
  const text = [
    lead,
    '',
    `The follow-up shirt says "Wait 'Til Next Year" in ${cityName} colors${price ? `, ${price}` : ''}.`,
    `Shop next year's optimism: ${link}`,
    '',
    "You're getting this because you asked for emails when you checked out.",
    `Unsubscribe: ${unsubscribeUrl}`,
    postalAddress,
  ].join('\n');
  return { subject: "Fine. Wait 'til next year.", text, cta: "Shop next year's optimism", link };
}

// Works out who would get the elimination email for one city, and who
// wouldn't and why. Saves nothing and sends nothing.
export function planElimination({ shop, slug, seasonId, seasonState, orders, suppressed, deliveries, siteUrl, now = new Date() }) {
  const def = campaignById('elimination');
  const city = shop.city(slug);
  const plan = { campaignId: def.id, slug, seasonId: String(seasonId), status: 'ready', reason: '', recipients: [], exclusions: [], samples: {}, offer: null };
  const hold = (status, reason) => Object.assign(plan, { status, reason });

  if (!city) return hold('blocked', 'No such city.');
  // 1. Only a confirmed elimination starts this. A loss alone never does.
  if (seasonState?.status !== 'eliminated' || !seasonState.verifiedAt || String(seasonState.seasonId) !== String(seasonId)) {
    return hold('blocked', `${city.name} is not confirmed as eliminated for ${seasonId}.`);
  }
  // 4. No dead links: the follow-up shirt has to be for sale first.
  const offer = followUpOffer(shop, slug, def.designId);
  if (!offer) return hold('held', `Held: the "Wait 'Til Next Year" design isn't for sale in ${city.name} colors yet, so there's nothing to link to.`);
  plan.offer = { path: offer.path, productId: offer.product.id, range: offer.range };

  // 2. Paid orders with that colorway. A person's most recent answer about
  // email, on any order, is the one that counts.
  const sorted = [...orders].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const latestConsent = new Map();
  for (const o of sorted) if (o.customerId && o.marketingConsent && o.marketingConsent !== 'unknown') latestConsent.set(o.customerId, o.marketingConsent);

  const byCustomer = new Map();
  for (const o of sorted) {
    const lines = (o.lines ?? []).filter((l) => l.team_id === slug);
    if (!lines.length) continue;
    if (!o.email || !o.customerId) {
      plan.exclusions.push({ who: o.id, reason: 'No email address on the order.' });
      continue;
    }
    const c = byCustomer.get(o.customerId) ?? { customerId: o.customerId, email: o.email, orderIds: [], modes: new Set(), paid: false, consent: 'unknown', favorite: null };
    if (o.status === 'paid') {
      c.paid = true;
      c.orderIds.push(o.id);
      for (const l of lines) c.modes.add(l.purchase_mode ?? 'standard');
    }
    c.consent = latestConsent.get(o.customerId) ?? 'unknown';
    if (o.favoriteTeamId) c.favorite = o.favoriteTeamId;
    byCustomer.set(o.customerId, c);
  }

  for (const c of byCustomer.values()) {
    const out = (reason) => plan.exclusions.push({ who: maskEmail(c.email), reason });
    if (!c.paid) {
      out('Their order was refunded or canceled.');
      continue;
    }
    if (c.consent !== 'opt_in') {
      out('They did not ask for marketing email.');
      continue;
    }
    if (suppressed.has(emailHash(c.email))) {
      out('They unsubscribed.');
      continue;
    }
    // 6. One email per person, per season, per city, per campaign. Ever.
    const key = deliveryKey({ customerId: c.customerId, seasonId, slug, campaignId: def.id });
    const prior = deliveries.get(key);
    if (prior?.status === 'sent') {
      out('Already sent.');
      continue;
    }
    if (prior?.status === 'sending' && !isStuck(prior, now)) {
      out('A send is already in progress.');
      continue;
    }
    if (prior?.status === 'canceled') {
      out('Canceled after a correction to the season record.');
      continue;
    }
    // 3. Who is this person to the colors they bought? Only "standard" if
    // they bought them for themselves, or told us it's their city.
    const forSelf = c.favorite ? c.favorite === slug : c.modes.has('standard');
    plan.recipients.push({ customerId: c.customerId, email: c.email, segment: forSelf ? 'standard' : 'gift', orderIds: c.orderIds, key, retry: prior?.status === 'failed' || isStuck(prior, now) });
  }

  for (const segment of ['standard', 'gift']) {
    plan.samples[segment] = eliminationCopy({ segment, cityName: city.name, offer, siteUrl, unsubscribeUrl: `${siteUrl}/.netlify/functions/unsubscribe?t=(their own link)`, postalAddress: '(your mailing address)' });
  }
  if (!plan.recipients.length) plan.reason = 'Nobody is eligible right now.';
  return plan;
}

// Gathers what planElimination needs from storage.
export async function loadEliminationInputs(storage, { slug, seasonId }) {
  const [orders, suppressions, deliveries, seasonState] = await Promise.all([
    readAll(storage.store('orders'), 'order/'),
    storage.store('suppressions').list('email/'),
    readAll(storage.store('deliveries'), `delivery/elimination/${seasonId}/${slug}/`),
    storage.store('season').get(`state/${seasonId}/${slug}`),
  ]);
  return {
    orders,
    suppressed: new Set(suppressions.map((k) => k.replace('email/', ''))),
    deliveries: new Map(deliveries.map((d) => [d.key, d])),
    seasonState,
  };
}

// Actually sends. Refuses unless the campaign is on and email is fully set
// up. Safe to run twice: each person's send is claimed first, so a retry or
// a second click can't email anyone again.
export async function dispatchElimination({ plan, config, env, storage, shop, send, unsubscribeUrlFor, siteUrl, now }) {
  const blockers = emailBlockers(env);
  if (!config?.enabled) return { sent: 0, failed: 0, skipped: plan.recipients.length, blocked: 'This campaign is switched off.' };
  if (blockers.length) return { sent: 0, failed: 0, skipped: plan.recipients.length, blocked: `Email isn't set up: ${blockers.join('; ')}.` };
  if (plan.status !== 'ready') return { sent: 0, failed: 0, skipped: plan.recipients.length, blocked: plan.reason };

  const store = storage.store('deliveries');
  const city = shop.city(plan.slug);
  const offer = { path: plan.offer.path, range: plan.offer.range };
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const r of plan.recipients) {
    const claim = { key: r.key, campaignId: plan.campaignId, seasonId: plan.seasonId, slug: plan.slug, customerId: r.customerId, segment: r.segment, status: 'sending', claimedAt: now().toISOString() };
    let mine = await store.setIfNew(r.key, claim);
    if (!mine) {
      // Someone got here first, unless the earlier try failed and this is a retry.
      const prior = await store.get(r.key);
      if (prior?.status === 'failed' || isStuck(prior, now())) {
        await store.set(r.key, { ...claim, attempts: (prior.attempts ?? 1) + 1 });
        mine = true;
      }
    }
    if (!mine) {
      skipped++;
      continue;
    }
    const copy = eliminationCopy({ segment: r.segment, cityName: city.name, offer, siteUrl, unsubscribeUrl: unsubscribeUrlFor(r.email), postalAddress: env.EMAIL_POSTAL_ADDRESS });
    try {
      // The key is also passed to the email service, so even a crash between
      // "sent" and "recorded" can't produce a second email.
      const result = await send({ to: r.email, subject: copy.subject, text: copy.text, unsubscribeUrl: unsubscribeUrlFor(r.email), idempotencyKey: sha256(r.key) });
      await store.set(r.key, { ...claim, status: 'sent', sentAt: now().toISOString(), providerId: result?.id ?? null });
      sent++;
    } catch (err) {
      await store.set(r.key, { ...claim, status: 'failed', failedAt: now().toISOString(), error: String(err?.message ?? err).slice(0, 200) });
      failed++;
    }
  }
  return { sent, failed, skipped, blocked: '' };
}

// If the season record is corrected before anything went out, cancel what was
// pending so it never sends.
export async function cancelPending(storage, { slug, seasonId, now }) {
  const store = storage.store('deliveries');
  const keys = await store.list(`delivery/elimination/${seasonId}/${slug}/`);
  let canceled = 0;
  for (const key of keys) {
    const d = await store.get(key);
    if (d && d.status !== 'sent') {
      await store.set(key, { ...d, status: 'canceled', canceledAt: now().toISOString() });
      canceled++;
    }
  }
  return canceled;
}

// If the city is confirmed as eliminated again after a correction, cleared
// cancellations let the campaign run after all.
export async function reopenCanceled(storage, { slug, seasonId }) {
  const store = storage.store('deliveries');
  for (const key of await store.list(`delivery/elimination/${seasonId}/${slug}/`)) {
    const d = await store.get(key);
    if (d?.status === 'canceled') await store.delete(key);
  }
}
