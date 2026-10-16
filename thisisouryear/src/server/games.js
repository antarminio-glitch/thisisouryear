// This week's games for the browser, with the names taken out.
//
// The site's pages never talk to the scoreboard feed. They ask this function,
// which reads the feed address from the GAMES_FEED setting in Netlify, fetches
// it, keeps only the city slugs, scores and kickoff times (see
// src/lib/games.js) and answers with those. The feed address never reaches a
// page or the repository. With no address, or a feed that is down, the answer
// is simply "no games", and the pages show nothing.
import { gamesFromFeed } from '../lib/games.js';

const NONE = { week: null, games: [] };

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

export function makeGamesHandler({ feedUrl = () => process.env.GAMES_FEED, fetchImpl = fetch } = {}) {
  return async (req) => {
    if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
    const url = typeof feedUrl === 'function' ? feedUrl() : feedUrl;
    if (!url) return json(NONE, 200, { 'Cache-Control': 'public, max-age=600' });
    try {
      const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      const parsed = gamesFromFeed(await res.json());
      // Scores move while games are on, so a short cache. Finals and kickoffs can wait longer.
      const live = parsed.games.some((g) => g.state === 'in');
      return json(parsed, 200, { 'Cache-Control': `public, max-age=${live ? 45 : 300}` });
    } catch {
      return json(NONE, 200, { 'Cache-Control': 'public, max-age=60' });
    }
  };
}
