// Things the pages ask the server for after loading: whether a campaign is
// running, which cities are still alive in the playoffs, and approved fan
// photos. If the server has nothing to say, or isn't reachable, every page
// simply keeps its ordinary content.
import { FUNCTIONS } from './shop-data.js';

let statePromise;
export function loadPublicState() {
  statePromise ??= fetch(`${FUNCTIONS}/public-state`, { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return statePromise;
}

export async function loadFanPhotos(limit = 24, slug = '') {
  try {
    const q = new URLSearchParams({ limit: String(limit) });
    if (slug) q.set('city', slug);
    const r = await fetch(`${FUNCTIONS}/fans?${q}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return [];
    const body = await r.json();
    return Array.isArray(body.photos) ? body.photos : [];
  } catch {
    return [];
  }
}

// Builds the photo list with DOM calls, never innerHTML, because captions and
// names were typed by strangers.
export function renderFanList(list, photos) {
  list.textContent = '';
  for (const p of photos) {
    const li = document.createElement('li');
    const fig = document.createElement('figure');
    const img = document.createElement('img');
    img.src = `${FUNCTIONS}/fans?photo=${encodeURIComponent(p.id)}`;
    img.alt = p.caption ? `Fan photo: ${p.caption}` : `Fan photo in ${p.cityName} colors`;
    img.loading = 'lazy';
    img.decoding = 'async';
    const cap = document.createElement('figcaption');
    const who = document.createElement('strong');
    who.textContent = p.displayName || 'A fan';
    cap.append(who, ` in ${p.cityName} colors`);
    if (p.caption) {
      const q = document.createElement('span');
      q.textContent = p.caption;
      cap.append(q);
    }
    fig.append(img, cap);
    li.append(fig);
    list.append(li);
  }
}
