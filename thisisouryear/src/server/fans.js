// Fan photos: sending one in, checking it, showing it, taking it down.
//
// Nothing a fan sends is shown until two things are true: they ticked the
// box giving permission to display it, and a person approved it in the admin
// screen. A hashtag on its own is never treated as permission, and nothing is
// ever pulled in from social media.
//
// Photos are sent by adults. The form never asks for a child's name or
// details.
import { json, readJson, shortId, sha256, sameSecret } from './http.js';
import { readAll } from './storage.js';
import { cleanText } from '../lib/shop-core.js';

export const PERMISSION_VERSION = '2026-10-10';
export const PERMISSION_TEXT =
  "I'm 18 or older, this is my photo, and everyone in it is fine with it being shared. If a child is in it, I'm their parent or guardian. This Is Our Year may show it on this site.";
export const REPOST_TEXT = 'This Is Our Year may also repost it on its social accounts.';

const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
};

const isPublic = (s) => s.status === 'approved' && s.permission?.display === true;

export function makeFanSubmitHandler({ shop, getStorage, now = () => new Date() }) {
  return async (req) => {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    // A 4 MB photo is about 5.4 MB once it's packed into the request.
    const body = await readJson(req, 6 * 1024 * 1024);
    if (body.error === 'too_large') return json({ error: 'That photo is too big. Keep it under 4 MB.', field: 'photo' }, 413);
    if (body.error) return json({ error: "We couldn't read that." }, 400);
    const v = body.value;
    if (v.website) return json({ error: "We couldn't read that." }, 400);

    // Withdrawing a photo uses the same endpoint.
    if (v.action === 'withdraw') return withdraw(v, getStorage, now);

    const city = shop.city(v.slug);
    if (!city) return json({ error: "Pick the city whose colors you're wearing.", field: 'slug' }, 400);
    if (v.permission !== true) return json({ error: 'Tick the permission box so we know we can show your photo.', field: 'permission' }, 400);
    const caption = cleanText(v.caption);
    const displayName = cleanText(v.displayName);
    if (caption.length > 140) return json({ error: 'Keep the caption under 140 characters.', field: 'caption' }, 400);
    if (displayName.length > 40) return json({ error: 'Keep the name under 40 characters.', field: 'displayName' }, 400);

    const check = TYPES[v.imageType];
    if (!check || typeof v.imageBase64 !== 'string') return json({ error: 'Send a JPG, PNG or WebP photo.', field: 'photo' }, 400);
    let bytes;
    try {
      bytes = new Uint8Array(Buffer.from(v.imageBase64, 'base64'));
    } catch {
      bytes = new Uint8Array();
    }
    if (bytes.length < 100 || !check(bytes)) return json({ error: "That file isn't a photo we can read. Send a JPG, PNG or WebP.", field: 'photo' }, 400);
    if (bytes.length > MAX_BYTES) return json({ error: 'That photo is too big. Keep it under 4 MB.', field: 'photo' }, 413);

    const id = shortId('F');
    const removalCode = shortId('R');
    const stamp = now().toISOString();
    const record = {
      id,
      slug: city.slug,
      caption,
      displayName,
      imageType: v.imageType,
      bytes: bytes.length,
      createdAt: stamp,
      status: 'pending',
      permission: { display: true, repost: v.repost === true, grantedAt: stamp, version: PERMISSION_VERSION },
      removalCodeHash: sha256(removalCode),
      repost: { queued: false, done: false },
      history: [{ at: stamp, action: 'submitted' }],
    };
    try {
      const storage = await getStorage();
      await storage.store('fan-photos').setBinary(`photo/${id}`, bytes, { type: v.imageType });
      await storage.store('fans').set(`sub/${id}`, record);
    } catch (err) {
      console.error('Could not save a fan photo:', err?.message ?? err);
      return json({ error: "We couldn't save your photo just now. Nothing was posted. Try again in a bit.", saved: false }, 503);
    }
    return json({ saved: true, reference: id, removalCode });
  };
}

async function withdraw(v, getStorage, now) {
  if (typeof v.reference !== 'string' || typeof v.removalCode !== 'string') return json({ error: 'Enter your photo reference and removal code.' }, 400);
  const storage = await getStorage();
  const fans = storage.store('fans');
  const record = await fans.get(`sub/${v.reference.trim().toUpperCase()}`);
  if (!record || !sameSecret(sha256(v.removalCode.trim().toUpperCase()), record.removalCodeHash)) {
    return json({ error: "That reference and code don't match a photo." }, 404);
  }
  await takeDown(storage, record, 'withdrawn', 'fan', now());
  return json({ withdrawn: true });
}

// Removes the picture itself and marks the record. Used for a fan's own
// withdrawal and for removal by the owner.
export async function takeDown(storage, record, status, actor, now) {
  await storage.store('fan-photos').delete(`photo/${record.id}`);
  record.status = status;
  record.permission = { ...record.permission, display: false, repost: false, withdrawnAt: now.toISOString() };
  record.repost = { queued: false, done: record.repost?.done === true };
  record.history.push({ at: now.toISOString(), action: status, actor });
  await storage.store('fans').set(`sub/${record.id}`, record);
  return record;
}

// What the owner can do to a submission.
export async function moderate(storage, { id, action, actor = 'owner' }, now) {
  const fans = storage.store('fans');
  const record = await fans.get(`sub/${id}`);
  if (!record) return { error: 'No such photo.' };
  const log = (a) => record.history.push({ at: now.toISOString(), action: a, actor: String(actor).slice(0, 60) });
  const gone = ['withdrawn', 'removed'].includes(record.status);

  if (action === 'approve') {
    if (gone) return { error: 'That photo was taken down and can\'t be approved.' };
    if (record.permission?.display !== true) return { error: 'There is no permission on file to display this photo.' };
    record.status = 'approved';
    log('approved');
  } else if (action === 'reject') {
    if (gone) return { error: 'That photo was already taken down.' };
    record.status = 'rejected';
    record.repost = { queued: false, done: record.repost?.done === true };
    log('rejected');
  } else if (action === 'remove') {
    await takeDown(storage, record, 'removed', actor, now);
    return { record };
  } else if (action === 'queue_repost' || action === 'unqueue_repost' || action === 'mark_reposted') {
    if (record.status !== 'approved') return { error: 'Only approved photos can be queued for reposting.' };
    if (record.permission?.repost !== true) return { error: 'This fan agreed to the site showing the photo, but not to reposting it.' };
    if (action === 'queue_repost') record.repost = { ...record.repost, queued: true };
    if (action === 'unqueue_repost') record.repost = { ...record.repost, queued: false };
    if (action === 'mark_reposted') record.repost = { queued: false, done: true, doneAt: now.toISOString() };
    log(action);
  } else {
    return { error: 'Unknown action.' };
  }
  await fans.set(`sub/${id}`, record);
  return { record };
}

// The public side: a list of approved photos, and the pictures themselves.
export function makeFansHandler({ shop, getStorage }) {
  return async (req) => {
    if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
    const url = new URL(req.url);
    let storage;
    try {
      storage = await getStorage();
    } catch {
      return json({ photos: [] });
    }
    const fans = storage.store('fans');

    const photoId = url.searchParams.get('photo');
    if (photoId) {
      const record = await fans.get(`sub/${photoId}`);
      if (!record || !isPublic(record)) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
      const file = await storage.store('fan-photos').getBinary(`photo/${record.id}`);
      if (!file) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
      // A short cache, so a removed photo disappears within a minute.
      return new Response(file.data, { headers: { 'Content-Type': record.imageType, 'Cache-Control': 'public, max-age=60', 'X-Content-Type-Options': 'nosniff' } });
    }

    const limit = Math.min(60, Math.max(1, Number(url.searchParams.get('limit')) || 24));
    const city = url.searchParams.get('city');
    const all = await readAll(fans, 'sub/');
    const photos = all
      .filter(isPublic)
      .filter((s) => !city || s.slug === city)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit)
      .map((s) => ({ id: s.id, slug: s.slug, cityName: shop.city(s.slug)?.name ?? '', caption: s.caption, displayName: s.displayName }));
    return json({ photos }, 200, { 'Cache-Control': 'public, max-age=60' });
  };
}
