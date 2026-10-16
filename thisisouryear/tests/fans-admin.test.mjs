import test from 'node:test';
import assert from 'node:assert/strict';
import { data, realShop, fixtureShop, memoryStorage, post } from './fixtures.mjs';
import { makeFanSubmitHandler, makeFansHandler, moderate } from '../src/server/fans.js';
import { makeAdminHandler, makePublicStateHandler, makeUnsubscribeHandler, setupReport, defaultSeasonId } from '../src/server/admin.js';
import { unsubscribeToken } from '../src/server/email.js';
import { emailHash } from '../src/server/campaigns.js';
import { customerIdFor } from '../src/server/orders.js';

const NOW = new Date('2026-12-20T15:00:00Z');
const now = () => NOW;
// The smallest thing that passes as a JPEG: the right first bytes, then padding.
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 1)]).toString('base64');
const submission = (over = {}) => ({ slug: 'buffalo', caption: 'Table for one', displayName: 'Dee', permission: true, repost: true, imageType: 'image/jpeg', imageBase64: jpeg, ...over });

function fanSetup() {
  const storage = memoryStorage();
  const shop = realShop();
  const getStorage = async () => storage;
  return { storage, submit: makeFanSubmitHandler({ shop, getStorage, now }), fans: makeFansHandler({ shop, getStorage }) };
}
const list = async (fans, q = '') => (await (await fans(new Request(`https://example.test/fans${q}`))).json()).photos;
const photo = (fans, id) => fans(new Request(`https://example.test/fans?photo=${id}`));

test('a new photo is saved as pending and is not public', async () => {
  const { storage, submit, fans } = fanSetup();
  const res = await submit(post(submission()));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.match(body.reference, /^F-/);
  assert.match(body.removalCode, /^R-/);
  const saved = await storage.store('fans').get(`sub/${body.reference}`);
  assert.equal(saved.status, 'pending');
  assert.equal(saved.permission.display, true);
  assert.equal(saved.removalCodeHash.includes(body.removalCode), false, 'the removal code is not stored in the clear');
  assert.deepEqual(await list(fans), []);
  assert.equal((await photo(fans, body.reference)).status, 404);
});

test('permission is required, and uploads are checked', async () => {
  const { storage, submit } = fanSetup();
  const tries = [
    [submission({ permission: false }), 400],
    [submission({ permission: 'yes' }), 400],
    [submission({ slug: 'nowhere' }), 400],
    [submission({ caption: 'x'.repeat(141) }), 400],
    [submission({ imageType: 'image/svg+xml' }), 400],
    [submission({ imageType: 'image/png' }), 400], // says PNG, bytes are JPEG
    [submission({ imageBase64: Buffer.from('<script>alert(1)</script>'.repeat(10)).toString('base64') }), 400],
    [submission({ website: 'http://spam.example' }), 400],
  ];
  for (const [body, status] of tries) assert.equal((await submit(post(body))).status, status, JSON.stringify(Object.keys(body)));
  const big = submission({ imageBase64: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4 * 1024 * 1024 + 10, 1)]).toString('base64') });
  assert.equal((await submit(post(big))).status, 413);
  assert.deepEqual(await storage.store('fans').list(''), []);
});

test('only approved photos with display permission appear, and removal takes them down', async () => {
  const { storage, submit, fans } = fanSetup();
  const a = await (await submit(post(submission()))).json();
  const b = await (await submit(post(submission({ slug: 'miami', caption: 'Sunburned' })))).json();

  assert.equal((await moderate(storage, { id: a.reference, action: 'approve' }, NOW)).record.status, 'approved');
  await moderate(storage, { id: b.reference, action: 'reject' }, NOW);
  const visible = await list(fans);
  assert.deepEqual(visible.map((p) => p.id), [a.reference]);
  assert.equal(visible[0].cityName, 'Buffalo');
  assert.equal((await photo(fans, a.reference)).status, 200);
  assert.equal((await photo(fans, a.reference)).headers.get('content-type'), 'image/jpeg');
  assert.equal((await photo(fans, b.reference)).status, 404);
  assert.deepEqual(await list(fans, '?city=miami'), []);

  await moderate(storage, { id: a.reference, action: 'remove' }, NOW);
  assert.deepEqual(await list(fans), []);
  assert.equal((await photo(fans, a.reference)).status, 404);
  assert.equal(await storage.store('fan-photos').getBinary(`photo/${a.reference}`), null, 'the picture itself is deleted');
  assert.match((await moderate(storage, { id: a.reference, action: 'approve' }, NOW)).error, /taken down/);
});

test('a fan can withdraw their own photo with the removal code, and nobody else can', async () => {
  const { storage, submit, fans } = fanSetup();
  const a = await (await submit(post(submission()))).json();
  await moderate(storage, { id: a.reference, action: 'approve' }, NOW);
  assert.equal((await submit(post({ action: 'withdraw', reference: a.reference, removalCode: 'R-WRONGCOD' }))).status, 404);
  assert.equal((await list(fans)).length, 1);
  assert.equal((await submit(post({ action: 'withdraw', reference: a.reference.toLowerCase(), removalCode: a.removalCode }))).status, 200);
  assert.deepEqual(await list(fans), []);
  assert.equal((await storage.store('fans').get(`sub/${a.reference}`)).status, 'withdrawn');
});

test('reposting needs its own permission and an approved photo', async () => {
  const { storage, submit } = fanSetup();
  const yes = await (await submit(post(submission()))).json();
  const no = await (await submit(post(submission({ repost: false })))).json();
  assert.match((await moderate(storage, { id: yes.reference, action: 'queue_repost' }, NOW)).error, /Only approved/);
  await moderate(storage, { id: yes.reference, action: 'approve' }, NOW);
  await moderate(storage, { id: no.reference, action: 'approve' }, NOW);
  assert.equal((await moderate(storage, { id: yes.reference, action: 'queue_repost' }, NOW)).record.repost.queued, true);
  assert.match((await moderate(storage, { id: no.reference, action: 'queue_repost' }, NOW)).error, /not to reposting/);
  const done = await moderate(storage, { id: yes.reference, action: 'mark_reposted' }, NOW);
  assert.equal(done.record.repost.done, true);
  assert.equal(done.record.repost.queued, false);
});

test('if a photo cannot be saved the fan is told, not shown a fake success', async () => {
  const submit = makeFanSubmitHandler({ shop: realShop(), getStorage: async () => { throw new Error('down'); }, now });
  const res = await submit(post(submission()));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).saved, false);
});

// ---------- admin
const TOKEN = 'correct-horse-battery-staple';
function adminSetup(env = {}, shop = realShop()) {
  const storage = memoryStorage();
  const handler = makeAdminHandler({ shop, palettes: data.palettes, history: data.history, env: { ADMIN_TOKEN: TOKEN, ...env }, getStorage: async () => storage, now });
  const call = async (body, token = TOKEN) => {
    const res = await handler(post(body, 'https://example.test/.netlify/functions/admin', token ? { Authorization: `Bearer ${token}` } : {}));
    return { status: res.status, body: await res.json() };
  };
  return { storage, call };
}

test('the admin endpoint is closed without the password, and off without one configured', async () => {
  const { call } = adminSetup();
  assert.equal((await call({ action: 'status' }, null)).status, 401);
  assert.equal((await call({ action: 'status' }, 'wrong')).status, 401);
  assert.equal((await call({ action: 'status' })).status, 200);
  const off = makeAdminHandler({ shop: realShop(), palettes: data.palettes, history: data.history, env: {}, getStorage: async () => memoryStorage(), now });
  assert.equal((await off(post({ action: 'status' }, 'https://example.test/x', { Authorization: 'Bearer anything' }))).status, 503);
  const short = makeAdminHandler({ shop: realShop(), palettes: data.palettes, history: data.history, env: { ADMIN_TOKEN: 'short' }, getStorage: async () => memoryStorage(), now });
  assert.equal((await short(post({ action: 'status' }, 'https://example.test/x', { Authorization: 'Bearer short' }))).status, 503);
});

test('the setup report says exactly what is missing and never shows a secret', async () => {
  const { call } = adminSetup({ STRIPE_SECRET_KEY: 'sk_test_abc123secret' });
  const { body } = await call({ action: 'status' });
  assert.equal(body.stripe.mode, 'test');
  assert.equal(body.stripe.webhook, false);
  assert.ok(!JSON.stringify(body).includes('abc123secret'));
  assert.ok(!JSON.stringify(body).includes(TOKEN));
  const names = body.missing.map((m) => m.name);
  for (const n of ['STRIPE_WEBHOOK_SECRET', 'BUILD_HOOK_URL', 'catalog.json > kids-hoodie', 'store.json > collectMarketingConsent', 'CAMPAIGNS_LIVE', 'EMAIL_PROVIDER', 'Analytics']) {
    assert.ok(names.includes(n), `missing list should name ${n}`);
  }
  assert.deepEqual(body.products.map((p) => [p.id, p.sellable]), [['adult-tee', true], ['adult-hoodie', true], ['kids-tee', true], ['kids-hoodie', false]]);
  assert.equal(body.email.ready, false);
  assert.equal(body.colors.vendorApprovedCities, 0);
  assert.equal(body.colors.customSurfaces.length, 4);
  assert.equal(body.history.needsRefresh, false);
  assert.equal(body.counts.orders, 0);
});

test('season updates go through the admin endpoint with the same rules', async () => {
  const { call } = adminSetup();
  const bad = await call({ action: 'season.update', seasonId: '2026', slug: 'chicago', status: 'eliminated' });
  assert.equal(bad.status, 400);
  const ok = await call({ action: 'season.update', seasonId: '2026', slug: 'chicago', status: 'eliminated', reason: 'lost_playoff_game', verified: true, sourceUrl: 'https://example.org/x', actor: 'Anthony' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.state.status, 'eliminated');
  const got = await call({ action: 'season.get', seasonId: '2026' });
  assert.equal(got.body.states.length, 1);
  assert.equal(got.body.survivors.verified, false);
  assert.equal((await call({ action: 'season.update', seasonId: '2026', slug: 'atlantis', status: 'active' })).status, 400);
});

test('the dry-run preview shows counts, exclusions and sample copy, and sends nothing', async () => {
  const { storage, call } = adminSetup({}, fixtureShop());
  await storage.store('season').set('state/2026/chicago', { seasonId: '2026', slug: 'chicago', status: 'eliminated', verifiedAt: NOW.toISOString() });
  const o = (id, email, over = {}) => ({ id, email, customerId: customerIdFor(email), createdAt: '2026-10-01T00:00:00Z', status: 'paid', marketingConsent: 'opt_in', lines: [{ team_id: 'chicago', purchase_mode: 'standard', quantity: 1 }], ...over });
  await storage.store('orders').set('order/1', o('1', 'a@example.com'));
  await storage.store('orders').set('order/2', o('2', 'b@example.com', { marketingConsent: 'opt_out' }));
  const { status, body } = await call({ action: 'campaigns.preview', slug: 'chicago', seasonId: '2026' });
  assert.equal(status, 200);
  assert.equal(body.dryRun, true);
  assert.equal(body.recipientCount, 1);
  assert.equal(body.exclusions.length, 1);
  assert.match(body.samples.standard.subject, /next year/);
  assert.match(body.productLink, /\/chicago\/\?design=wait-til-next-year$/);
  assert.equal(body.campaignEnabled, false);
  assert.ok(body.emailBlockers.length > 0);
  assert.deepEqual(await storage.store('deliveries').list(''), []);

  const send = await call({ action: 'campaigns.send', slug: 'chicago', seasonId: '2026', confirm: 'SEND elimination chicago' });
  assert.equal(send.status, 409);
  assert.match(send.body.error, /No email service/);
  assert.deepEqual(await storage.store('deliveries').list(''), []);
  assert.equal((await call({ action: 'campaigns.send', slug: 'chicago', seasonId: '2026' })).status, 400, 'needs the typed confirmation');
});

test('campaigns cannot be switched on through the admin endpoint without the confirmation', async () => {
  const { call } = adminSetup();
  const list = await call({ action: 'campaigns.get' });
  assert.equal(list.body.configs.length, 5);
  assert.ok(list.body.configs.every((c) => c.enabled === false));
  assert.equal((await call({ action: 'campaigns.update', id: 'week_1', enabled: true })).status, 400);
  assert.equal((await call({ action: 'campaigns.update', id: 'elimination', enabled: true, confirm: 'ACTIVATE elimination', seasonId: '2026' })).status, 400);
  assert.ok((await call({ action: 'campaigns.get' })).body.configs.every((c) => c.enabled === false));
});

test('quotes and fan photos can be worked from the admin endpoint, and changes are logged', async () => {
  const { storage, call } = adminSetup();
  await storage.store('quotes').set('quote/Q-TEST1234', { reference: 'Q-TEST1234', status: 'new', createdAt: NOW.toISOString(), email: 'c@example.com', rows: [] });
  assert.equal((await call({ action: 'quotes.list' })).body.quotes.length, 1);
  assert.equal((await call({ action: 'quotes.update', reference: 'Q-TEST1234', status: 'answered', ownerNote: 'Emailed' })).body.quote.status, 'answered');
  assert.equal((await call({ action: 'quotes.update', reference: 'Q-TEST1234', status: 'bogus' })).status, 400);

  const submit = makeFanSubmitHandler({ shop: realShop(), getStorage: async () => storage, now });
  const ref = (await (await submit(post(submission()))).json()).reference;
  const listed = (await call({ action: 'fans.list' })).body.submissions;
  assert.equal(listed[0].status, 'pending');
  assert.equal(listed[0].removalCodeHash, undefined, 'the removal code hash is not sent to the browser');
  assert.equal((await call({ action: 'fans.photo', id: ref })).body.type, 'image/jpeg');
  assert.equal((await call({ action: 'fans.moderate', id: ref, do: 'approve' })).body.submission.status, 'approved');
  const log = await storage.store('audit').list('log/');
  assert.ok(log.length >= 2);
});

// ---------- public state
test('with nothing set up, the site is told nothing', async () => {
  const state = makePublicStateHandler({ shop: realShop(), getStorage: async () => memoryStorage(), now });
  const body = await (await state(new Request('https://example.test/x'))).json();
  assert.deepEqual(body, { campaign: null, bandwagon: { verified: false, slugs: [] } });
  const broken = makePublicStateHandler({ shop: realShop(), getStorage: async () => { throw new Error('down'); }, now });
  assert.deepEqual(await (await broken(new Request('https://example.test/x'))).json(), { campaign: null, bandwagon: { verified: false, slugs: [] } });
});

test('survivors are published only when the bandwagon campaign is on and the picture is confirmed', async () => {
  const storage = memoryStorage();
  const slugs = data.teams.map((t) => t.slug);
  for (const slug of slugs) await storage.store('season').set(`state/2026/${slug}`, { seasonId: '2026', slug, status: slug === 'seattle' ? 'active' : 'eliminated', verifiedAt: NOW.toISOString() });
  await storage.store('season').set('meta/2026', { seasonId: '2026', round: 'conference', verifiedAt: NOW.toISOString() });
  const state = makePublicStateHandler({ shop: realShop(), getStorage: async () => storage, now });
  const before = await (await state(new Request('https://example.test/x'))).json();
  assert.equal(before.bandwagon.verified, false, 'facts alone are not enough, the campaign must be on');
  await storage.store('campaigns').set('config/playoff_bandwagon', { id: 'playoff_bandwagon', enabled: true, seasonId: '2026' });
  const after = await (await state(new Request('https://example.test/x'))).json();
  assert.equal(after.bandwagon.verified, true);
  assert.deepEqual(after.bandwagon.slugs, ['seattle']);
  const later = makePublicStateHandler({ shop: realShop(), getStorage: async () => storage, now: () => new Date('2027-01-15T00:00:00Z') });
  assert.equal((await (await later(new Request('https://example.test/x'))).json()).bandwagon.verified, false, 'stale after a while');
});

// ---------- unsubscribe
test('opening an unsubscribe link shows a button, and pressing it unsubscribes', async () => {
  const storage = memoryStorage();
  const secret = 'a-long-test-secret-value';
  const handler = makeUnsubscribeHandler({ env: { UNSUBSCRIBE_SECRET: secret }, getStorage: async () => storage, now });
  const url = `https://example.test/u?t=${encodeURIComponent(unsubscribeToken('fan@example.com', secret))}`;
  const get = await handler(new Request(url));
  assert.match(await get.text(), /<button type="submit">Unsubscribe<\/button>/);
  assert.deepEqual(await storage.store('suppressions').list(''), [], 'just opening the link does nothing');
  const done = await handler(new Request(url, { method: 'POST' }));
  assert.match(await done.text(), /off the list/);
  assert.deepEqual(await storage.store('suppressions').list(''), [`email/${emailHash('fan@example.com')}`]);
  const forged = await handler(new Request('https://example.test/u?t=bm9wZQ.sig', { method: 'POST' }));
  assert.match(await forged.text(), /didn't work/);
});

test('the season year rolls over in March, not January', () => {
  assert.equal(defaultSeasonId(new Date('2027-01-20T00:00:00Z')), '2026');
  assert.equal(defaultSeasonId(new Date('2027-02-14T00:00:00Z')), '2026');
  assert.equal(defaultSeasonId(new Date('2027-03-01T00:00:00Z')), '2027');
  assert.equal(defaultSeasonId(new Date('2026-10-10T00:00:00Z')), '2026');
});

test('once the refresh date passes, the setup report says the title history is out of date', () => {
  const at = (when) => setupReport({ shop: realShop(), palettes: data.palettes, history: data.history, env: {}, storageKind: 'memory', now: new Date(when) }).history.needsRefresh;
  // Noon Eastern on the refresh day, and noon the day before.
  const day = new Date(`${data.history.refreshBy}T17:00:00Z`);
  assert.equal(at(day), true);
  assert.equal(at(new Date(day.getTime() - 86_400_000)), false);
});
