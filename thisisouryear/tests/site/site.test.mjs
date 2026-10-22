// Checks the finished site, the way a visitor or a search engine sees it.
// Run "npm run build" first. "npm run verify" does both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = path.join(root, 'dist');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', file), 'utf8'));
const teams = read('teams.json');
const catalog = read('catalog.json');
const SITE = 'https://thisisouryear.team';
const DISCLAIMER = 'This Is Our Year is an independent brand. It is not affiliated with, licensed by, or endorsed by any professional football league or team.';

assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'The site has not been built. Run "npm run build" first.');

const page = (route) => fs.readFileSync(path.join(dist, route, 'index.html'), 'utf8');
const decode = (s) => s.replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const pick = (html, re) => decode(html.match(re)?.[1] ?? '');
const title = (html) => pick(html, /<title>([^<]*)<\/title>/);
const description = (html) => pick(html, /<meta name="description" content="([^"]*)"/);
const canonical = (html) => pick(html, /<link rel="canonical" href="([^"]*)"/);
const ogImage = (html) => pick(html, /<meta property="og:image" content="([^"]*)"/);
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const isNoindex = (html) => /<meta name="robots" content="noindex"/.test(html);
const text = (html) => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

function htmlRoutes(dir = dist, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...htmlRoutes(path.join(dir, e.name), `${base}/${e.name}`));
    else if (e.name === 'index.html') out.push(`${base}/`);
  }
  return out;
}
const routes = htmlRoutes();
const sellable = catalog.products.filter((p) => p.sellable === true);
const minCents = Math.min(...sellable.flatMap((p) => p.variants.filter((v) => v.inStock).map((v) => p.priceCents + (v.extraCents ?? 0))));

test('every city has its own page', () => {
  assert.equal(teams.length, 32);
  for (const t of teams) assert.ok(fs.existsSync(path.join(dist, t.slug, 'index.html')), `No page for ${t.slug}`);
});

test('city pages have their own title, description, address and share picture', () => {
  const seen = { title: new Map(), description: new Map(), image: new Map(), headline: new Map() };
  for (const t of teams) {
    const html = page(t.slug);
    const facts = { title: title(html), description: description(html), image: ogImage(html), headline: pick(html, /<h2 id="story-h"[^>]*>([^<]*)<\/h2>/) };
    for (const [k, v] of Object.entries(facts)) {
      assert.ok(v, `${t.slug} has no ${k}`);
      assert.ok(!seen[k].has(v), `${t.slug} and ${seen[k].get(v)} share the same ${k}`);
      seen[k].set(v, t.slug);
    }
    assert.equal(canonical(html), `${SITE}/${t.slug}/`);
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, `${t.slug} should have exactly one main heading`);
    assert.ok(facts.description.length <= 200, `${t.slug} description is ${facts.description.length} characters`);
    const file = path.join(dist, new URL(facts.image).pathname);
    assert.ok(fs.existsSync(file), `${t.slug}: share picture ${facts.image} was not built`);
    assert.ok(fs.statSync(file).size > 5000, `${t.slug}: share picture looks empty`);
    assert.ok(!isNoindex(html), `${t.slug} is hidden from search engines`);
  }
});

test('search engines are only told about things that can really be bought', () => {
  const notForSale = catalog.products.filter((p) => p.sellable !== true).map((p) => p.name);
  const concepts = catalog.designs.filter((d) => d.status !== 'live').map((d) => d.name);
  for (const route of routes) {
    const blocks = jsonLd(page(route));
    const isCity = teams.some((t) => route === `/${t.slug}/`);
    if (!isCity) {
      assert.equal(blocks.length, 0, `${route} publishes product data but is not a product page`);
      continue;
    }
    assert.equal(blocks.length, sellable.length ? 1 : 0, `${route}`);
    for (const block of blocks) {
      const products = block['@graph'] ?? [block];
      assert.equal(products.length, sellable.length);
      for (const p of products) {
        for (const name of [...notForSale, ...concepts]) assert.ok(!p.name.includes(name), `${route} advertises "${name}", which is not for sale`);
        assert.equal(p.offers.priceCurrency, 'USD');
        assert.ok(Number(p.offers.lowPrice) * 100 >= minCents - 0.5, `${route} advertises a price below the catalog`);
        assert.equal(p.offers.url, `${SITE}${route}`);
        assert.ok(!('aggregateRating' in p) && !('review' in p), `${route} publishes ratings that do not exist`);
      }
    }
  }
});

test('items that are not for sale show no price anywhere on a city page', () => {
  if (catalog.products.every((p) => p.sellable === true)) return;
  const allowed = new Set(sellable.flatMap((p) => p.variants.map((v) => ((p.priceCents + (v.extraCents ?? 0)) / 100).toFixed(2))));
  const store = read('store.json');
  // The shipping fee and the free-shipping minimum are prices too.
  for (const cents of [store.shippingCents, store.freeShippingMinCents]) if (cents) allowed.add((cents / 100).toFixed(2));
  for (const t of teams) {
    for (const m of text(page(t.slug)).matchAll(/\$(\d+\.\d{2})/g)) {
      assert.ok(allowed.has(m[1]), `${t.slug} shows $${m[1]}, which is not a catalog price`);
    }
  }
});

test('the sitemap lists the pages worth finding and leaves out the private ones', () => {
  const xml = fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8');
  const listed = new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname));
  for (const t of teams) assert.ok(listed.has(`/${t.slug}/`), `sitemap is missing ${t.slug}`);
  for (const p of ['/', '/teams/', '/shop/', '/gifts/rival-colors/', '/matching-sets/', '/fantasy-leagues/', '/bandwagon/', '/fans/']) assert.ok(listed.has(p), `sitemap is missing ${p}`);
  for (const p of ['/cart/', '/admin/', '/success/', '/cancel/']) assert.ok(!listed.has(p), `sitemap should not list ${p}`);
  for (const p of listed) {
    assert.ok(routes.includes(p), `sitemap lists ${p}, which was not built`);
    assert.ok(!isNoindex(page(p)), `sitemap lists ${p}, which is hidden from search engines`);
  }
});

test('private pages are hidden from search engines', () => {
  for (const p of ['cart', 'admin', 'success', 'cancel']) assert.ok(isNoindex(page(p)), `/${p}/ should be noindex`);
});

test('every page carries the independence disclaimer and a title', () => {
  for (const route of routes) {
    const html = page(route);
    assert.ok(text(html).includes(DISCLAIMER), `${route} is missing the disclaimer`);
    assert.ok(title(html), `${route} has no title`);
    assert.ok(description(html), `${route} has no description`);
  }
});

test('page titles and addresses are unique across the whole site', () => {
  const titles = new Map();
  const canon = new Map();
  for (const route of routes) {
    const html = page(route);
    if (isNoindex(html)) continue;
    assert.ok(!titles.has(title(html)), `${route} and ${titles.get(title(html))} share a title`);
    titles.set(title(html), route);
    assert.equal(canonical(html), `${SITE}${route}`);
    assert.ok(!canon.has(canonical(html)));
    canon.set(canonical(html), route);
  }
});

// ---- the naming rule
//
// The site may never use a team name, a team nickname, a league name or the
// name of a league event. This looks for them in everything that gets
// published and everything in the project. The words themselves are stored
// scrambled, so this file doesn't contain them either.
const BANNED = new Set(["0022c2b0154ad3230b64", "0891c16c29f2eecc4eab", "0c828f3401e6fd0dfd26", "130df39ba59661989f52", "14e52c8b115e879eb26d", "1df2fb9a60847963dfb2", "28a9b05505955b4771c8", "37c8219fef884194fad3", "37e15d473fe3a729b477", "3e4c6ee9b86f041e9906", "3e4f0034902dc9f5d7ca", "406debcdb84832e0f953", "501e417cc5e476cfb588", "504a0b89e7e6ac2fdfe7", "5e7d12fffdb03789be45", "69ccb306c3331e091d6e", "702f651f77ad39dd6619", "761253c5acf02beed6db", "76457884871494b902e6", "7698dbd57d50d391729e", "7a6e1ec5c769d1ed7f98", "82317ec8c2286bb0c04a", "86b607bce3156003aa6b", "86c6fc4d7650f888bffd", "86e368d922c678013467", "88f311aaf4b2b87f189d", "8a116606b24989b69173", "936ed9da3c5ae832631a", "941f09ed90c467bb5c72", "99b90e6f5d05e3c82fca", "9b77ef08ed7d7fa515f1", "a5d86062335cc0484e02", "a780a34801c3252f93a0", "af9dcb903fbbeaa5b77b", "b1afd6276bd3c12ea763", "b254e40d6b1c29745ea3", "b8f897f735d0126be1fd", "c01e0e33301ba720b068", "c2c552a28dbe8cee39d0", "d0394642b27a0eee0ed3", "da401e20fdcbaabd5d13", "db8c347fed89108c479b", "dbae03fface61910e348", "dccf87a7f3fd30d79158", "e16a7affad905cce46b5", "e21c637ca20f1fbf57e2", "ea10e2b948beaa7401bd", "eac387d54c45adb0baf3", "f1f2fad40f6afe943119", "f696934c71097dcb3247", "fe363614c77c6e7b8bed"]);
const scramble = (s) => createHash('sha256').update(`tioy:${s}`).digest('hex').slice(0, 20);
const TEXT_FILE = /\.(astro|js|mjs|ts|json|css|md|toml|txt|html|xml|svg|example)$|^\.gitignore$|^\.env/;
const SKIP_DIRS = new Set(['node_modules', '.git', '.astro', '.netlify']);

function bannedIn(content) {
  const tokens = content.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const hits = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let n = 1; n <= 3 && i + n <= tokens.length; n++) {
      if (BANNED.has(scramble(tokens.slice(i, i + n).join(' ')))) hits.push(tokens.slice(Math.max(0, i - 3), i + n + 3).join(' '));
    }
  }
  return hits;
}
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    out.push({ full, name: e.name, dir: e.isDirectory() });
    if (e.isDirectory()) walk(full, out);
  }
  return out;
}

test('no team, league or league-event names anywhere in the project or the built site', () => {
  const problems = [];
  let scanned = 0;
  for (const entry of walk(root)) {
    const rel = path.relative(root, entry.full);
    for (const hit of bannedIn(entry.name)) problems.push(`${rel} (file name): ...${hit}...`);
    if (entry.dir || entry.name === 'package-lock.json' || !TEXT_FILE.test(entry.name)) continue;
    scanned++;
    for (const hit of bannedIn(fs.readFileSync(entry.full, 'utf8'))) problems.push(`${rel}: ...${hit}...`);
  }
  assert.ok(scanned > 100, `Only ${scanned} files were scanned, so something is off with this check.`);
  assert.deepEqual(problems.slice(0, 20), [], 'Found a name the site is not allowed to use. Say the city and the colors instead.');
});

test('the city page "About" block starts on the tee and has what it needs to follow the picker', () => {
  const html = page('dallas');
  const block = html.match(/<section class="details-block"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.ok(block.includes('data-about'), 'the About block is marked for the picker to update');
  for (const attr of ['data-about-name', 'data-about-fabric', 'data-about-fit', 'data-about-care', 'data-about-chart']) assert.ok(block.includes(attr), attr);
  assert.ok(text(block).includes('About the tee'), 'starts on the tee');
  assert.ok(text(block).includes('5.4-ounce, 100% cotton'), 'shows the tee fabric');
  // The data block carries fabric, fit and care for every garment that is for sale.
  const data = JSON.parse(html.match(/<script type="application\/json" id="shop-data">([\s\S]*?)<\/script>/)[1]);
  for (const p of sellable) {
    for (const k of ['fabric', 'fit', 'care']) assert.ok(typeof data.specs?.[p.id]?.[k] === 'string' && data.specs[p.id][k].length > 0, `${p.id}.${k} is in the data block`);
  }
});

test('the homepage sizes line covers adults and kids', () => {
  const t = text(page(''));
  const adult = catalog.products.find((p) => p.id === 'adult-tee').variants.map((v) => v.size);
  const kids = catalog.products.find((p) => p.id === 'kids-tee');
  if (kids?.sellable) assert.ok(t.includes(`Adults ${adult[0]} through ${adult.at(-1)}, kids ${kids.variants[0].size} through ${kids.variants.at(-1).size}.`), 'adult and kids sizes');
  else assert.ok(t.includes(`${adult[0]} through ${adult.at(-1)}.`), 'adult sizes');
});

// The print files Printify downloads: one per city for each design on sale,
// transparent, and the shape the placement math expects.
test('every city has a print file for each design on sale', () => {
  const printify = read('printify.json');
  const live = catalog.designs.filter((d) => d.status === 'live');
  const files = fs.readdirSync(path.join(dist, 'print')).filter((f) => f.endsWith('.png'));
  assert.equal(files.length, teams.length * live.length);
  for (const team of teams) {
    for (const design of live) {
      const name = files.find((f) => new RegExp(`^${team.slug}-${design.id}-[0-9a-f]{8}\\.png$`).test(f));
      assert.ok(name, `No print file for ${team.slug} ${design.id}`);
      const png = fs.readFileSync(path.join(dist, 'print', name));
      assert.equal(png.subarray(1, 4).toString(), 'PNG', name);
      const width = png.readUInt32BE(16);
      const height = png.readUInt32BE(20);
      assert.equal(png[25], 6, `${name} needs a transparent background`);
      assert.ok(width >= 3000, `${name} is only ${width}px wide`);
      const aspect = printify.designs[design.id].aspect;
      assert.ok(Math.abs(height / width - aspect) < 0.01, `${name} is ${width}x${height}; printify.json expects height/width ${aspect}`);
    }
  }
});
