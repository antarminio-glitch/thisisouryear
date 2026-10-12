// The 2026 season layer: a banner, a slogan for every city, and history that
// is only shown when someone has checked it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { data } from './fixtures.mjs';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const season = read('season-2026.json');
const history = read('history.json');

// Team names never appear on the site; the site-wide naming test in tests/site covers every file, this one included.

test('the banner has a kicker, a line and a note', () => {
  assert.equal(season.season, 2026);
  for (const k of ['kicker', 'line', 'note']) assert.ok(typeof season.banner[k] === 'string' && season.banner[k].length > 0, k);
  assert.match(season.banner.kicker, /2026/);
});

test('every city has a short slogan in the site’s voice, with no team names in it', () => {
  for (const t of data.teams) {
    const s = season.cities[t.slug]?.slogan;
    assert.ok(typeof s === 'string' && s.length > 0, `${t.slug} has no slogan`);
    assert.ok(s.length <= 90, `${t.slug} slogan is too long (${s.length})`);
  }
  for (const slug of Object.keys(season.cities)) assert.ok(data.teams.some((t) => t.slug === slug), `${slug} is not a city`);
});

test('history is shown only when verified, says where it was checked, and agrees with history.json', () => {
  for (const [slug, c] of Object.entries(season.cities)) {
    if (!c.history) continue;
    const h = c.history;
    assert.equal(typeof h.verified, 'boolean', `${slug} history.verified`);
    assert.ok(Array.isArray(h.facts) && h.facts.length > 0, `${slug} history.facts`);
    if (h.verified) {
      assert.match(h.verifiedOn, /^\d{4}-\d{2}-\d{2}$/, `${slug} history.verifiedOn`);
      assert.ok(typeof h.source === 'string' && h.source.length > 10, `${slug} history.source`);
      // If the city has a verified last win, the history must mention that date.
      const rec = history.cities[slug];
      if (rec?.verified && rec.lastWinDate) {
        const [y, m, d] = rec.lastWinDate.split('-').map(Number);
        const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1];
        assert.ok(h.facts.some((f) => f.includes(`${month} ${d}, ${y}`)), `${slug} history should mention the last win on ${month} ${d}, ${y}`);
      }
    }
  }
  assert.ok(season.cities.dallas.history?.verified, 'Dallas, the default preview, has verified history');
});
