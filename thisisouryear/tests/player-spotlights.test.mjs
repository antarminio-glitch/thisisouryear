import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { visibleSpotlights } from '../src/lib/player-spotlights.js';
const read = name => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}.json`,import.meta.url)));
const data = read('player-spotlights');
const teams = read('teams');
const today = '2026-10-13';

test('every city has one dated, sourced star selection', () => {
  assert.deepEqual(Object.keys(data.entries).sort(), teams.map(t=>t.slug).sort());
  assert.equal(new Set(Object.values(data.entries).map(p=>p.name)).size,32);
  for (const p of Object.values(data.entries)) {
    assert.match(p.sourceUrl,/^https:\/\/[^/]+\/team\/players-roster\/$/);
    assert.ok(p.name && p.position && p.blurb && p.verifiedAt && p.reviewAfter);
    assert.ok(!p.image && !p.photo, 'no athlete photograph is used');
  }
  assert.equal(data.entries.cleveland.name,'Denzel Ward');
  assert.match(data.entries.miami.rosterNote,/injured reserve/);
});

test('draft spotlights stay off production and appear in explicit previews', () => {
  assert.deepEqual(visibleSpotlights(data,{today}),{});
  assert.equal(Object.keys(visibleSpotlights(data,{today,preview:true})).length,32);
  const enabled={...data,enabled:true};
  assert.deepEqual(visibleSpotlights(enabled,{today}),{},'publication also needs rights status recorded');
  const cleared={...enabled,rightsStatus:'cleared'};
  assert.equal(Object.keys(visibleSpotlights(cleared,{today})).length,32);
  assert.deepEqual(visibleSpotlights(cleared,{}),{},'undated publication cannot imply current roster data');
});

test('stale or future-dated selections are hidden publicly and marked in previews', () => {
  const cleared={...data,enabled:true,rightsStatus:'cleared'};
  assert.deepEqual(visibleSpotlights(cleared,{today:'2026-11-13'}),{});
  assert.deepEqual(visibleSpotlights(cleared,{today:'2026-10-12'}),{});
  assert.equal(visibleSpotlights(data,{preview:true,today:'2026-11-13'}).dallas.needsReview,true);
  const invalid={...data,entries:{dallas:{...data.entries.dallas,sourceUrl:'javascript:alert(1)'}}};
  assert.deepEqual(visibleSpotlights(invalid,{preview:true,today}),{});
});
