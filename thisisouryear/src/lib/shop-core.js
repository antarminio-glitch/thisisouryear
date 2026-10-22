// The shop's rules, in one place: what can be bought, at what price, and what
// goes on the order. The website, the cart and the checkout server all use
// this same code, so they can't disagree with each other.
//
// Nothing here trusts the browser. The server calls quote() with the bare
// choices (which item, which city, which size, how many) and works out
// prices and availability itself.

export const MODES = ['standard', 'rival_gift', 'fantasy_punishment', 'matching_set'];

const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

// Removes control characters and trims. Used on gift notes and league names.
export function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function dollars(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

// `approvals` is an optional ready-made map of city -> print approval, used in
// the browser so the full palette file doesn't have to be downloaded.
export function createShop({ teams, catalog, store, palettes = null, approvals = null }) {
  const cityBySlug = new Map(teams.map((t) => [t.slug, t]));
  const productById = new Map(catalog.products.map((p) => [p.id, p]));
  const designById = new Map(catalog.designs.map((d) => [d.id, d]));
  const colorwayVersion = palettes?.version ?? 'unversioned';

  const city = (slug) => (typeof slug === 'string' ? cityBySlug.get(slug) : undefined);
  const product = (id) => (typeof id === 'string' ? productById.get(id) : undefined);
  const design = (id) => (typeof id === 'string' ? designById.get(id) : undefined);

  // What still has to be filled in before an item can be sold. Shown on the
  // admin setup screen and used to explain "not available yet" to shoppers.
  function missingFor(p) {
    const missing = [];
    if (!Number.isInteger(p.priceCents) || p.priceCents <= 0) missing.push('priceCents');
    if (!Array.isArray(p.variants) || p.variants.length === 0) missing.push('variants (sizes)');
    if (!Array.isArray(p.designs) || p.designs.length === 0) missing.push('designs');
    if (!p.fulfillment?.provider) missing.push('fulfillment.provider');
    if (!p.sizeChart) missing.push('sizeChart');
    if (p.sellable !== true) missing.push('sellable: true');
    return missing;
  }

  // An item only sells when it is switched on AND fully described.
  function isSellable(p) {
    return (
      p.sellable === true &&
      Number.isInteger(p.priceCents) &&
      p.priceCents > 0 &&
      Array.isArray(p.variants) &&
      p.variants.length > 0 &&
      Array.isArray(p.designs) &&
      p.designs.length > 0
    );
  }

  function printApproval(slug) {
    if (approvals) return approvals[slug] ?? 'label_only';
    const applied = city(slug)?.apply;
    const rows = palettes?.colorways?.[slug]?.colors ?? [];
    if (!applied) return 'label_only';
    const used = Object.values(applied)
      .filter(Boolean)
      .map((key) => rows.find((r) => r.key === key));
    const approved = used.length > 0 && used.every((r) => r && r.vendorPrintSelection && r.productionStatus === 'Approved');
    return approved ? 'vendor_approved' : 'label_only';
  }

  // Can this exact choice be bought right now? Never picks a size for you.
  function availability({ productId, designId, slug, size }) {
    const p = product(productId);
    if (!p) return { ok: false, code: 'unknown_product', message: "We don't make that item." };
    const c = city(slug);
    if (!c) return { ok: false, code: 'unknown_city', message: "We don't have that city." };
    const d = design(designId);
    if (!d) return { ok: false, code: 'unknown_design', message: "We don't have that design." };

    if (!isSellable(p)) {
      return { ok: false, code: 'product_unavailable', message: `The ${p.name.toLowerCase()} isn't available to order yet.` };
    }
    if (d.status !== 'live' || !p.designs.includes(d.id)) {
      return { ok: false, code: 'design_unavailable', message: `"${d.name}" isn't available on the ${p.name.toLowerCase()} yet.` };
    }
    if (store.requireVendorApprovedColors === true && printApproval(slug) !== 'vendor_approved') {
      return { ok: false, code: 'colors_not_approved', message: `${c.name} colors haven't been approved for printing yet.` };
    }
    if (typeof size !== 'string' || size === '') {
      return { ok: false, code: 'size_required', message: 'Pick a size first.' };
    }
    const variant = p.variants.find((v) => v.size === size);
    if (!variant) {
      return { ok: false, code: 'size_unavailable', message: `${size} isn't a size we offer for the ${p.name.toLowerCase()}.` };
    }
    if (variant.inStock !== true) {
      return { ok: false, code: 'out_of_stock', message: `${size} is out of stock right now.` };
    }
    return { ok: true, code: 'ok', message: '', priceCents: p.priceCents + (variant.extraCents ?? 0), variant, product: p, design: d, city: c };
  }

  // Lowest and highest price across an item's sizes, or null if it has none.
  function priceRange(productId) {
    const p = product(productId);
    if (!p || !isSellable(p)) return null;
    const prices = p.variants.map((v) => p.priceCents + (v.extraCents ?? 0));
    return { lowCents: Math.min(...prices), highCents: Math.max(...prices) };
  }

  function findProduct(style, audience) {
    return catalog.products.find((p) => p.style === style && p.audience === audience);
  }

  // The words on the order. The print vendor reads this line.
  function itemName(p, d, c, size) {
    return `${d.name} ${p.name}, ${c.name}, ${c.colors}, Size ${size}`;
  }

  // Bulk pricing. Tiers come from catalog.json and count every item in the
  // order, whatever the size, color or kind of order. The best tier reached
  // applies to every item. Setting bulk.enabled to false in catalog.json
  // switches the discounts off without losing the tiers; quote requests
  // still work.
  const tiers = (catalog.bulk?.enabled === false ? [] : [...(catalog.bulk?.tiers ?? [])])
    .filter((t) => Number.isInteger(t.minQuantity) && t.minQuantity > 0 && Number.isInteger(t.percentOff) && t.percentOff > 0 && t.percentOff < 100)
    .sort((a, b) => a.minQuantity - b.minQuantity);

  function bulkTierFor(units) {
    let best = null;
    for (const t of tiers) if (units >= t.minQuantity) best = t;
    return best;
  }
  function nextTierFor(units) {
    const t = tiers.find((x) => units < x.minQuantity);
    return t ? { ...t, unitsAway: t.minQuantity - units } : null;
  }
  // The discounted price of one item, rounded to the cent.
  const bulkPrice = (unitCents, percentOff) => (percentOff ? Math.round((unitCents * (100 - percentOff)) / 100) : unitCents);

  // Flat shipping, waived once the order (after any bulk discount) reaches
  // freeShippingMinCents. No threshold set means shipping is always charged.
  function shippingFor(subtotalCents) {
    const min = store.freeShippingMinCents;
    if (Number.isInteger(min) && min > 0 && subtotalCents >= min) return 0;
    return store.shippingCents;
  }

  // Checks a whole cart and prices it. Every line comes back marked ok or not,
  // with a plain-English reason. Totals are only given when every line is ok.
  function quote(rawItems) {
    const problems = [];
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return { ok: false, lines: [], problems: ['Your cart is empty.'], subtotalCents: 0, shippingCents: 0, totalCents: 0, bulk: null };
    }
    if (rawItems.length > store.maxCartLines) {
      return {
        ok: false,
        lines: [],
        problems: [`That's more than ${store.maxCartLines} different items in one order. Split it up, or ask for a bulk quote.`],
        subtotalCents: 0,
        shippingCents: 0,
        totalCents: 0,
        bulk: null,
      };
    }

    const lines = rawItems.map((raw, index) => {
      const item = raw && typeof raw === 'object' ? raw : {};
      const line = {
        index,
        ok: false,
        code: 'ok',
        message: '',
        notices: [],
        productId: item.productId,
        designId: item.designId,
        slug: item.slug,
        size: item.size,
        quantity: item.quantity,
        mode: item.mode ?? 'standard',
      };
      const bad = (code, message) => Object.assign(line, { ok: false, code, message });

      if (!MODES.includes(line.mode)) return bad('bad_mode', "We don't recognize that kind of order.");
      if (!Number.isInteger(item.quantity) || item.quantity < 1) return bad('bad_quantity', 'Quantity has to be at least 1.');
      if (item.quantity > store.maxQuantity) {
        return bad('too_many', `The most you can order of one item is ${store.maxQuantity}. For more, ask for a bulk quote.`);
      }

      const found = availability(item);
      if (!found.ok) return bad(found.code, found.message);
      const { product: p, design: d, city: c, variant } = found;

      // Things that only apply to some kinds of order.
      let recipient = null;
      let giftNote = '';
      let leagueName = '';
      let bundleId = '';
      let leagueOrderId = '';

      if (line.mode === 'rival_gift') {
        recipient = city(item.recipientSlug);
        if (!recipient) return bad('recipient_required', "Pick your friend's own city, so we know whose colors these aren't.");
        if (recipient.slug === c.slug) {
          return bad('same_city', "That's their own city. Pick a different one for them to wear. That's the whole joke.");
        }
        giftNote = cleanText(item.giftNote);
        if (giftNote && store.giftNotes !== true) giftNote = '';
        if (giftNote.length > store.noteMaxLength) {
          return bad('note_too_long', `Keep the gift note under ${store.noteMaxLength} characters.`);
        }
      }
      if (line.mode === 'matching_set') {
        if (typeof item.bundleId !== 'string' || !ID_PATTERN.test(item.bundleId)) {
          return bad('bundle_required', 'This matching set lost its other half. Remove it and build the set again.');
        }
        bundleId = item.bundleId;
      }
      if (line.mode === 'fantasy_punishment') {
        if (typeof item.leagueOrderId !== 'string' || !ID_PATTERN.test(item.leagueOrderId)) {
          return bad('league_required', 'This league order lost its group. Remove it and build the order again.');
        }
        leagueOrderId = item.leagueOrderId;
        leagueName = cleanText(item.leagueName);
        if (leagueName.length > store.leagueNameMaxLength) {
          return bad('league_name_too_long', `Keep the league name under ${store.leagueNameMaxLength} characters.`);
        }
      }

      const unitCents = found.priceCents;
      if (Number.isInteger(item.seenPriceCents) && item.seenPriceCents !== unitCents) {
        line.notices.push({
          code: 'price_changed',
          message: `The price changed from ${dollars(item.seenPriceCents)} to ${dollars(unitCents)} since you added this.`,
        });
      }

      const metadata = {
        team_id: c.slug,
        city: c.name,
        colors: c.colors,
        colorway_version: colorwayVersion,
        design_id: d.id,
        artwork_version: d.artworkVersion ?? 'unversioned',
        product_id: p.id,
        product_style: p.style,
        audience: p.audience,
        size: variant.size,
        variant_key: `${p.id}:${d.id}:${c.slug}:${variant.size}`,
        provider_variant_id: variant.providerVariantId ?? 'unmapped',
        fulfillment_provider: p.fulfillment?.provider ?? 'none',
        print_approval: printApproval(c.slug),
        purchase_mode: line.mode,
      };
      if (bundleId) metadata.bundle_id = bundleId;
      if (leagueOrderId) metadata.league_order_id = leagueOrderId;
      if (leagueName) metadata.league_name = leagueName;
      if (recipient) metadata.recipient_team_id = recipient.slug;
      if (giftNote) metadata.gift_note = giftNote;

      return Object.assign(line, {
        ok: true,
        code: 'ok',
        message: '',
        productId: p.id,
        designId: d.id,
        slug: c.slug,
        size: variant.size,
        quantity: item.quantity,
        unitCents,
        lineCents: unitCents * item.quantity,
        name: itemName(p, d, c, variant.size),
        productName: p.name,
        designName: d.name,
        cityName: c.name,
        colors: c.colors,
        style: p.style,
        audience: p.audience,
        bundleId,
        leagueOrderId,
        leagueName,
        recipientSlug: recipient?.slug ?? '',
        giftNote,
        metadata,
      });
    });

    // A matching set is two real items. If either half can't be bought, the
    // whole set is held back and says why, so nobody gets half a set by accident.
    const bundles = new Map();
    lines.forEach((l, i) => {
      const id = rawItems[i]?.mode === 'matching_set' && typeof rawItems[i]?.bundleId === 'string' ? rawItems[i].bundleId : null;
      if (id) bundles.set(id, [...(bundles.get(id) ?? []), l]);
    });
    for (const [, members] of bundles) {
      const broken = members.filter((l) => !l.ok);
      const good = members.filter((l) => l.ok);
      const explain = (reason) => {
        for (const l of good) {
          Object.assign(l, { ok: false, code: 'set_incomplete', message: reason });
        }
      };
      if (broken.length > 0) {
        explain(`The other half of this matching set can't be ordered: ${broken[0].message} Remove the set, or keep this one as a single item.`);
        continue;
      }
      const audiences = new Set(good.map((l) => l.audience));
      const slugs = new Set(good.map((l) => l.slug));
      if (good.length < 2 || !audiences.has('adult') || !audiences.has('kids')) {
        explain('A matching set needs one adult item and one kids item. This one is missing a half. Remove it, or keep this as a single item.');
      } else if (slugs.size > 1) {
        explain("The two halves of this matching set are in different colors, so they don't match. Remove the set and build it again.");
      }
    }

    // Very big orders go through a quote, so the owner can check the vendor
    // can take them.
    const units = lines.reduce((n, l) => n + (l.ok ? l.quantity : 0), 0);
    if (Number.isInteger(store.maxOrderQuantity) && units > store.maxOrderQuantity) {
      problems.push(`That's more than ${store.maxOrderQuantity} items in one order. Ask for a bulk quote and we'll sort it out with you.`);
    }

    // Bulk pricing, worked out on every item in the order.
    const tier = bulkTierFor(units);
    const percentOff = tier?.percentOff ?? 0;
    let savingsCents = 0;
    for (const l of lines) {
      if (!l.ok) continue;
      l.regularUnitCents = l.unitCents;
      if (percentOff) {
        l.unitCents = bulkPrice(l.regularUnitCents, percentOff);
        l.lineCents = l.unitCents * l.quantity;
        l.metadata.bulk_percent_off = String(percentOff);
        savingsCents += (l.regularUnitCents - l.unitCents) * l.quantity;
      }
    }
    const bulk = { units, percentOff, minQuantity: tier?.minQuantity ?? null, savingsCents, next: nextTierFor(units) };

    const ok = lines.every((l) => l.ok) && problems.length === 0;
    const subtotalCents = ok ? lines.reduce((sum, l) => sum + l.lineCents, 0) : 0;
    const shippingCents = ok ? shippingFor(subtotalCents) : 0;
    for (const l of lines) if (!l.ok) problems.push(l.message);
    return { ok, lines, problems, subtotalCents, shippingCents, totalCents: subtotalCents + shippingCents, bulk };
  }

  return {
    teams,
    catalog,
    store,
    colorwayVersion,
    city,
    product,
    design,
    findProduct,
    isSellable,
    missingFor,
    printApproval,
    availability,
    priceRange,
    itemName,
    bulkTiers: tiers,
    bulkTierFor,
    nextTierFor,
    bulkPrice,
    shippingFor,
    quote,
  };
}
