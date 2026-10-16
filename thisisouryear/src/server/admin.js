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
import { orderEmailSettings, orderEmailContent, sendOrderEmail, sampleOrder, orderRef } from './order-email.js';
import { printifySettings, scanCatalog, submitToPrintify, sendToProduction, sendTestOrder, KEY_CATALOG, KEY_OVERRIDES } from './printify.js';
import { todayIn } from '../lib/counter.js';

const QUOTE_STATUSES = ['new', 'answered', 'ordered', 'closed'];

export function setupReport({ shop, palettes, history, env, storageKind, now, printifyMapping = null }) {
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
  const printify = printifySettings(env);
  const orderEmail = orderEmailSettings(env, { ownerOnly: printify.on });

  const missing = [];
  // One entry per setting, with every reason it matters.
  const need = (name, why) => {
    const hit = missing.find((m) => m.name === name);
    if (hit) hit.why += ` ${why}`;
    else missing.push({ name, why });
  };
  if (stripeMode === 'missing') need('STRIPE_SECRET_KEY', 'Checkout cannot open without it.');
  if (!present('STRIPE_WEBHOOK_SECRET')) need('STRIPE_WEBHOOK_SECRET', 'Paid orders are not recorded here without it, so the vendor never gets an order email and campaigns have nobody to email.');
  if (!present('SITE_URL')) need('SITE_URL', 'Optional until the domain is connected. Needed for links in emails.');
  if (!present('BUILD_HOOK_URL')) need('BUILD_HOOK_URL', 'The daily rebuild that keeps counters and share cards current does not run without it.');
  if (printify.on) {
    for (const m of printify.missing) need(m, 'FULFILLMENT is printify, but orders can\'t reach Printify without it.');
    if (printify.tokenSet && !printifyMapping) need('Printify catalog', 'Not scanned yet. Open Orders in this screen and press "Scan Printify" before the first order.');
    else if (printifyMapping && printifyMapping.citiesReady < shop.teams.length) need('Printify colors', `${shop.teams.length - printifyMapping.citiesReady} cities have no close blank color. Pick one for each in Orders.`);
    if (!printify.autoSend) need('PRINTIFY_AUTO_SEND', 'Off, so each order waits in Printify for your OK. Set it to true once the first orders look right.');
    if (!orderEmail.ready) for (const m of orderEmail.missing) need(m.split(' ')[0], 'Your heads-up email for each order doesn\'t go out without it.');
  } else if (!orderEmail.ready) for (const m of orderEmail.missing) need(m.split(' ')[0], 'Order emails to the vendor do not go out without it. Paid orders are still in Stripe.');
  else if (!orderEmail.vendorSet) need('ORDER_EMAIL_TO', 'Order emails come to you only. Add the vendor\'s address to send them straight to the vendor.');
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
    orderEmail: { ready: orderEmail.ready, to: orderEmail.to, cc: orderEmail.cc, vendorSet: orderEmail.vendorSet, missing: orderEmail.missing },
    fulfillment: printify.on ? 'printify' : 'email',
    printify: { on: printify.on, tokenSet: printify.tokenSet, autoSend: printify.autoSend, scanned: Boolean(printifyMapping), provider: printifyMapping?.providerTitle ?? null, citiesReady: printifyMapping?.citiesReady ?? 0, scannedAt: printifyMapping?.scannedAt ?? null },
    bulkTiers: shop.bulkTiers,
    missing,
  };
}

export function makeAdminHandler({ shop, palettes, history, env, getStorage, printifyConfig = null, fetchImpl = fetch, now = () => new Date() }) {
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
        const [orders, quotes, fans, printifyMapping] = await Promise.all([readAll(storage.store('orders'), 'order/'), readAll(storage.store('quotes'), 'quote/'), readAll(storage.store('fans'), 'sub/'), storage.store('fulfillment').get(KEY_CATALOG)]);
        return json({
          ...setupReport({ shop, palettes, history, env, storageKind: storage.kind, now: now(), printifyMapping }),
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

      // ---- orders
      case 'orders.list': {
        const orders = await readAll(storage.store('orders'), 'order/');
        return json({
          orderEmail: orderEmailSettings(env, { ownerOnly: printifySettings(env).on }),
          fulfillment: printifySettings(env).on ? 'printify' : 'email',
          orders: orders
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
            .slice(0, 200)
            .map((o) => ({
              id: o.id,
              ref: orderRef(o.id),
              createdAt: o.createdAt,
              status: o.status,
              totalCents: o.totalCents,
              units: (o.lines ?? []).reduce((n, l) => n + (l.quantity ?? 1), 0),
              shipTo: o.shipTo ? { name: o.shipTo.name, city: o.shipTo.city, state: o.shipTo.state } : null,
              bulkPercentOff: o.bulkPercentOff ?? 0,
              vendorEmail: o.vendorEmail ?? null,
              printify: o.printify ?? null,
            })),
        });
      }
      case 'orders.preview': {
        const order = await storage.store('orders').get(`order/${v.id}`);
        if (!order) return json({ error: 'No such order.' }, 404);
        return json(orderEmailContent({ order, shop, palettes, timezone: shop.store.timezone }));
      }
      case 'orders.email': {
        if (v.confirm !== 'SEND') return json({ error: 'To send the order email again, type SEND.' }, 400);
        const result = await sendOrderEmail({ orderId: v.id, storage, shop, palettes, env, fetchImpl, now, again: true, ownerOnly: printifySettings(env).on });
        await audit('orders.email', { id: v.id, status: result.status });
        if (result.status === 'missing') return json({ error: 'No such order.' }, 404);
        if (result.status === 'not_configured') return json({ error: `Order email isn't set up. Missing: ${result.missing.join(', ')}.` }, 409);
        if (result.status === 'failed') return json({ error: `The email service refused it: ${result.error}` }, 502);
        return json(result);
      }
      case 'orders.test_email': {
        const settings = orderEmailSettings(env, { ownerOnly: printifySettings(env).on });
        const order = sampleOrder(shop, now());
        const content = orderEmailContent({ order, shop, palettes, timezone: shop.store.timezone, test: true });
        if (!v.send) return json({ preview: content, settings });
        if (!settings.ready) return json({ error: `Order email isn't set up. Missing: ${settings.missing.join(', ')}.`, preview: content }, 409);
        const send = emailSender(env, fetchImpl);
        try {
          await send({ to: settings.to, cc: settings.cc, replyTo: settings.replyTo, subject: content.subject, text: content.text, idempotencyKey: `order-test-${order.id}` });
        } catch (err) {
          return json({ error: `The email service refused it: ${String(err?.message ?? err).slice(0, 200)}` }, 502);
        }
        await audit('orders.test_email', { to: settings.to });
        return json({ sent: true, to: settings.to, cc: settings.cc });
      }

      // ---- Printify
      case 'printify.status': {
        const ful = storage.store('fulfillment');
        const [mapping, overrides] = await Promise.all([ful.get(KEY_CATALOG), ful.get(KEY_OVERRIDES)]);
        const p = printifySettings(env);
        return json({ on: p.on, tokenSet: p.tokenSet, autoSend: p.autoSend, missing: p.missing, mapping, overrides: overrides ?? {}, cities: shop.teams.map((t) => ({ slug: t.slug, name: t.name, colors: t.colors, shirt: t.shirt })) });
      }
      case 'printify.scan': {
        const result = await scanCatalog({ env, config: printifyConfig, teams: shop.teams, storage, fetchImpl, now });
        if (result.error) return json({ error: result.error }, 400);
        await audit('printify.scan', { provider: result.mapping.providerTitle, citiesReady: result.mapping.citiesReady });
        return json({ mapping: result.mapping });
      }
      case 'printify.colors': {
        if (!v.overrides || typeof v.overrides !== 'object') return json({ error: 'Send the colors to use.' }, 400);
        const ful = storage.store('fulfillment');
        const current = (await ful.get(KEY_OVERRIDES)) ?? {};
        for (const [slug, color] of Object.entries(v.overrides)) {
          if (!shop.city(slug)) continue;
          if (color) current[slug] = String(color).slice(0, 60);
          else delete current[slug];
        }
        await ful.set(KEY_OVERRIDES, current);
        // Re-map with the same printer, so the choices take effect now.
        const mapping = await ful.get(KEY_CATALOG);
        const pinned = mapping ? { ...env, PRINTIFY_PROVIDER_ID: String(mapping.providerId) } : env;
        const result = await scanCatalog({ env: pinned, config: printifyConfig, teams: shop.teams, storage, fetchImpl, now });
        if (result.error) return json({ error: result.error }, 400);
        await audit('printify.colors', { changed: Object.keys(v.overrides) });
        return json({ mapping: result.mapping, overrides: current });
      }
      case 'printify.test_order': {
        const result = await sendTestOrder({ storage, shop, config: printifyConfig, env, siteUrl, fetchImpl, now, slug: shop.city(v.slug) ? v.slug : 'dallas' });
        if (result.error) return json({ error: result.error, payload: result.payload ?? null }, 400);
        await audit('printify.test_order', { printifyOrderId: result.printifyOrderId });
        return json(result);
      }
      case 'orders.printify': {
        if (v.confirm !== 'SEND') return json({ error: 'To send this order to Printify, type SEND.' }, 400);
        const result = await submitToPrintify({ orderId: v.id, storage, shop, config: printifyConfig, env, siteUrl, fetchImpl, now });
        await audit('orders.printify', { id: v.id, status: result.status });
        if (['on_hold', 'in_production'].includes(result.status)) return json(result);
        if (result.status === 'already_sent') return json({ error: `This order is already in Printify (order ${result.printifyOrderId}). It won't be sent twice. Approve it with "Print it now" or in Printify.` }, 409);
        if (result.status === 'in_progress') return json({ error: 'This order is being sent right now. Check back in a minute.' }, 409);
        return json({ error: result.error ?? `Not sent: ${result.status}.`, ...result }, result.status === 'missing' ? 404 : 400);
      }
      case 'orders.produce': {
        if (v.confirm !== 'PRINT') return json({ error: 'To print this order, type PRINT. Printify charges your card when it does.' }, 400);
        const result = await sendToProduction({ orderId: v.id, storage, env, fetchImpl, now });
        await audit('orders.produce', { id: v.id, status: result.status });
        if (result.status === 'in_production' || result.status === 'already_sent') return json(result);
        return json({ error: result.error ?? 'Not sent to print.' }, 400);
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
