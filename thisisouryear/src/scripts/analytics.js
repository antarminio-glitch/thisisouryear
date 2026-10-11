// One place for "something happened" events, such as a city being picked or
// an item being added to the cart.
//
// No analytics service is connected yet, so by default this does nothing
// except hand the event to window.dataLayer, where a service can pick it up
// later. It never sends free text, names, notes or email addresses.
const ALLOWED = new Set([
  'team_selected', 'preview_changed', 'size_selected', 'add_to_cart', 'matching_set_added', 'league_quote_submitted',
  'gift_mode_selected', 'share_card_downloaded', 'fan_submission_created', 'checkout_started',
]);
const SAFE_KEYS = new Set(['team_id', 'product_id', 'product_style', 'audience', 'design_id', 'size', 'quantity', 'purchase_mode', 'item_count', 'value_cents', 'method']);

export function track(event, props = {}) {
  if (!ALLOWED.has(event)) return;
  const clean = {};
  for (const [k, v] of Object.entries(props)) {
    if (SAFE_KEYS.has(k) && (typeof v === 'number' || (typeof v === 'string' && v.length <= 40))) clean[k] = v;
  }
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event, ...clean });
    document.dispatchEvent(new CustomEvent('tioy:track', { detail: { event, ...clean } }));
  } catch {
    /* analytics must never break shopping */
  }
}
