// The text follows the selected city, regardless of garment or fit.
export function drawPlayerSpotlight(holder, selections, slug) {
  if (!holder) return;
  const player = selections?.[slug];
  holder.hidden = !player;
  const set = (selector, text = '') => { const el = holder.querySelector(selector); if (el) el.textContent = text; };
  set('[data-player-name]', player?.name);
  set('[data-player-position]', player?.position);
  set('[data-player-blurb]', player?.blurb);
  set('[data-player-note]', player?.rosterNote);
  const note = holder.querySelector('[data-player-note]');
  if (note) note.hidden = !player?.rosterNote;
  set('[data-player-date]', player ? `Checked ${player.verifiedAt}${player.needsReview ? ' · Review needed' : ''}` : '');
  const source = holder.querySelector('[data-player-source]');
  if (source) {
    if (player) source.href = player.sourceUrl;
    else source.removeAttribute('href');
  }
}
