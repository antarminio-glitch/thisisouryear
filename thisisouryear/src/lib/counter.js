// "How long has it been?" The counter on each city page.
//
// It counts full years since that city's team last won pro football's
// championship game, from the date in src/data/history.json. It only ever
// shows a number when the fact is marked verified. When anything is missing,
// stale or doesn't add up, it falls back to a line with no number in it.
//
// Every result carries the same four things: `text` (one sentence, used on
// the share card), `context` (the date, in small print), `banner` (the big
// number and the line under it at the top of the city page) and `short`
// (two or three words for the ticker on the homepage).

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

// Whole days from one date to another, for people who are counting.
export function daysBetween(fromDate, asOfDate) {
  const a = parts(fromDate);
  const b = parts(asOfDate);
  if (!a || !b) return null;
  const days = Math.round((Date.UTC(b.y, b.mo - 1, b.d) - Date.UTC(a.y, a.mo - 1, a.d)) / 86400000);
  return days < 0 ? null : days;
}

export function longDate(dateString) {
  const p = parts(dateString);
  if (!p) return '';
  const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][p.mo - 1];
  return `${month} ${p.d}, ${p.y}`;
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const number = (n) => n.toLocaleString('en-US');

const UNKNOWN = {
  state: 'unknown',
  years: null,
  days: null,
  text: 'Still believing. Still our year.',
  context: '',
  banner: { big: 'Still believing.', line: 'Still our year.' },
  short: 'believing',
};

// Works out what a city's counter should say on a given day.
//   history   the contents of src/data/history.json
//   asOfDate  YYYY-MM-DD, in the site's timezone
export function counterFor(slug, cityName, history, asOfDate) {
  const record = history?.cities?.[slug];
  const today = parts(asOfDate);
  if (!record || !today || record.verified !== true) return structuredClone(UNKNOWN);

  // After the refresh date a new champion has been crowned, so every number
  // here could be wrong until someone updates the file. Say nothing specific.
  if (parts(history.refreshBy) && asOfDate >= history.refreshBy) return structuredClone(UNKNOWN);

  const subject = record.subject || cityName;

  if (record.state === 'never_won') {
    return {
      state: 'never_won',
      years: null,
      days: null,
      text: 'Still chasing that first big-game win. This is our year.',
      context: '',
      banner: { big: 'Still waiting.', line: `${capital(subject)} has never won the big game. This is the year that changes.` },
      short: 'still waiting',
    };
  }
  if (record.state !== 'previous_winner') return structuredClone(UNKNOWN);

  const years = fullYearsBetween(record.lastWinDate, asOfDate);
  const days = daysBetween(record.lastWinDate, asOfDate);
  if (years === null || days === null) return structuredClone(UNKNOWN);

  // The defending champion comes from the latest finished season on record,
  // not from a hardcoded city.
  const latest = history.latestCompletedSeason;
  const defending = latest?.verified === true && latest.championSlug === slug && latest.gameDate === record.lastWinDate;
  if (defending) {
    return {
      state: 'defending_champion',
      years,
      days,
      text: "Let's run it back.",
      context: `Champions of the ${latest.season} season. Won it on ${longDate(latest.gameDate)}.`,
      banner: { big: 'Champions.', line: `Won it on ${longDate(latest.gameDate)}. ${number(days)} days without a loss that mattered. Run it back.` },
      short: 'champions',
    };
  }
  if (years < 1) {
    return {
      state: 'recent_winner',
      years,
      days,
      text: 'Still celebrating. Ready for another.',
      context: `Last won on ${longDate(record.lastWinDate)}.`,
      banner: { big: 'Still celebrating.', line: `Won it on ${longDate(record.lastWinDate)}. Ready for another.` },
      short: 'still celebrating',
    };
  }

  const yearsWord = `${years} ${years === 1 ? 'year' : 'years'}`;
  return {
    state: 'previous_winner',
    years,
    days,
    text: `It's been ${years} ${years === 1 ? 'year' : 'years'} since ${subject} last won the big game. This is our year.`,
    context: [`Last won on ${longDate(record.lastWinDate)}.`, record.note].filter(Boolean).join(' '),
    banner: {
      big: yearsWord,
      line: [`since ${subject} last won the big game, on ${longDate(record.lastWinDate)}. That's ${number(days)} days. This is our year.`, record.note].filter(Boolean).join(' '),
    },
    short: yearsWord,
  };
}
