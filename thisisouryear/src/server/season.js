// What we know about the current football season, city by city.
//
// Every fact here is entered by a person in the admin screen, with where it
// came from and when. Nothing is guessed, and nothing is carried over from a
// previous season.
//
// A city is one of:
//   unknown      nobody has said anything yet (the starting point)
//   active       still playing
//   eliminated   out, and someone has confirmed it with a source
//   champion     won it all
//
// One loss is not an elimination. Recording a loss changes nothing. A city
// only becomes "eliminated" when the update says why and cites a source.
import { readAll } from './storage.js';

export const STATUSES = ['unknown', 'active', 'eliminated', 'champion'];
export const ELIMINATION_REASONS = ['mathematically_eliminated', 'lost_playoff_game'];
export const ROUNDS = ['regular_season', 'wild_card', 'divisional', 'conference', 'final', 'season_over'];
// How long a playoff picture is trusted before it's treated as out of date.
export const STALE_AFTER_DAYS = 8;

const isUrl = (v) => {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};
const SEASON = /^\d{4}$/;

// Works out the next record for a city, without saving anything.
// Returns { error } or { next, transition }.
export function applySeasonUpdate(current, update, now) {
  const { seasonId, slug, actor } = update;
  if (!SEASON.test(String(seasonId ?? ''))) return { error: 'Season has to be a four-digit year, like 2026.' };
  const base = current ?? { seasonId: String(seasonId), slug, status: 'unknown', version: 0, history: [] };
  const stamp = now.toISOString();
  const who = String(actor ?? '').trim().slice(0, 60) || 'owner';

  // A single game result. Kept as a note. It never changes the status.
  if (update.result) {
    if (!['win', 'loss', 'tie'].includes(update.result)) return { error: 'A result has to be win, loss or tie.' };
    const next = structuredClone(base);
    next.version += 1;
    next.history.push({ at: stamp, actor: who, note: `Recorded a ${update.result}. Status unchanged.`, sourceUrl: isUrl(update.sourceUrl) ? update.sourceUrl : null });
    return { next, transition: null };
  }

  if (!STATUSES.includes(update.status)) return { error: `Status has to be one of: ${STATUSES.join(', ')}.` };

  if (update.status !== 'unknown') {
    if (update.verified !== true) return { error: 'Tick "I checked this against a source" before saving a status.' };
    if (!isUrl(update.sourceUrl)) return { error: 'Add the web address of where you checked it.' };
  }
  if (update.status === 'eliminated' && !ELIMINATION_REASONS.includes(update.reason)) {
    return { error: 'Say why they are out: mathematically eliminated, or lost a playoff game. One regular-season loss is not an elimination.' };
  }

  const next = structuredClone(base);
  const from = base.status;
  next.status = update.status;
  next.reason = update.status === 'eliminated' ? update.reason : null;
  next.sourceUrl = update.status === 'unknown' ? null : update.sourceUrl;
  next.verifiedAt = update.status === 'unknown' ? null : stamp;
  next.actor = who;
  next.version += 1;
  next.history.push({ at: stamp, actor: who, from, to: update.status, reason: next.reason, sourceUrl: next.sourceUrl });
  return { next, transition: from === update.status ? null : { from, to: update.status } };
}

export const seasonKey = (seasonId, slug) => `state/${seasonId}/${slug}`;
export const metaKey = (seasonId) => `meta/${seasonId}`;

export async function saveSeasonUpdate(storage, update, now) {
  const store = storage.store('season');
  const current = await store.get(seasonKey(update.seasonId, update.slug));
  const result = applySeasonUpdate(current, update, now);
  if (result.error) return result;
  await store.set(seasonKey(update.seasonId, update.slug), result.next);
  return result;
}

// The round the season is in, entered by a person with a source.
export function applyMetaUpdate(update, now) {
  if (!SEASON.test(String(update.seasonId ?? ''))) return { error: 'Season has to be a four-digit year, like 2026.' };
  if (update.round !== null && !ROUNDS.includes(update.round)) return { error: `Round has to be one of: ${ROUNDS.join(', ')}.` };
  if (update.round !== null) {
    if (update.verified !== true) return { error: 'Tick "I checked this against a source" before saving the round.' };
    if (!isUrl(update.sourceUrl)) return { error: 'Add the web address of where you checked it.' };
  }
  return {
    next: {
      seasonId: String(update.seasonId),
      round: update.round,
      sourceUrl: update.round === null ? null : update.sourceUrl,
      verifiedAt: update.round === null ? null : now.toISOString(),
      actor: String(update.actor ?? '').trim().slice(0, 60) || 'owner',
    },
  };
}

export async function loadSeason(storage, seasonId) {
  const store = storage.store('season');
  const [meta, states] = await Promise.all([store.get(metaKey(seasonId)), readAll(store, `state/${seasonId}/`)]);
  return { seasonId: String(seasonId), meta, states };
}

// The cities still alive in the playoffs, or a reason nothing can be said.
// It only answers when the round is confirmed, recent, a playoff round, and
// every city has a confirmed status. Anything less and it claims nothing.
export function survivors({ meta, states }, allSlugs, now) {
  const no = (reason) => ({ verified: false, reason, round: null, slugs: [] });
  if (!meta?.round || !meta.verifiedAt) return no('The playoff round has not been confirmed.');
  if (!['wild_card', 'divisional', 'conference', 'final'].includes(meta.round)) return no('It is not the playoffs right now.');
  const ageDays = (now.getTime() - new Date(meta.verifiedAt).getTime()) / 86_400_000;
  if (!(ageDays >= 0) || ageDays > STALE_AFTER_DAYS) return no('The playoff picture is out of date.');

  const bySlug = new Map(states.map((s) => [s.slug, s]));
  const unknown = allSlugs.filter((slug) => !bySlug.get(slug) || bySlug.get(slug).status === 'unknown' || !bySlug.get(slug).verifiedAt);
  if (unknown.length) return no(`${unknown.length} ${unknown.length === 1 ? 'city has' : 'cities have'} no confirmed status.`);

  const alive = allSlugs.filter((slug) => ['active', 'champion'].includes(bySlug.get(slug).status));
  if (!alive.length) return no('No city is marked as still playing.');
  return { verified: true, reason: '', round: meta.round, slugs: alive, asOf: meta.verifiedAt };
}
