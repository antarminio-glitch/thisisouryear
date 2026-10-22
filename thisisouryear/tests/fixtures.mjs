// Shared test setup. Loads the real data files, plus a made-up "everything is
// in stock" catalog so the hoodie, kids and matching-set journeys can be
// tested before those products are really for sale.
//
// The made-up prices and sizes below exist only in tests. They never reach
// the site.
import fs from 'node:fs';
import Stripe from 'stripe';
import { createShop } from '../src/lib/shop-core.js';
import { memoryStorage } from '../src/server/storage.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));

export const data = {
  teams: read('teams.json'),
  catalog: read('catalog.json'),
  store: read('store.json'),
  palettes: read('palettes.json'),
  history: read('history.json'),
  stories: read('stories.json'),
};

export const realShop = () => createShop(data);
// The real catalog with bulk discounts switched on, for testing the tiers.
export const bulkShop = () => createShop({ ...data, catalog: { ...data.catalog, bulk: { ...data.catalog.bulk, enabled: true } } });

export function fixtureCatalog() {
  const catalog = structuredClone(data.catalog);
  // The site sells one slogan. This second design exists only in tests, so the
  // multi-design and campaign code keeps its coverage.
  catalog.designs.push({ id: 'wait-til-next-year', name: "Wait 'Til Next Year", lines: ["WAIT 'TIL", 'NEXT YEAR'], status: 'live', artworkVersion: 'TEST-ONLY' });
  const fill = (id, priceCents, sizes) => {
    const p = catalog.products.find((x) => x.id === id);
    Object.assign(p, {
      sellable: true,
      priceCents,
      designs: ['this-is-our-year', 'wait-til-next-year'],
      fulfillment: { provider: 'test-fixture', providerProductId: `TEST-${id}` },
      sizeChart: '/size-chart/',
      variants: sizes.map((size) => ({ size, extraCents: 0, inStock: true, providerVariantId: `TEST-${id}-${size}` })),
    });
  };
  fill('adult-hoodie', 4400, ['S', 'M', 'L', 'XL']);
  fill('kids-tee', 1500, ['YS', 'YM', 'YL']);
  fill('kids-hoodie', 3300, ['YS', 'YM', 'YL']);
  catalog.products.find((p) => p.id === 'adult-tee').designs.push('wait-til-next-year');
  // One size deliberately out of stock.
  catalog.products.find((p) => p.id === 'kids-tee').variants.find((v) => v.size === 'YL').inStock = false;
  return catalog;
}

export const fixtureShop = (storeOverrides = {}) => createShop({ ...data, catalog: fixtureCatalog(), store: { ...data.store, ...storeOverrides } });

// A stand-in for Stripe that records what it was asked to do.
export function fakeStripe() {
  const calls = [];
  const real = new Stripe('sk_test_unit_tests_only');
  const client = {
    calls,
    webhooks: real.webhooks,
    lineItems: [],
    checkout: {
      sessions: {
        create: async (params) => {
          calls.push(params);
          return { id: `cs_test_${calls.length}`, url: `https://checkout.stripe.com/c/pay/cs_test_${calls.length}` };
        },
        listLineItems: async () => ({ data: client.lineItems }),
      },
    },
  };
  return client;
}

export const post = (body, url = 'https://example.test/.netlify/functions/x', headers = {}) =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

export { memoryStorage };
