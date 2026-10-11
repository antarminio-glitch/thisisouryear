import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { data, realShop, fixtureShop, memoryStorage } from './fixtures.mjs';
import { applySeasonUpdate, saveSeasonUpdate, applyMetaUpdate, survivors, loadSeason, metaKey, STALE_AFTER_DAYS } from '../src/server/season.js';
import { CAMPAIGNS, defaultConfig, applyConfigUpdate, activeHero, emailBlockers, planElimination, loadEliminationInputs, dispatchElimination, cancelPending, eliminationCopy, deliveryKey, emailHash } from '../src/server/campaigns.js';
import { emailSender, unsubscribeToken, readUnsubscribeToken } from '../src/server/email.js';
import { customerIdFor } from '../src/server/orders.js';

const NOW = new Date('2026-12-20T15:00:00Z');
const SRC = 'https://example.org/standings';
const slugs = data.teams.map((t) => t.slug);
const READY_ENV = { CAMPAIGNS_LIVE: 'true', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test', EMAIL_FROM: 'This Is Our Year <hello@example.test>', EMAIL_POSTAL_ADDRESS: '1 Test St, New York, NY', UNSUBSCRIBE_SECRET: 'a-long-test-secret-value' };

// ---------- season facts
test('one loss is not an elimination', () => {
  const r = applySeasonUpdate(null, { seasonId: '2026', slug: 'chicago', result: 'loss', sourceUrl: SRC }, NOW);
  assert.equal(r.next.status, 'unknown');
  assert.equal(r.transition, null);
  assert.match(r.next.history[0].note, /Status unchanged/);
});

test('eliminated needs a reason, a source and a confirmation', () => {
  const base = { seasonId: '2026', slug: 'chicago', status: 'eliminated' };
  assert.match(applySeasonUpdate(null, base, NOW).error, /checked this against a source/);
  assert.match(applySeasonUpdate(null, { ...base, verified: true }, NOW).error, /web address/);
  assert.match(applySeasonUpdate(null, { ...base, verified: true, sourceUrl: SRC }, NOW).error, /not an elimination/);
  assert.match(applySeasonUpdate(null, { ...base, verified: true, sourceUrl: 'javascript:alert(1)', reason: 'lost_playoff_game' }, NOW).error, /web address/);
  const ok = applySeasonUpdate(null, { ...base, verified: true, sourceUrl: SRC, reason: 'mathematically_eliminated', actor: 'Anthony' }, NOW);
  assert.equal(ok.next.status, 'eliminated');
  assert.deepEqual(ok.transition, { from: 'unknown', to: 'eliminated' });
  assert.equal(ok.next.actor, 'Anthony');
  assert.equal(ok.next.sourceUrl, SRC);
});

test('season records keep a history and a version, including corrections', async () => {
  const storage = memoryStorage();
  await saveSeasonUpdate(storage, { seasonId: '2026', slug: 'chicago', status: 'active', verified: true, sourceUrl: SRC }, NOW);
  await saveSeasonUpdate(storage, { seasonId: '2026', slug: 'chicago', status: 'eliminated', reason: 'mathematically_eliminated', verified: true, sourceUrl: SRC }, NOW);
  const fixed = await saveSeasonUpdate(storage, { seasonId: '2026', slug: 'chicago', status: 'active', verified: true, sourceUrl: SRC }, NOW);
  assert.deepEqual(fixed.transition, { from: 'eliminated', to: 'active' });
  assert.equal(fixed.next.version, 3);
  assert.equal(fixed.next.history.length, 3);
  assert.equal((await saveSeasonUpdate(storage, { seasonId: 'next', slug: 'chicago', status: 'active' }, NOW)).error.includes('four-digit'), true);
});

const allActive = (over = {}) => slugs.map((slug) => ({ seasonId: '2026', slug, status: 'eliminated', verifiedAt: NOW.toISOString(), ...(over[slug] ?? {}) }));
const meta = (round, daysAgo = 1) => ({ seasonId: '2026', round, verifiedAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(), sourceUrl: SRC });

test('survivors are only named when the round and every city are confirmed and recent', () => {
  const states = allActive({ seattle: { status: 'active' }, buffalo: { status: 'active' } });
  const good = survivors({ meta: meta('divisional'), states }, slugs, NOW);
  assert.equal(good.verified, true);
  assert.deepEqual(good.slugs.sort(), ['buffalo', 'seattle']);

  assert.equal(survivors({ meta: null, states }, slugs, NOW).verified, false);
  assert.equal(survivors({ meta: meta('regular_season'), states }, slugs, NOW).verified, false);
  assert.equal(survivors({ meta: meta('divisional', STALE_AFTER_DAYS + 1), states }, slugs, NOW).verified, false, 'stale');
  assert.equal(survivors({ meta: meta('divisional'), states: states.slice(1) }, slugs, NOW).verified, false, 'a city with no record');
  const withUnknown = allActive({ seattle: { status: 'active' }, miami: { status: 'unknown' } });
  const u = survivors({ meta: meta('divisional'), states: withUnknown }, slugs, NOW);
  assert.equal(u.verified, false);
  assert.deepEqual(u.slugs, []);
});

test('the round also needs a source', () => {
  assert.match(applyMetaUpdate({ seasonId: '2026', round: 'divisional' }, NOW).error, /checked/);
  assert.equal(applyMetaUpdate({ seasonId: '2026', round: 'divisional', verified: true, sourceUrl: SRC }, NOW).next.round, 'divisional');
  assert.match(applyMetaUpdate({ seasonId: '2026', round: 'semis', verified: true, sourceUrl: SRC }, NOW).error, /Round has to be/);
});

// ---------- campaign switches
test('every campaign starts switched off', () => {
  assert.equal(CAMPAIGNS.length, 5);
  for (const c of CAMPAIGNS) assert.equal(defaultConfig(c.id).enabled, false, c.id);
  assert.equal(activeHero(CAMPAIGNS.map((c) => defaultConfig(c.id)), NOW), null);
});

test('turning a campaign on takes a typed confirmation and real dates', () => {
  const cfg = defaultConfig('week_1');
  const ctx = { env: {}, now: NOW };
  assert.match(applyConfigUpdate(cfg, { enabled: true }, ctx).error, /ACTIVATE week_1/);
  assert.match(applyConfigUpdate(cfg, { enabled: true, confirm: 'ACTIVATE week_1' }, ctx).error, /season/);
  assert.match(applyConfigUpdate(cfg, { enabled: true, confirm: 'ACTIVATE week_1', seasonId: '2027' }, ctx).error, /start and end/);
  const past = applyConfigUpdate(cfg, { enabled: true, confirm: 'ACTIVATE week_1', seasonId: '2026', startsAt: '2026-09-10T00:00:00Z', endsAt: '2026-09-15T00:00:00Z' }, ctx);
  assert.match(past.error, /already passed/);
  const ok = applyConfigUpdate(cfg, { enabled: true, confirm: 'ACTIVATE week_1', seasonId: '2027', startsAt: '2027-09-09T00:00:00Z', endsAt: '2027-09-14T00:00:00Z', actor: 'Anthony' }, ctx);
  assert.equal(ok.next.enabled, true);
  assert.equal(ok.next.activatedBy, 'Anthony');
  assert.equal(activeHero([ok.next], new Date('2027-09-10T12:00:00Z')).id, 'week_1');
  assert.equal(activeHero([ok.next], NOW), null, 'not before the window');
  assert.equal(activeHero([ok.next], new Date('2027-09-14T00:00:00Z')), null, 'not after it');
  assert.equal(applyConfigUpdate(ok.next, { enabled: false }, ctx).next.enabled, false);
});

test('the email campaign cannot be turned on until email is fully set up', () => {
  const cfg = defaultConfig('elimination');
  const ask = { enabled: true, confirm: 'ACTIVATE elimination', seasonId: '2026' };
  const blocked = applyConfigUpdate(cfg, ask, { env: {}, now: NOW });
  assert.match(blocked.error, /Email isn't set up/);
  assert.match(blocked.error, /CAMPAIGNS_LIVE/);
  assert.equal(emailBlockers({}).length >= 5, true);
  assert.deepEqual(emailBlockers(READY_ENV), []);
  assert.equal(applyConfigUpdate(cfg, ask, { env: READY_ENV, now: NOW }).next.enabled, true);
  assert.match(applyConfigUpdate(cfg, ask, { env: { ...READY_ENV, CAMPAIGNS_LIVE: 'yes' }, now: NOW }).error, /CAMPAIGNS_LIVE/);
});

// ---------- elimination follow-up
const order = (id, email, over = {}) => ({
  id, email, customerId: customerIdFor(email), createdAt: '2026-10-01T00:00:00Z', status: 'paid', marketingConsent: 'opt_in', favoriteTeamId: null,
  lines: [{ team_id: 'chicago', purchase_mode: 'standard', quantity: 1 }], ...over,
});
const eliminated = { seasonId: '2026', slug: 'chicago', status: 'eliminated', reason: 'mathematically_eliminated', verifiedAt: NOW.toISOString(), sourceUrl: SRC };
const plan = (shop, orders, extra = {}) =>
  planElimination({ shop, slug: 'chicago', seasonId: '2026', seasonState: eliminated, orders, suppressed: new Set(), deliveries: new Map(), siteUrl: 'https://thisisouryear.team', now: NOW, ...extra });

test('nothing is planned for a city that is not confirmed eliminated', () => {
  const shop = fixtureShop();
  for (const seasonState of [null, { ...eliminated, status: 'active' }, { ...eliminated, verifiedAt: null }, { ...eliminated, seasonId: '2025' }]) {
    const p = plan(shop, [order('o1', 'a@example.com')], { seasonState });
    assert.equal(p.status, 'blocked');
    assert.equal(p.recipients.length, 0);
  }
});

test('with the real catalog the campaign is held, because the follow-up shirt is not for sale', () => {
  const p = plan(realShop(), [order('o1', 'a@example.com')]);
  assert.equal(p.status, 'held');
  assert.match(p.reason, /isn't for sale/);
  assert.equal(p.recipients.length, 0);
});

test('only paid, opted-in, not-unsubscribed buyers of that colorway are eligible', () => {
  const shop = fixtureShop();
  const orders = [
    order('o1', 'yes@example.com'),
    order('o2', 'no-consent@example.com', { marketingConsent: 'opt_out' }),
    order('o3', 'unknown@example.com', { marketingConsent: 'unknown' }),
    order('o4', 'refunded@example.com', { status: 'refunded' }),
    order('o5', 'unsub@example.com'),
    order('o6', 'other-city@example.com', { lines: [{ team_id: 'miami', purchase_mode: 'standard', quantity: 1 }] }),
    order('o7', '', { customerId: null }),
    order('o8', 'changed-mind@example.com', { createdAt: '2026-09-01T00:00:00Z' }),
    order('o9', 'changed-mind@example.com', { createdAt: '2026-11-01T00:00:00Z', marketingConsent: 'opt_out', lines: [{ team_id: 'miami', purchase_mode: 'standard', quantity: 1 }] }),
  ];
  const p = plan(shop, orders, { suppressed: new Set([emailHash('unsub@example.com')]) });
  assert.equal(p.status, 'ready');
  assert.deepEqual(p.recipients.map((r) => r.email), ['yes@example.com']);
  const reasons = p.exclusions.map((e) => e.reason).join(' | ');
  assert.match(reasons, /did not ask for marketing email/);
  assert.match(reasons, /refunded or canceled/);
  assert.match(reasons, /unsubscribed/);
  assert.match(reasons, /No email address/);
  assert.ok(p.exclusions.every((e) => !/@example\.com$/.test(e.who) || e.who.includes('***')), 'emails are masked in the preview');
  assert.equal(p.exclusions.filter((e) => e.reason.includes('did not ask')).length, 3, 'a later opt-out on any order wins');
});

test('a person with two orders gets one email', () => {
  const p = plan(fixtureShop(), [order('o1', 'fan@example.com'), order('o2', 'FAN@example.com', { email: 'fan@example.com' })]);
  assert.equal(p.recipients.length, 1);
  assert.deepEqual(p.recipients[0].orderIds, ['o1', 'o2']);
});

test('gift and league buyers are never told it was their team', () => {
  const shop = fixtureShop();
  const p = plan(shop, [
    order('o1', 'self@example.com'),
    order('o2', 'gifter@example.com', { lines: [{ team_id: 'chicago', purchase_mode: 'rival_gift', recipient_team_id: 'detroit', quantity: 1 }] }),
    order('o3', 'commish@example.com', { lines: [{ team_id: 'chicago', purchase_mode: 'fantasy_punishment', quantity: 6 }] }),
    order('o4', 'detroit-fan@example.com', { favoriteTeamId: 'detroit' }),
    order('o5', 'true-fan@example.com', { favoriteTeamId: 'chicago', lines: [{ team_id: 'chicago', purchase_mode: 'matching_set', quantity: 1 }] }),
  ]);
  const seg = Object.fromEntries(p.recipients.map((r) => [r.email, r.segment]));
  assert.deepEqual(seg, { 'self@example.com': 'standard', 'gifter@example.com': 'gift', 'commish@example.com': 'gift', 'detroit-fan@example.com': 'gift', 'true-fan@example.com': 'standard' });
  assert.match(p.samples.standard.text, /There's always next year/);
  assert.match(p.samples.gift.text, /The Chicago colors you ordered/);
  assert.ok(!/your team|your city|you're a/i.test(p.samples.gift.text));
  assert.equal(p.samples.gift.subject, "Fine. Wait 'til next year.");
  assert.match(p.samples.gift.text, /Unsubscribe:/);
  assert.match(p.samples.standard.link, /\/chicago\/\?design=wait-til-next-year$/);
});

test('the price in the email comes from the real offer', () => {
  const copy = eliminationCopy({ segment: 'standard', cityName: 'Chicago', offer: { path: '/chicago/?design=wait-til-next-year', range: { lowCents: 1999, highCents: 2199 } }, siteUrl: 'https://x.test', unsubscribeUrl: 'https://x.test/u', postalAddress: '1 Test St' });
  assert.match(copy.text, /from \$19\.99/);
  const none = eliminationCopy({ segment: 'standard', cityName: 'Chicago', offer: { path: '/x', range: null }, siteUrl: 'https://x.test', unsubscribeUrl: 'u', postalAddress: 'a' });
  assert.ok(!/\$/.test(none.text));
});

async function dispatchSetup(orders, { env = READY_ENV, enabled = true, send } = {}) {
  const storage = memoryStorage();
  const shop = fixtureShop();
  for (const o of orders) await storage.store('orders').set(`order/${o.id}`, o);
  await storage.store('season').set('state/2026/chicago', eliminated);
  const sent = [];
  const sender = send ?? (async (m) => { sent.push(m); return { id: `em_${sent.length}` }; });
  const run = async () => {
    const inputs = await loadEliminationInputs(storage, { slug: 'chicago', seasonId: '2026' });
    const p = planElimination({ shop, slug: 'chicago', seasonId: '2026', siteUrl: 'https://thisisouryear.team', now: NOW, ...inputs });
    const result = await dispatchElimination({ plan: p, config: { id: 'elimination', enabled }, env, storage, shop, send: sender, siteUrl: 'https://thisisouryear.team', now: () => NOW, unsubscribeUrlFor: (e) => `https://thisisouryear.team/u?t=${unsubscribeToken(e, READY_ENV.UNSUBSCRIBE_SECRET)}` });
    return { plan: p, result };
  };
  return { storage, shop, sent, run };
}

test('by default nothing is sent: campaign off, or email not set up', async () => {
  const off = await dispatchSetup([order('o1', 'a@example.com')], { enabled: false });
  const r1 = await off.run();
  assert.equal(r1.result.sent, 0);
  assert.match(r1.result.blocked, /switched off/);
  assert.equal(off.sent.length, 0);

  const noEmail = await dispatchSetup([order('o1', 'a@example.com')], { env: {} });
  const r2 = await noEmail.run();
  assert.equal(r2.result.sent, 0);
  assert.match(r2.result.blocked, /Email isn't set up/);
  assert.equal(noEmail.sent.length, 0);
  assert.deepEqual(await noEmail.storage.store('deliveries').list(''), [], 'no delivery record is invented');
});

test('running the send twice does not email anyone twice', async () => {
  const s = await dispatchSetup([order('o1', 'a@example.com'), order('o2', 'b@example.com')]);
  const first = await s.run();
  assert.equal(first.result.sent, 2);
  const second = await s.run();
  assert.equal(second.result.sent, 0);
  assert.equal(second.plan.recipients.length, 0);
  assert.equal(second.plan.exclusions.filter((e) => e.reason === 'Already sent.').length, 2);
  assert.equal(s.sent.length, 2);
  assert.equal(new Set(s.sent.map((m) => m.idempotencyKey)).size, 2);
  assert.match(s.sent[0].unsubscribeUrl, /\/u\?t=/);
});

test('two sends racing each other still produce one email per person', async () => {
  const s = await dispatchSetup([order('o1', 'a@example.com')]);
  const [a, b] = await Promise.all([s.run(), s.run()]);
  assert.equal(a.result.sent + b.result.sent, 1);
  assert.equal(s.sent.length, 1);
});

test('a failed send can be retried, and uses the same key so the service will not double up', async () => {
  let calls = 0;
  const keys = [];
  const flaky = async (m) => { keys.push(m.idempotencyKey); if (++calls === 1) throw new Error('service down'); return { id: 'em_ok' }; };
  const s = await dispatchSetup([order('o1', 'a@example.com')], { send: flaky });
  assert.equal((await s.run()).result.failed, 1);
  const retry = await s.run();
  assert.equal(retry.plan.recipients[0].retry, true);
  assert.equal(retry.result.sent, 1);
  assert.equal(keys[0], keys[1]);
  const key = deliveryKey({ customerId: customerIdFor('a@example.com'), seasonId: '2026', slug: 'chicago', campaignId: 'elimination' });
  assert.equal((await s.storage.store('deliveries').get(key)).status, 'sent');
});

test('correcting the season record cancels sends that have not gone out', async () => {
  const s = await dispatchSetup([order('o1', 'a@example.com')], { send: async () => { throw new Error('down'); } });
  await s.run();
  assert.equal(await cancelPending(s.storage, { slug: 'chicago', seasonId: '2026', now: () => NOW }), 1);
  const after = await s.run();
  assert.equal(after.plan.recipients.length, 0);
  assert.match(after.plan.exclusions[0].reason, /Canceled after a correction/);
});

// ---------- email plumbing
test('unsubscribe links are signed and cannot be forged or altered', () => {
  const secret = READY_ENV.UNSUBSCRIBE_SECRET;
  const token = unsubscribeToken('Fan@Example.com', secret);
  assert.equal(readUnsubscribeToken(token, secret), 'fan@example.com');
  assert.equal(readUnsubscribeToken(token, 'another-secret-entirely'), null);
  assert.equal(readUnsubscribeToken(token.replace(/^./, 'X'), secret), null);
  assert.equal(readUnsubscribeToken('garbage', secret), null);
  assert.equal(readUnsubscribeToken(token, ''), null);
});

test('no email service configured means no sender at all', () => {
  assert.equal(emailSender({}), null);
  assert.equal(emailSender({ EMAIL_PROVIDER: 'resend' }), null);
  assert.equal(emailSender({ EMAIL_PROVIDER: 'carrier-pigeon', RESEND_API_KEY: 'x', EMAIL_FROM: 'y' }), null);
});

test('the email adapter sends the right request to the service (stand-in server)', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, key: req.headers['idempotency-key'], body: JSON.parse(body) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'em_123' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const send = emailSender({ ...READY_ENV, RESEND_API_BASE: `http://127.0.0.1:${server.address().port}` });
    const out = await send({ to: 'a@example.com', subject: 'S', text: 'T', unsubscribeUrl: 'https://x.test/u', idempotencyKey: 'k-1' });
    assert.equal(out.id, 'em_123');
    assert.equal(seen[0].url, '/emails');
    assert.equal(seen[0].auth, 'Bearer re_test');
    assert.equal(seen[0].key, 'k-1');
    assert.deepEqual(seen[0].body.to, ['a@example.com']);
    assert.equal(seen[0].body.headers['List-Unsubscribe'], '<https://x.test/u>');
  } finally {
    server.close();
  }
});
