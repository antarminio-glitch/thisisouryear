// Checks the data files against each other before the site is built.
// Errors stop the build. Warnings are things worth knowing that don't break
// anything.

const HEX = /^#[0-9A-Fa-f]{6}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SURFACES = ['shirt', 'line1', 'line2', 'outline'];

export function validateData({ teams, palettes, catalog, store, history, stories }) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  // ---- cities
  const slugs = new Set();
  if (!Array.isArray(teams) || teams.length === 0) err('teams.json has no cities.');
  for (const t of teams ?? []) {
    const where = `teams.json "${t.slug ?? '?'}"`;
    if (!SLUG.test(t.slug ?? '')) err(`${where}: slug must be lowercase letters, numbers and dashes.`);
    if (slugs.has(t.slug)) err(`${where}: slug is used twice.`);
    slugs.add(t.slug);
    if (!t.name) err(`${where}: missing name.`);
    if (!t.colors) err(`${where}: missing the plain-English colors label.`);
    for (const s of SURFACES) {
      if (!HEX.test(t[s] ?? '')) err(`${where}: ${s} is ${JSON.stringify(t[s])}. Colors must look like #RRGGBB.`);
    }
    const rows = palettes?.colorways?.[t.slug]?.colors ?? [];
    for (const s of SURFACES) {
      const key = t.apply?.[s];
      if (key == null) continue;
      const row = rows.find((r) => r.key === key);
      if (!row) {
        err(`${where}: apply.${s} points at "${key}", which is not in that city's palette.`);
      } else if (!row.default) {
        err(`${where}: apply.${s} uses "${key}", an optional row. Optional rows are never part of the default colors. Set apply.${s} to null if you really want it.`);
      } else if (HEX.test(t[s] ?? '') && row.hex.toUpperCase() !== t[s].toUpperCase()) {
        warn(`${where}: ${s} is ${t[s]} but its palette color "${key}" is ${row.hex}. The site shows ${t[s]}. Set apply.${s} to null to mark it as a custom color.`);
      }
    }
  }
  if (teams?.length !== 32) warn(`teams.json has ${teams?.length ?? 0} cities. The full set is 32.`);

  // ---- palettes
  if (palettes) {
    const keys = new Set();
    for (const [slug, cw] of Object.entries(palettes.colorways ?? {})) {
      if (!slugs.has(slug)) err(`palettes.json has a palette for "${slug}", which is not a city.`);
      for (const c of cw.colors ?? []) {
        if (keys.has(c.key)) err(`palettes.json: color key "${c.key}" is used twice.`);
        keys.add(c.key);
        if (!HEX.test(c.hex ?? '')) err(`palettes.json "${c.key}": malformed HEX ${JSON.stringify(c.hex)}.`);
        if (c.default !== (cw.defaults ?? []).includes(c.key)) {
          err(`palettes.json "${c.key}": its default flag and the city's default list disagree.`);
        }
      }
      for (const key of cw.defaults ?? []) {
        if (!(cw.colors ?? []).some((c) => c.key === key)) err(`palettes.json "${slug}": default "${key}" does not exist.`);
      }
    }
    for (const slug of slugs) {
      if (!palettes.colorways?.[slug]) err(`palettes.json has no palette for "${slug}". Run the color import again.`);
    }
  }

  // ---- catalog
  const designIds = new Set();
  for (const d of catalog?.designs ?? []) {
    if (designIds.has(d.id)) err(`catalog.json: design "${d.id}" is listed twice.`);
    designIds.add(d.id);
    if (!Array.isArray(d.lines) || d.lines.length !== 2) err(`catalog.json design "${d.id}": needs exactly two lines of lettering.`);
    if (!['live', 'concept'].includes(d.status)) err(`catalog.json design "${d.id}": status must be "live" or "concept".`);
  }
  const productIds = new Set();
  for (const p of catalog?.products ?? []) {
    const where = `catalog.json product "${p.id}"`;
    if (productIds.has(p.id)) err(`${where}: listed twice.`);
    productIds.add(p.id);
    if (!['tee', 'hoodie'].includes(p.style)) err(`${where}: style must be "tee" or "hoodie".`);
    if (!['adult', 'kids'].includes(p.audience)) err(`${where}: audience must be "adult" or "kids".`);
    const sizes = new Set();
    for (const v of p.variants ?? []) {
      if (sizes.has(v.size)) err(`${where}: size "${v.size}" is listed twice.`);
      sizes.add(v.size);
      if (!Number.isInteger(v.extraCents ?? 0) || (v.extraCents ?? 0) < 0) err(`${where} size "${v.size}": extraCents must be a whole number of cents.`);
    }
    for (const id of p.designs ?? []) {
      if (!designIds.has(id)) err(`${where}: design "${id}" does not exist.`);
    }
    if (p.sellable === true) {
      if (!Number.isInteger(p.priceCents) || p.priceCents <= 0) err(`${where}: marked sellable but has no price. Set priceCents, or set sellable to false.`);
      if (!(p.variants ?? []).length) err(`${where}: marked sellable but has no sizes. Add variants, or set sellable to false.`);
      if (!(p.designs ?? []).length) err(`${where}: marked sellable but has no designs.`);
      const live = (p.designs ?? []).some((id) => catalog.designs.find((d) => d.id === id)?.status === 'live');
      if (!live) err(`${where}: marked sellable but none of its designs is live.`);
      if (!p.fulfillment?.provider) err(`${where}: marked sellable but has no fulfillment provider. Use "manual" if you forward orders by hand.`);
    } else if (p.priceCents != null) {
      warn(`${where}: has a price but is not sellable, so the price is never shown.`);
    }
  }
  const tierMins = new Set();
  for (const t of catalog?.bulk?.tiers ?? []) {
    if (!Number.isInteger(t.minQuantity) || !Number.isInteger(t.percentOff)) err('catalog.json bulk tier: needs whole-number minQuantity and percentOff.');
    else if (t.minQuantity < 2) err(`catalog.json bulk tier: minQuantity ${t.minQuantity} is too small. A bulk tier starts at 2 or more.`);
    else if (t.percentOff < 1 || t.percentOff > 90) err(`catalog.json bulk tier at ${t.minQuantity}: percentOff has to be between 1 and 90.`);
    if (tierMins.has(t.minQuantity)) err(`catalog.json bulk tiers: two tiers start at ${t.minQuantity}.`);
    tierMins.add(t.minQuantity);
  }
  const sortedTiers = [...(catalog?.bulk?.tiers ?? [])].sort((a, b) => a.minQuantity - b.minQuantity);
  for (let i = 1; i < sortedTiers.length; i++) {
    if (sortedTiers[i].percentOff <= sortedTiers[i - 1].percentOff) err('catalog.json bulk tiers: a bigger order has to get a bigger discount.');
  }

  // ---- store settings
  for (const k of ['shippingCents', 'maxQuantity', 'maxOrderQuantity', 'maxCartLines', 'shipMinDays', 'shipMaxDays', 'noteMaxLength', 'leagueNameMaxLength']) {
    if (!Number.isInteger(store?.[k]) || store[k] < 0) err(`store.json: ${k} must be a whole number.`);
  }
  if (!store?.contactEmail) err('store.json: contactEmail is missing.');

  // ---- title history
  if (history) {
    const latest = history.latestCompletedSeason;
    if (!DATE.test(history.refreshBy ?? '')) err('history.json: refreshBy must be a date like 2027-02-14.');
    if (latest?.verified === true) {
      if (!slugs.has(latest.championSlug)) err(`history.json: latest champion "${latest.championSlug}" is not a city.`);
      if (!DATE.test(latest.gameDate ?? '')) err('history.json: latestCompletedSeason.gameDate must be a date.');
      const champ = history.cities?.[latest.championSlug];
      if (champ && champ.lastWinDate !== latest.gameDate) {
        err(`history.json: the latest champion's last win (${champ.lastWinDate}) doesn't match the latest game date (${latest.gameDate}).`);
      }
    }
    for (const slug of slugs) {
      const r = history.cities?.[slug];
      if (!r) {
        warn(`history.json has no record for "${slug}". Its page shows the no-number line.`);
        continue;
      }
      if (!['previous_winner', 'never_won', 'unknown'].includes(r.state)) err(`history.json "${slug}": state must be previous_winner, never_won or unknown.`);
      if (r.state === 'previous_winner') {
        if (!DATE.test(r.lastWinDate ?? '')) err(`history.json "${slug}": previous_winner needs a lastWinDate.`);
        else if (latest?.gameDate && r.lastWinDate > latest.gameDate) err(`history.json "${slug}": last win is after the latest game on record.`);
      }
      if (r.state === 'never_won' && r.lastWinDate) err(`history.json "${slug}": never_won can't have a lastWinDate.`);
      if (r.state !== 'unknown' && r.verified !== true) warn(`history.json "${slug}": not marked verified, so its page shows the no-number line.`);
    }
  }

  // ---- stories
  if (stories) {
    const heads = new Set();
    const bodies = new Set();
    for (const slug of slugs) {
      const s = stories[slug];
      if (!s?.headline || !s?.story || !s?.occasion) {
        err(`stories.json: "${slug}" needs a headline, a story and an occasion.`);
        continue;
      }
      if (heads.has(s.headline)) err(`stories.json: the headline for "${slug}" is used on another city too. Each page needs its own.`);
      if (bodies.has(s.story)) err(`stories.json: the story for "${slug}" is used on another city too.`);
      heads.add(s.headline);
      bodies.add(s.story);
    }
  }

  return { errors, warnings };
}
