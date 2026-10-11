// Search-engine data for a city page.
//
// Product and price details are only published for items that can really be
// bought, at the prices the page really shows. Planned items (hoodies, kids)
// publish nothing here until they're switched on in the catalog.

// "Tee", "Tee and Hoodie" and so on, from what's actually for sale.
export function sellableStyles(shop) {
  const names = [];
  for (const p of shop.catalog.products) {
    if (p.audience === 'adult' && shop.isSellable(p)) names.push(p.name);
  }
  return names;
}

export function productJsonLd(team, shop, { siteUrl, pageUrl, imageUrl, description }) {
  const offers = [];
  for (const p of shop.catalog.products) {
    if (!shop.isSellable(p)) continue;
    const design = shop.catalog.designs.find((d) => d.status === 'live' && p.designs.includes(d.id));
    if (!design) continue;
    if (shop.store.requireVendorApprovedColors === true && shop.printApproval(team.slug) !== 'vendor_approved') continue;
    const inStock = p.variants.filter((v) => v.inStock);
    if (!inStock.length) continue;
    const prices = inStock.map((v) => p.priceCents + (v.extraCents ?? 0));
    offers.push({
      '@type': 'Product',
      name: `${design.name} ${p.name}, ${team.name}, ${team.colors}`,
      description,
      image: imageUrl,
      color: team.colors,
      category: 'Apparel',
      brand: { '@type': 'Brand', name: 'This Is Our Year' },
      audience: { '@type': 'PeopleAudience', suggestedMinAge: p.audience === 'kids' ? 3 : 13 },
      offers: {
        '@type': 'AggregateOffer',
        url: pageUrl,
        priceCurrency: String(shop.catalog.currency).toUpperCase(),
        lowPrice: (Math.min(...prices) / 100).toFixed(2),
        highPrice: (Math.max(...prices) / 100).toFixed(2),
        offerCount: inStock.length,
        availability: 'https://schema.org/InStock',
        seller: { '@type': 'Organization', name: 'This Is Our Year', url: siteUrl },
      },
    });
  }
  if (!offers.length) return null;
  return offers.length === 1 ? { '@context': 'https://schema.org', ...offers[0] } : { '@context': 'https://schema.org', '@graph': offers };
}
