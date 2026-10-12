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
