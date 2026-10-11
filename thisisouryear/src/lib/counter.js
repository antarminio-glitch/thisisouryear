// "How long has it been?" The counter on each city page.
//
// It counts full years since that city's team last won pro football's
// championship game, from the date in src/data/history.json. It only ever
// shows a number when the fact is marked verified. When anything is missing,
// stale or doesn't add up, it falls back to a line with no number in it.

export const SITE_TIMEZONE = 'America/New_York';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(dateString) {
  const m = DATE.exec(String(dateString ?? ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return { y, mo, d };
}

// Today's date in the site's timezone, as YYYY-MM-DD.
export function todayIn(timeZone = SITE_TIMEZONE, now = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(now);
}

// Full calendar years from one date to another. Before the anniversary, the
// year in progress doesn't count. Returns null if either date is bad or the
// start is after the end.
export function fullYearsBetween(fromDate, asOfDate) {
  const a = parts(fromDate);
  const b = parts(asOfDate);
  if (!a || !b) return null;
  let years = b.y - a.y;
  if (b.mo < a.mo || (b.mo === a.mo && b.d < a.d)) years -= 1;
  return years < 0 ? null : years;
}

export function longDate(dateString) {
  const p = parts(dateString);
  if (!p) return '';
  const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][p.mo - 1];
  return `${month} ${p.d}, ${p.y}`;
}

const UNKNOWN = { state: 'unknown', years: null, text: 'Still believing. Still our year.', context: '' };

// Works out what a city's counter should say on a given day.
//   history   the contents of src/data/history.json
//   asOfDate  YYYY-MM-DD, in the site's timezone
export function counterFor(slug, cityName, history, asOfDate) {
  const record = history?.cities?.[slug];
  const today = parts(asOfDate);
  if (!record || !today || record.verified !== true) return { ...UNKNOWN };

  // After the refresh date a new champion has been crowned, so every number
  // here could be wrong until someone updates the file. Say nothing specific.
  if (parts(history.refreshBy) && asOfDate >= history.refreshBy) return { ...UNKNOWN };

  if (record.state === 'never_won') {
    return { state: 'never_won', years: null, text: 'Still chasing that first big-game win. This is our year.', context: '' };
  }
  if (record.state !== 'previous_winner') return { ...UNKNOWN };

  const years = fullYearsBetween(record.lastWinDate, asOfDate);
  if (years === null) return { ...UNKNOWN };

  // The defending champion comes from the latest finished season on record,
  // not from a hardcoded city.
  const latest = history.latestCompletedSeason;
  const defending = latest?.verified === true && latest.championSlug === slug && latest.gameDate === record.lastWinDate;
  if (defending) {
    return {
      state: 'defending_champion',
      years,
      text: "Let's run it back.",
      context: `Champions of the ${latest.season} season. Won it on ${longDate(latest.gameDate)}.`,
    };
  }
  if (years < 1) {
    return { state: 'recent_winner', years, text: 'Still celebrating. Ready for another.', context: `Last won on ${longDate(record.lastWinDate)}.` };
  }

  const subject = record.subject || cityName;
  return {
    state: 'previous_winner',
    years,
    text: `It's been ${years} ${years === 1 ? 'year' : 'years'} since ${subject} last won the big game. This is our year.`,
    context: [`Last won on ${longDate(record.lastWinDate)}.`, record.note].filter(Boolean).join(' '),
  };
}
