import test from 'node:test';
import assert from 'node:assert/strict';
import { data } from './fixtures.mjs';
import { counterFor, daysBetween, fullYearsBetween, todayIn } from '../src/lib/counter.js';

const { history } = data;
const dallas = (asOf) => counterFor('dallas', 'Dallas', history, asOf);

test('Dallas: the day before the anniversary is 29 full years', () => {
  assert.equal(dallas('2026-01-27').years, 29);
});
test('Dallas: the anniversary itself is 30', () => {
  assert.equal(dallas('2026-01-28').years, 30);
});
test('Dallas: October 10, 2026 is 30', () => {
  const c = dallas('2026-10-10');
  assert.equal(c.state, 'previous_winner');
  assert.equal(c.years, 30);
  assert.equal(c.text, "It's been 30 years since Dallas last won the big game. This is our year.");
});

test('a verified never-winner gets the "first" line and no number', () => {
  const c = counterFor('buffalo', 'Buffalo', history, '2026-10-10');
  assert.equal(c.state, 'never_won');
  assert.equal(c.years, null);
  assert.equal(c.text, 'Still chasing that first big-game win. This is our year.');
});

test('the defending champion comes from the latest finished season, not a hardcoded city', () => {
  const c = counterFor('seattle', 'Seattle', history, '2026-10-10');
  assert.equal(c.state, 'defending_champion');
  assert.equal(c.text, "Let's run it back.");
  assert.match(c.context, /2025 season/);

  // Change the record of who won last, and the same city is no longer "defending".
  const next = structuredClone(history);
  next.latestCompletedSeason = { season: 2026, championSlug: 'dallas', gameDate: '2027-02-14', verified: true };
  next.cities.dallas.lastWinDate = '2027-02-14';
  next.refreshBy = '2028-02-01';
  assert.equal(counterFor('seattle', 'Seattle', next, '2027-10-10').state, 'previous_winner');
  assert.equal(counterFor('seattle', 'Seattle', next, '2027-10-10').years, 1);
  assert.equal(counterFor('dallas', 'Dallas', next, '2027-10-10').state, 'defending_champion');
});

test('a recent winner who is not the defending champion never shows "0 years"', () => {
  const h = structuredClone(history);
  h.latestCompletedSeason.championSlug = 'denver';
  const c = counterFor('seattle', 'Seattle', h, '2026-10-10');
  assert.equal(c.state, 'recent_winner');
  assert.equal(c.text, 'Still celebrating. Ready for another.');
  assert.ok(!/\b0 years\b/.test(c.text));
});

test('one full year reads "1 year", not "1 years"', () => {
  const c = counterFor('philadelphia', 'Philadelphia', history, '2026-10-10');
  assert.equal(c.years, 1);
  assert.match(c.text, /1 year since/);
});

test('unknown, unverified or missing facts fall back to the line with no number', () => {
  const fallback = 'Still believing. Still our year.';
  const h = structuredClone(history);
  h.cities.chicago.verified = false;
  h.cities.denver.state = 'unknown';
  delete h.cities.miami;
  h.cities.detroit = { state: 'previous_winner', lastWinDate: 'not-a-date', verified: true };
  h.cities.houston = { state: 'previous_winner', lastWinDate: '2031-02-09', verified: true };
  for (const slug of ['chicago', 'denver', 'miami', 'detroit', 'houston', 'nowhere']) {
    const c = counterFor(slug, slug, h, '2026-10-10');
    assert.equal(c.state, 'unknown', slug);
    assert.equal(c.years, null, slug);
    assert.equal(c.text, fallback, slug);
  }
  assert.equal(counterFor('dallas', 'Dallas', history, 'garbage').text, fallback);
  assert.equal(counterFor('dallas', 'Dallas', null, '2026-10-10').text, fallback);
});

test('missing data never turns into a false "never won"', () => {
  const h = structuredClone(history);
  delete h.cities.dallas;
  assert.notEqual(counterFor('dallas', 'Dallas', h, '2026-10-10').state, 'never_won');
});

test('once the refresh date passes, no city shows a number until the file is updated', () => {
  for (const t of data.teams) {
    const c = counterFor(t.slug, t.name, history, history.refreshBy);
    assert.equal(c.state, 'unknown', t.slug);
  }
});

test('no city ever produces NaN or a negative count', () => {
  for (const asOf of ['2026-10-10', '2026-02-07', '2026-02-08', '2027-01-31', '1960-01-01']) {
    for (const t of data.teams) {
      const c = counterFor(t.slug, t.name, history, asOf);
      assert.ok(c.years === null || (Number.isInteger(c.years) && c.years >= 0), `${t.slug} ${asOf}`);
      assert.ok(!/NaN|undefined|-\d/.test(c.text + c.context), `${t.slug} ${asOf}`);
    }
  }
});

test('where a city name alone would be wrong, the line says "the team in these colors"', () => {
  assert.match(counterFor('las-vegas', 'Las Vegas', history, '2026-10-10').text, /since the team in these colors last won/);
  assert.match(counterFor('new-york-green', 'New York (Green)', history, '2026-10-10').text, /57 years since the team in these colors/);
});

test('full years between dates', () => {
  assert.equal(fullYearsBetween('1996-01-28', '2026-01-27'), 29);
  assert.equal(fullYearsBetween('1996-01-28', '2026-01-28'), 30);
  assert.equal(fullYearsBetween('2026-02-08', '2026-02-07'), null);
  assert.equal(fullYearsBetween('2026-02-30', '2027-01-01'), null);
});

test('today is worked out in the site timezone', () => {
  // 03:30 UTC on the 11th is still the 10th in New York.
  assert.equal(todayIn('America/New_York', new Date('2026-10-11T03:30:00Z')), '2026-10-10');
});

test('the banner at the top of the city page: the years big, the days in the line, and a short tag for the ticker', () => {
  const c = dallas('2026-10-10');
  assert.equal(c.banner.big, '30 years');
  assert.equal(c.days, 11213);
  assert.equal(c.banner.line, "since Dallas last won the big game, on January 28, 1996. That's 11,213 days. This is our year.");
  assert.equal(c.short, '30 years');

  const buffalo = counterFor('buffalo', 'Buffalo', history, '2026-10-10');
  assert.equal(buffalo.banner.big, 'Still waiting.');
  assert.equal(buffalo.banner.line, 'Buffalo has never won the big game. This is the year that changes.');
  assert.equal(buffalo.short, 'still waiting');

  const seattle = counterFor('seattle', 'Seattle', history, '2026-10-10');
  assert.equal(seattle.banner.big, 'Champions.');
  assert.match(seattle.banner.line, /^Won it on February 8, 2026\. \d+ days without a loss that mattered\. Run it back\.$/);
  assert.equal(seattle.short, 'champions');

  // A city with a "subject" says that instead of its name, and keeps its note.
  const vegas = counterFor('las-vegas', 'Las Vegas', history, '2026-10-10');
  assert.match(vegas.banner.line, /^since the team in these colors last won the big game, on January 22, 1984\./);
  assert.match(vegas.banner.line, /before the move to Las Vegas\.$/);

  // Nothing verified, nothing specific.
  const nowhere = counterFor('nowhere', 'Nowhere', history, '2026-10-10');
  assert.deepEqual(nowhere.banner, { big: 'Still believing.', line: 'Still our year.' });
  assert.equal(nowhere.short, 'believing');
});

test('daysBetween counts whole days, leap days included, and refuses a bad or backwards range', () => {
  assert.equal(daysBetween('1996-01-28', '2026-01-28'), 10958);
  assert.equal(daysBetween('2026-01-28', '2026-01-28'), 0);
  assert.equal(daysBetween('2026-01-29', '2026-01-28'), null);
  assert.equal(daysBetween('nope', '2026-01-28'), null);
});
