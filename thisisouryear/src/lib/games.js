// This week's games, said in city names only.
//
// The site never names a team. The public scoreboard feed it reads does, so
// the feed's team codes are turned into the site's city slugs here and
// nothing else from the feed is kept: no names, no logos, no links. The feed
// address itself lives in the PUBLIC_GAMES_FEED setting (Netlify for the live
// site, the shell for a local build) and never in the repository. With no
// address set, the games strip and the "Next up" lines stay hidden.

export const FEED_CODES = {
  ARI: 'arizona',
  ATL: 'atlanta',
  BAL: 'baltimore',
  BUF: 'buffalo',
  CAR: 'carolina',
  CHI: 'chicago',
  CIN: 'cincinnati',
  CLE: 'cleveland',
  DAL: 'dallas',
  DEN: 'denver',
  DET: 'detroit',
  GB: 'green-bay',
  HOU: 'houston',
  IND: 'indianapolis',
  JAX: 'jacksonville',
  KC: 'kansas-city',
  LV: 'las-vegas',
  LAC: 'los-angeles-powder',
  LAR: 'los-angeles-royal',
  MIA: 'miami',
  MIN: 'minnesota',
  NE: 'new-england',
  NO: 'new-orleans',
  NYG: 'new-york-blue',
  NYJ: 'new-york-green',
  PHI: 'philadelphia',
  PIT: 'pittsburgh',
  SF: 'san-francisco',
  SEA: 'seattle',
  TB: 'tampa-bay',
  TEN: 'tennessee',
  WSH: 'washington',
};

const STATES = new Set(['pre', 'in', 'post']);

function side(competitor) {
  const slug = FEED_CODES[String(competitor?.team?.abbreviation ?? '').toUpperCase()];
  if (!slug) return null;
  const score = Number(competitor.score);
  return { slug, score: Number.isFinite(score) ? score : null };
}

// Turns the feed into a short list of games, earliest kickoff first. A game
// with a side the site doesn't know is left out.
export function gamesFromFeed(feed) {
  const events = Array.isArray(feed?.events) ? feed.events : [];
  const games = [];
  for (const event of events) {
    const comp = event?.competitions?.[0];
    const list = Array.isArray(comp?.competitors) ? comp.competitors : [];
    const home = side(list.find((c) => c?.homeAway === 'home'));
    const away = side(list.find((c) => c?.homeAway === 'away'));
    const kickoff = Date.parse(event?.date ?? comp?.date ?? '');
    if (!home || !away || !Number.isFinite(kickoff)) continue;
    const state = STATES.has(event?.status?.type?.state) ? event.status.type.state : 'pre';
    games.push({ kickoff: new Date(kickoff).toISOString(), state, home, away });
  }
  games.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const week = Number(feed?.week?.number);
  return { week: Number.isFinite(week) ? week : null, games };
}

export function gameFor(games, slug) {
  return games.find((g) => g.home.slug === slug || g.away.slug === slug) ?? null;
}

// The heading over the strip. Finals from a finished week still count.
export function stripLabel(games) {
  if (!games.length) return '';
  if (games.some((g) => g.state === 'in')) return 'Right now';
  if (games.every((g) => g.state === 'post')) return 'Last week';
  return 'This week';
}

// "Sun 8:15 PM", in the reader's own time unless a zone is given.
export function kickoffLabel(iso, { locale, timeZone } = {}) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone }).format(d).replace(',', '');
  } catch {
    return '';
  }
}

// One line for one city's page: what's next, what's on, or how it went.
export function nextUpLine(game, slug, names, opts) {
  if (!game) return 'Off this week. Rest up, then back to it.';
  const atHome = game.home.slug === slug;
  const us = atHome ? game.home : game.away;
  const them = atHome ? game.away : game.home;
  const name = names?.[them.slug] ?? them.slug;
  if (game.state === 'pre') {
    const when = kickoffLabel(game.kickoff, opts);
    return atHome ? `Next up: ${name} comes to town${when ? `, ${when}` : ''}.` : `Next up: at ${name}${when ? `, ${when}` : ''}.`;
  }
  if (game.state === 'in') return `Right now: ${atHome ? 'home against' : 'at'} ${name}, ${us.score ?? 0}-${them.score ?? 0}.`;
  if (us.score == null || them.score == null) return `Last time out: ${atHome ? 'home against' : 'at'} ${name}.`;
  if (us.score > them.score) return `Last time out: beat ${name} ${us.score}-${them.score}. Told you.`;
  if (us.score < them.score) return `Last time out: lost to ${name} ${them.score}-${us.score}. Still our year.`;
  return `Last time out: tied ${name} ${us.score}-${them.score}. Still our year.`;
}
