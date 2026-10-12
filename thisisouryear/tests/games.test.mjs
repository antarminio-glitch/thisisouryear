// This week's games, from a made-up feed shaped like the real one. The feed
// below carries only what the site reads: a code, a side, a score, a time
// and a state. No names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FEED_CODES, gamesFromFeed, gameFor, stripLabel, kickoffLabel, nextUpLine } from '../src/lib/games.js';
import { data } from './fixtures.mjs';

const event = (away, home, date, state, scores = [null, null]) => ({
  date,
  status: { type: { state } },
  competitions: [
    {
      competitors: [
        { homeAway: 'home', score: scores[1] === null ? undefined : String(scores[1]), team: { abbreviation: home } },
        { homeAway: 'away', score: scores[0] === null ? undefined : String(scores[0]), team: { abbreviation: away } },
      ],
    },
  ],
});

const feed = {
  week: { number: 5 },
  events: [
    event('DAL', 'TB', '2026-10-18T20:25Z', 'pre'),
    event('BUF', 'LAR', '2026-10-13T00:15Z', 'pre'),
    event('NYJ', 'CLE', '2026-10-18T17:00Z', 'post', [17, 24]),
    event('XXX', 'SEA', '2026-10-18T17:00Z', 'pre'),
  ],
};
const names = Object.fromEntries(data.teams.map((t) => [t.slug, t.name.replace(/\s*\(.*\)$/, '')]));

test('every city on the site has a feed code, and every code points at a city', () => {
  const slugs = new Set(data.teams.map((t) => t.slug));
  assert.deepEqual(new Set(Object.values(FEED_CODES)), slugs);
  assert.equal(Object.keys(FEED_CODES).length, data.teams.length);
});

test('the feed becomes games in city slugs, earliest first; a side the site does not know drops the game', () => {
  const { week, games } = gamesFromFeed(feed);
  assert.equal(week, 5);
  assert.deepEqual(
    games.map((g) => `${g.away.slug}@${g.home.slug}:${g.state}`),
    ['buffalo@los-angeles-royal:pre', 'new-york-green@cleveland:post', 'dallas@tampa-bay:pre'],
  );
  assert.deepEqual(games[1].home, { slug: 'cleveland', score: 24 });
  assert.deepEqual(games[2].away, { slug: 'dallas', score: null });
  assert.deepEqual(gamesFromFeed({}), { week: null, games: [] });
  assert.deepEqual(gamesFromFeed(null), { week: null, games: [] });
});

test('the strip label follows the week: upcoming, live, or all finals', () => {
  const { games } = gamesFromFeed(feed);
  assert.equal(stripLabel(games), 'This week');
  assert.equal(stripLabel(games.map((g) => ({ ...g, state: 'post' }))), 'Last week');
  assert.equal(stripLabel([{ ...games[0], state: 'in' }, games[1]]), 'Right now');
  assert.equal(stripLabel([]), '');
});

test('kickoff reads as a short weekday and a local time', () => {
  assert.equal(kickoffLabel('2026-10-18T20:25Z', { locale: 'en-US', timeZone: 'America/New_York' }), 'Sun 4:25 PM');
  assert.equal(kickoffLabel('nope'), '');
});

test('the "Next up" line on a city page', () => {
  const { games } = gamesFromFeed(feed);
  const opts = { locale: 'en-US', timeZone: 'America/New_York' };
  assert.equal(nextUpLine(gameFor(games, 'dallas'), 'dallas', names, opts), 'Next up: at Tampa Bay, Sun 4:25 PM.');
  assert.equal(nextUpLine(gameFor(games, 'tampa-bay'), 'tampa-bay', names, opts), 'Next up: Dallas comes to town, Sun 4:25 PM.');
  assert.equal(nextUpLine(gameFor(games, 'cleveland'), 'cleveland', names, opts), 'Last time out: beat New York 24-17. Told you.');
  assert.equal(nextUpLine(gameFor(games, 'new-york-green'), 'new-york-green', names, opts), 'Last time out: lost to Cleveland 24-17. Still our year.');
  const live = { ...gameFor(games, 'dallas'), state: 'in', away: { slug: 'dallas', score: 14 }, home: { slug: 'tampa-bay', score: 10 } };
  assert.equal(nextUpLine(live, 'dallas', names, opts), 'Right now: at Tampa Bay, 14-10.');
  assert.equal(nextUpLine(null, 'kansas-city', names, opts), 'Off this week. Rest up, then back to it.');
});

import { makeGamesHandler } from '../src/server/games.js';

const get = (handler) => handler(new Request('https://example.test/.netlify/functions/games'));
const fakeFetch = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 503, json: async () => body });

test('the games function passes on slugs, scores and times, and nothing else from the feed', async () => {
  const handler = makeGamesHandler({ feedUrl: 'https://feed.example/x', fetchImpl: fakeFetch(feed) });
  const res = await get(handler);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Cache-Control'), /max-age=300/);
  const body = await res.json();
  assert.equal(body.week, 5);
  assert.equal(body.games.length, 3);
  assert.deepEqual(Object.keys(body.games[0]).sort(), ['away', 'home', 'kickoff', 'state']);
  assert.ok(!JSON.stringify(body).includes('abbreviation'), 'no feed codes reach the page');
});

test('the games function says "no games" with no setting, a feed that is down, or the wrong method', async () => {
  const none = { week: null, games: [] };
  assert.deepEqual(await (await get(makeGamesHandler({ feedUrl: '', fetchImpl: fakeFetch(feed) }))).json(), none);
  assert.deepEqual(await (await get(makeGamesHandler({ feedUrl: () => undefined, fetchImpl: fakeFetch(feed) }))).json(), none);
  assert.deepEqual(await (await get(makeGamesHandler({ feedUrl: 'https://feed.example/x', fetchImpl: fakeFetch({}, false) }))).json(), none);
  assert.deepEqual(await (await get(makeGamesHandler({ feedUrl: 'https://feed.example/x', fetchImpl: async () => { throw new Error('down'); } }))).json(), none);
  const post = await makeGamesHandler({ feedUrl: 'https://feed.example/x', fetchImpl: fakeFetch(feed) })(new Request('https://example.test/x', { method: 'POST' }));
  assert.equal(post.status, 405);
});

test('live games shorten the cache', async () => {
  const live = structuredClone(feed);
  live.events[0].status.type.state = 'in';
  const res = await get(makeGamesHandler({ feedUrl: 'https://feed.example/x', fetchImpl: fakeFetch(live) }));
  assert.match(res.headers.get('Cache-Control'), /max-age=45/);
});
