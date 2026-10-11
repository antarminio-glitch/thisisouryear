// The owner's control room. One endpoint, many small actions, all behind the
// admin password (ADMIN_TOKEN).
//
// It reports honestly on what is and isn't set up, and it is the only way
// season facts, campaigns and fan photos change.
import { json, readJson, requireAdmin, shortId } from './http.js';
import { readAll } from './storage.js';
import { saveSeasonUpdate, applyMetaUpdate, loadSeason, survivors, metaKey, STATUSES, ELIMINATION_REASONS, ROUNDS } from './season.js';
import { CAMPAIGNS, loadConfigs, applyConfigUpdate, emailBlockers, planElimination, loadEliminationInputs, dispatchElimination, cancelPending, reopenCanceled, activeHero, emailHash } from './campaigns.js';
import { emailSender, unsubscribeToken, readUnsubscribeToken } from './email.js';
import { moderate } from './fans.js';
import { todayIn } from '../lib/counter.js';

const QUOTE_STATUSES = ['new', 'answered', 'ordered', 'closed'];

export function setupReport({ shop, palettes, history, env, storageKind, now }) {
  const { store, catalog, teams } = shop;
  const present = (k) => typeof env[k] === 'string' && env[k].length > 0;
  const stripeMode = !present('STRIPE_SECRET_KEY') ? 'missing' : env.STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'live' : 'test';

  const products = catalog.products.map((p) => ({ id: p.id, name: p.name, sellable: shop.isSellable(p), missing: shop.isSellable(p) ? [] : shop.missingFor(p) }));
  const rows = Object.values(palettes.colorways).flatMap((c) => c.colors);
  const appliedKeys = teams.flatMap((t) => Object.values(t.apply ?? {}).filter(Boolean));
  const applied = appliedKeys.map((k) => rows.find((r) => r.key === k)).filter(Boolean);
  const custom = teams.flatMap((t) => Object.entries(t.apply ?? {}).filter(([, k]) => k === null).map(([surface]) => `${t.slug}.${surface}`));
  const today = todayIn(store.timezone, now);
  const blockers = emailBlockers(env);

  const missing = [];
  const need = (name, why) => missing.push({ name, why });
  if (stripeMode === 'missing') need('STRIPE_SECRET_KEY', 'Checkout cannot open without it.');
  if (!present('STRIPE_WEBHOOK_SECRET')) need('STRIPE_WEBHOOK_SECRET', 'Paid orders are not recorded here without it, so campaigns have nobody to email and reports are empty.');
  if (!present('SITE_URL')) need('SITE_URL', 'Optional until the domain is connected. Needed for links in emails.');
  if (!present('BUILD_HOOK_URL')) need('BUILD_HOOK_URL', 'The daily rebuild that keeps counters and share cards current does not run without it.');
  for (const p of products) if (!p.sellable) need(`catalog.json > ${p.id}`, `Not for sale. Fill in: ${p.missing.join(', ')}.`);
  for (const d of catalog.designs) if (d.status !== 'live') need(`catalog.json > designs > ${d.id}`, 'Concept only. Set status to "live", give it an artworkVersion and add it to a product\'s designs once the artwork is approved.');
  if (store.collectMarketingConsent !== true) need('store.json > collectMarketingConsent', 'Off, so checkout never asks about marketing email and no customer can be eligible for a campaign.');
  if (store.giftNotes !== true) need('store.json > giftNotes', 'Off, so the gift note box is hidden. Turn on only if the vendor will include notes.');
  for (const b of blockers) need(b.split(' ')[0], `Email: ${b}.`);
  need('Analytics', 'No analytics service is connected. Events are collected on the page and go nowhere.');
  if (applied.every((r) => !r.vendorPrintSelection)) need('palettes.json > vendorPrintSelection', 'No color has a vendor-approved print selection. Orders carry print_approval: label_only.');

  return {
    generatedAt: now.toISOString(),
    storage: storageKind,
    stripe: { mode: stripeMode, webhook: present('STRIPE_WEBHOOK_SECRET') },
    siteUrl: env.SITE_URL || null,
    products,
    designs: catalog.designs.map((d) => ({ id: d.id, name: d.name, status: d.status, artworkVersion: d.artworkVersion })),
    settings: {
      collectMarketingConsent: store.collectMarketingConsent === true,
      requireVendorApprovedColors: store.requireVendorApprovedColors === true,
      giftNotes: store.giftNotes === true,
      automaticTax: store.automaticTax === true,
      bulkTiers: (catalog.bulk?.tiers ?? []).length,
    },
    colors: {
      version: palettes.version,
      cities: teams.length,
      colorsInReference: rows.length,
      appliedSurfaces: appliedKeys.length,
      customSurfaces: custom,
      appliedWithUnresolvedReference: [...new Set(applied.filter((r) => r.unresolved).map((r) => r.key))],
      vendorApprovedCities: teams.filter((t) => shop.printApproval(t.slug) === 'vendor_approved').length,
    },
    history: {
      latestSeason: history.latestCompletedSeason?.season ?? null,
      refreshBy: history.refreshBy,
      needsRefresh: today >= history.refreshBy,
      verifiedCities: Object.values(history.cities).filter((c) => c.verified === true).length,
    },
    email: { ready: blockers.length === 0, blockers },
    missing,
  };
}

export function makeAdminHandler({ shop, palettes, history, env, getStorage, fetchImpl = fetch, now = () => new Date() }) {
  const slugs = shop.teams.map((t) => t.slug);

  return async (req) => {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    const denied = requireAdmin(req, env);
    if (denied) return denied;
    const body = await readJson(req);
    if (body.error) return json({ error: "We couldn't read that." }, 400);
    const v = body.value;
    const actor = String(v.actor ?? '').trim().slice(0, 60) || 'owner';

    let storage;
    try {
      storage = await getStorage();
    } catch (err) {
      if (v.action === 'status') {
        return json({ ...setupReport({ shop, palettes, history, env, storageKind: 'unavailable', now: now() }), counts: null, storageError: String(err?.message ?? err) });
      }
      return json({ error: 'Storage is not available, so nothing can be read or saved right now.' }, 503);
    }
    const audit = (what, detail = {}) => storage.store('audit').set(`log/${now().toISOString()}-${shortId('A')}`, { at: now().toISOString(), actor, what, ...detail });
    const siteUrl = (env.SITE_URL || new URL(req.url).origin).replace(/\/+$/, '');

    switch (v.action) {
      case 'status': {
        const [orders, quotes, fans] = await Promise.all([readAll(storage.store('orders'), 'order/'), readAll(storage.store('quotes'), 'quote/'), readAll(storage.store('fans'), 'sub/')]);
        return json({
          ...setupReport({ shop, palettes, history, env, storageKind: storage.kind, now: now() }),
          counts: {
            orders: orders.length,
            paidOrders: orders.filter((o) => o.status === 'paid').length,
            optedIn: new Set(orders.filter((o) => o.marketingConsent === 'opt_in').map((o) => o.customerId)).size,
            quotes: quotes.length,
            newQuotes: quotes.filter((q) => q.status === 'new').length,
            fanPending: fans.filter((f) => f.status === 'pending').length,
            fanApproved: fans.filter((f) => f.status === 'approved').length,
            repostQueue: fans.filter((f) => f.repost?.queued).length,
          },
        });
      }

      // ---- season
      case 'season.get': {
        const season = await loadSeason(storage, v.seasonId);
        return json({ ...season, survivors: survivors(season, slugs, now()), options: { STATUSES, ELIMINATION_REASONS, ROUNDS } });
      }
      case 'season.update': {
        if (!shop.city(v.slug)) return json({ error: 'No such city.' }, 400);
        const result = await saveSeasonUpdate(storage, { ...v, actor }, now());
        if (result.error) return json({ error: result.error }, 400);
        let canceled = 0;
        if (result.transition?.from === 'eliminated') canceled = await cancelPending(storage, { slug: v.slug, seasonId: v.seasonId, now });
        if (result.transition?.to === 'eliminated') await reopenCanceled(storage, { slug: v.slug, seasonId: v.seasonId });
        await audit('season.update', { slug: v.slug, seasonId: String(v.seasonId), transition: result.transition, canceled });
        return json({ state: result.next, transition: result.transition, canceledSends: canceled });
      }
      case 'season.meta': {
        const result = applyMetaUpdate({ ...v, actor }, now());
        if (result.error) return json({ error: result.error }, 400);
        await storage.store('season').set(metaKey(result.next.seasonId), result.next);
        await audit('season.meta', { seasonId: result.next.seasonId, round: result.next.round });
        return json({ meta: result.next });
      }

      // ---- campaigns
      case 'campaigns.get': {
        return json({ definitions: CAMPAIGNS, configs: await loadConfigs(storage), emailBlockers: emailBlockers(env) });
      }
      case 'campaigns.update': {
        const configs = await loadConfigs(storage);
        const current = configs.find((c) => c.id === v.id);
        if (!current) return json({ error: 'No such campaign.' }, 400);
        const result = applyConfigUpdate(current, { ...v, actor }, { env, now: now() });
        if (result.error) return json({ error: result.error }, 400);
        await storage.store('campaigns').set(`config/${current.id}`, result.next);
        await audit('campaigns.update', { id: current.id, enabled: result.next.enabled });
        return json({ config: result.next });
      }
      case 'campaigns.preview':
      case 'campaigns.send': {
        if (!shop.city(v.slug)) return json({ error: 'No such city.' }, 400);
        const inputs = await loadEliminationInputs(storage, { slug: v.slug, seasonId: v.seasonId });
        const plan = planElimination({ shop, slug: v.slug, seasonId: v.seasonId, siteUrl, now: now(), ...inputs });
        const config = (await loadConfigs(storage)).find((c) => c.id === 'elimination');
        const preview = {
          dryRun: true,
          status: plan.status,
          reason: plan.reason,
          recipientCount: plan.recipients.length,
          segments: { standard: plan.recipients.filter((r) => r.segment === 'standard').length, gift: plan.recipients.filter((r) => r.segment === 'gift').length },
          exclusions: plan.exclusions,
          samples: plan.samples,
          productLink: plan.offer ? `${siteUrl}${plan.offer.path}` : null,
          campaignEnabled: config?.enabled === true,
          emailBlockers: emailBlockers(env),
        };
        if (v.action === 'campaigns.preview') return json(preview);

        if (v.confirm !== `SEND elimination ${v.slug}`) return json({ error: `To send, type exactly: SEND elimination ${v.slug}`, ...preview }, 400);
        const send = emailSender(env, fetchImpl);
        if (!send) return json({ error: 'No email service is set up, so nothing was sent.', ...preview }, 409);
        const result = await dispatchElimination({
          plan,
          config,
          env,
          storage,
          shop,
          send,
          siteUrl,
          now,
          unsubscribeUrlFor: (email) => `${siteUrl}/.netlify/functions/unsubscribe?t=${encodeURIComponent(unsubscribeToken(email, env.UNSUBSCRIBE_SECRET))}`,
        });
        await audit('campaigns.send', { slug: v.slug, seasonId: String(v.seasonId), ...result });
        return json({ ...preview, dryRun: false, result }, result.blocked ? 409 : 200);
      }

      // ---- quotes
      case 'quotes.list': {
        const quotes = await readAll(storage.store('quotes'), 'quote/');
        return json({ quotes: quotes.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) });
      }
      case 'quotes.update': {
        const store = storage.store('quotes');
        const q = await store.get(`quote/${v.reference}`);
        if (!q) return json({ error: 'No such quote request.' }, 404);
        if (v.status && !QUOTE_STATUSES.includes(v.status)) return json({ error: `Status has to be one of: ${QUOTE_STATUSES.join(', ')}.` }, 400);
        if (v.status) q.status = v.status;
        if (typeof v.ownerNote === 'string') q.ownerNote = v.ownerNote.slice(0, 600);
        q.updatedAt = now().toISOString();
        await store.set(`quote/${q.reference}`, q);
        await audit('quotes.update', { reference: q.reference, status: q.status });
        return json({ quote: q });
      }

      // ---- fan photos
      case 'fans.list': {
        const fans = await readAll(storage.store('fans'), 'sub/');
        return json({
          submissions: fans
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
            .map(({ removalCodeHash, ...rest }) => ({ ...rest, cityName: shop.city(rest.slug)?.name ?? rest.slug })),
        });
      }
      case 'fans.photo': {
        const record = await storage.store('fans').get(`sub/${v.id}`);
        const file = record ? await storage.store('fan-photos').getBinary(`photo/${record.id}`) : null;
        if (!file) return json({ error: 'That photo is gone.' }, 404);
        return json({ type: record.imageType, base64: Buffer.from(file.data).toString('base64') });
      }
      case 'fans.moderate': {
        const result = await moderate(storage, { id: v.id, action: v.do, actor }, now());
        if (result.error) return json({ error: result.error }, 400);
        await audit('fans.moderate', { id: v.id, do: v.do });
        const { removalCodeHash, ...safe } = result.record;
        return json({ submission: safe });
      }

      default:
        return json({ error: 'Unknown action.' }, 400);
    }
  };
}

// ---- small public endpoints

// What any visitor's browser may know: whether a campaign message is showing
// and which cities are confirmed alive in the playoffs. Nothing else.
export function makePublicStateHandler({ shop, getStorage, now = () => new Date(), seasonIdFor = defaultSeasonId }) {
  const slugs = shop.teams.map((t) => t.slug);
  return async (req) => {
    if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
    const nothing = { campaign: null, bandwagon: { verified: false, slugs: [] } };
    try {
      const storage = await getStorage();
      const configs = await loadConfigs(storage);
      const band = configs.find((c) => c.id === 'playoff_bandwagon');
      let bandwagon = nothing.bandwagon;
      if (band?.enabled && band.seasonId) {
        const s = survivors(await loadSeason(storage, band.seasonId), slugs, now());
        if (s.verified) bandwagon = { verified: true, round: s.round, slugs: s.slugs, asOf: s.asOf };
      }
      return json({ campaign: activeHero(configs, now()), bandwagon }, 200, { 'Cache-Control': 'public, max-age=120' });
    } catch {
      return json(nothing, 200, { 'Cache-Control': 'public, max-age=60' });
    }
  };
}

// A football season is named for the year it starts. Before March it's still
// last year's season.
export function defaultSeasonId(now) {
  const y = now.getUTCFullYear();
  return String(now.getUTCMonth() < 2 ? y - 1 : y);
}

const page = (title, body) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{margin:0;background:#2b2d31;color:#fff;font:18px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}main{max-width:32rem;padding:24px}button{font:inherit;font-weight:600;padding:14px 22px;border:0;border-radius:4px;background:#fff;color:#0b0c0e;cursor:pointer}a{color:#fff}</style></head><body><main>${body}</main></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );

// Unsubscribe. Opening the link shows a button, and pressing it does the
// unsubscribing. That way a mail scanner that merely opens links can't
// unsubscribe anyone by accident.
export function makeUnsubscribeHandler({ env, getStorage, now = () => new Date() }) {
  return async (req) => {
    const url = new URL(req.url);
    const token = url.searchParams.get('t') ?? '';
    const email = readUnsubscribeToken(token, env.UNSUBSCRIBE_SECRET);
    if (!email) return page('Unsubscribe', "<h1>That link didn't work</h1><p>It may be incomplete. Reply to any of our emails and we'll take you off the list by hand.</p>");
    if (req.method === 'GET') {
      return page('Unsubscribe', `<h1>Stop the emails?</h1><p>One press and we won't send marketing email to this address again.</p><form method="post" action="?t=${encodeURIComponent(token)}"><button type="submit">Unsubscribe</button></form>`);
    }
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });
    try {
      const storage = await getStorage();
      await storage.store('suppressions').set(`email/${emailHash(email)}`, { at: now().toISOString(), source: 'unsubscribe_link' });
    } catch {
      return page('Unsubscribe', "<h1>That didn't save</h1><p>Something went wrong on our side. Try the link again in a minute, or reply to the email and we'll do it by hand.</p>");
    }
    return page('Unsubscribed', "<h1>Done. You're off the list.</h1><p>No more marketing email from This Is Our Year. Order receipts still come through.</p>");
  };
}
