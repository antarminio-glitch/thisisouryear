// Bulk quote requests from the fantasy league page.
//
// A request is saved for the owner to answer by hand. Nothing is charged and
// no order is placed. If it can't be saved, the shopper is told so.
import { json, readJson, shortId, isEmail } from './http.js';
import { cleanText, dollars } from '../lib/shop-core.js';

const MAX_ROWS = 40;
const MAX_PER_ROW = 500;

export function makeQuoteRequestHandler({ shop, getStorage, now = () => new Date() }) {
  const { store, catalog } = shop;
  return async (req) => {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    const body = await readJson(req);
    if (body.error) return json({ error: "We couldn't read that request." }, 400);
    const v = body.value;

    // A hidden field people never see. Only junk bots fill it in.
    if (v.website) return json({ error: "We couldn't read that request." }, 400);

    if (!isEmail(v.email)) return json({ error: 'Add an email address so we can send the quote.', field: 'email' }, 400);
    const city = shop.city(v.slug);
    if (!city) return json({ error: 'Pick which colors the loser has to wear.', field: 'slug' }, 400);
    const design = shop.design(v.designId ?? 'this-is-our-year');
    if (!design) return json({ error: "We don't have that design.", field: 'designId' }, 400);
    if (!Array.isArray(v.rows) || v.rows.length === 0) return json({ error: 'Add at least one size.', field: 'rows' }, 400);
    if (v.rows.length > MAX_ROWS) return json({ error: `That's more than ${MAX_ROWS} rows. Combine a few and try again.`, field: 'rows' }, 400);

    const rows = [];
    for (const [i, r] of v.rows.entries()) {
      const p = shop.product(r?.productId);
      if (!p) return json({ error: `Row ${i + 1}: we don't make that item.`, field: 'rows' }, 400);
      const size = cleanText(r.size).slice(0, 12);
      if (!size) return json({ error: `Row ${i + 1}: add a size.`, field: 'rows' }, 400);
      if (!Number.isInteger(r.quantity) || r.quantity < 1 || r.quantity > MAX_PER_ROW) {
        return json({ error: `Row ${i + 1}: quantity has to be between 1 and ${MAX_PER_ROW}.`, field: 'rows' }, 400);
      }
      // Record whether each row could be bought today, and at what price.
      const found = shop.availability({ productId: p.id, designId: design.id, slug: city.slug, size });
      rows.push({
        productId: p.id,
        productName: p.name,
        size,
        quantity: r.quantity,
        availableNow: found.ok,
        unitCentsToday: found.ok ? found.priceCents : null,
        note: found.ok ? '' : found.message,
      });
    }

    const leagueName = cleanText(v.leagueName);
    const notes = cleanText(v.notes);
    if (leagueName.length > store.leagueNameMaxLength) return json({ error: `Keep the league name under ${store.leagueNameMaxLength} characters.`, field: 'leagueName' }, 400);
    if (notes.length > 600) return json({ error: 'Keep the notes under 600 characters.', field: 'notes' }, 400);

    const allPriced = rows.every((r) => r.availableNow);
    const record = {
      reference: shortId('Q'),
      createdAt: now().toISOString(),
      status: 'new',
      email: v.email.trim().toLowerCase(),
      name: cleanText(v.name).slice(0, 80),
      leagueName,
      slug: city.slug,
      designId: design.id,
      rows,
      totalQuantity: rows.reduce((n, r) => n + r.quantity, 0),
      // Regular prices as of now. Not a promise of a discount.
      regularTotalCentsToday: allPriced ? rows.reduce((n, r) => n + r.unitCentsToday * r.quantity, 0) : null,
      bulkTiersConfigured: (catalog.bulk?.tiers ?? []).length,
      notes,
    };

    try {
      const storage = await getStorage();
      await storage.store('quotes').set(`quote/${record.reference}`, record);
    } catch (err) {
      console.error('Could not save a quote request:', err?.message ?? err);
      return json({ error: `We couldn't save your request just now. Nothing was sent. Email ${store.contactEmail} instead.`, saved: false }, 503);
    }

    return json({
      saved: true,
      reference: record.reference,
      totalQuantity: record.totalQuantity,
      regularTotal: record.regularTotalCentsToday === null ? null : dollars(record.regularTotalCentsToday),
    });
  };
}
