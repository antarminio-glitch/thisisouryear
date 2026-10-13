// Recognizable-star selections are editorial, not a performance ranking.
// Unpublished selections are available only to an explicitly requested preview.
export function visibleSpotlights(data, { preview = false, today } = {}) {
  if (!preview && (data?.enabled !== true || data?.rightsStatus !== 'cleared')) return {};
  const result = {};
  for (const [slug, entry] of Object.entries(data?.entries ?? {})) {
    if (!entry.name || !entry.position || !entry.sourceUrl) continue;
    const day = /^\d{4}-\d{2}-\d{2}$/.test(today ?? '') ? today : null;
    const dated = /^\d{4}-\d{2}-\d{2}$/.test(entry.verifiedAt ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(entry.reviewAfter ?? '');
    const fresh = day && dated && entry.verifiedAt <= day && day <= entry.reviewAfter;
    if (!preview && !fresh) continue;
    let source;
    try { source = new URL(entry.sourceUrl); } catch { continue; }
    if (source.protocol !== 'https:') continue;
    result[slug] = { ...entry, needsReview: !fresh };
  }
  return result;
}
