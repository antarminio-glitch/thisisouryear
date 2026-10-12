// The 2026 season layer on the finished site. Run "npm run build" first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = path.join(root, 'dist');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', file), 'utf8'));
const season = read('season-2026.json');
const page = (route) => fs.readFileSync(path.join(dist, route, 'index.html'), 'utf8');
const decode = (s) => s.replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const text = (html) => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

test('the homepage carries the season banner and still asks for a city first', () => {
  const html = page('');
  const home = html.match(/<section class="picker"[^>]*id="home"[^>]*>/)?.[0] ?? '';
  assert.ok(!/data-city="[^"]+"/.test(home), 'no city is picked for the shopper');
  assert.ok(html.includes('stage-empty'), 'the "Pick your city" empty state stays');
  const t = text(html);
  assert.ok(t.includes(season.banner.kicker) && t.includes(season.banner.line) && t.includes(season.banner.note), 'season banner');
});

test('every city page shows the season tag and its slogan; Dallas shows verified history', () => {
  for (const [slug, c] of Object.entries(season.cities)) {
    const t = text(page(slug));
    assert.ok(t.includes(season.banner.kicker), `${slug}: season kicker`);
    assert.ok(t.includes(c.slogan), `${slug}: slogan`);
    if (c.history?.verified) {
      assert.ok(t.includes('How ') && t.includes(' got here'), `${slug}: history heading`);
      for (const f of c.history.facts) assert.ok(t.includes(f), `${slug}: history fact`);
      assert.ok(t.includes(`Checked ${c.history.verifiedOn}`), `${slug}: history check date`);
    } else {
      assert.ok(!t.includes(' got here'), `${slug}: no history section without verified facts`);
    }
  }
});

const teams = read('teams.json');

test('every city page opens with the wait banner and has a place for "Next up"', () => {
  for (const t of teams) {
    const html = page(t.slug);
    const banner = html.match(/<aside class="wait"[\s\S]*?<\/aside>/)?.[0] ?? '';
    assert.ok(banner, `${t.slug}: wait banner`);
    const big = text(banner.match(/<p class="wait-big"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '').trim();
    assert.ok(big.length > 0, `${t.slug}: the big line has something in it`);
    assert.ok(/data-week[^>]*data-city="[^"]+"/.test(banner) || /data-city="[^"]+"[^>]*data-week/.test(banner), `${t.slug}: next-up placeholder`);
    assert.ok(banner.includes(season.banner.kicker), `${t.slug}: season kicker`);
  }
  // Dallas is the worked example: thirty years, said big.
  assert.match(text(page('dallas')), /30 years since Dallas last won the big game, on January 28, 1996\. That's [\d,]+ days\. This is our year\./);
});

test('the homepage runs the ticker for every city and has room for this week', () => {
  const html = page('');
  const ticker = html.match(/<aside class="ticker"[\s\S]*?<\/aside>/)?.[0] ?? '';
  assert.ok(ticker, 'ticker');
  const first = ticker.match(/<ul class="ticker-list[^"]*"[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? '';
  for (const t of teams) assert.ok(first.includes(`href="/${t.slug}/"`), `${t.slug} is in the ticker`);
  assert.ok(/still waiting/i.test(text(first)) && /champions/i.test(text(first)), 'the ticker says who is waiting and who is champion');
  assert.ok(html.includes('data-week-games'), 'the games strip is on the page, hidden until the feed answers');
});
