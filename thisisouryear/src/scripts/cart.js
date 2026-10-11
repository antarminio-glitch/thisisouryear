// The cart. Kept in this browser so it's still there when you come back.
// The server re-checks every price and size at checkout, so nothing stored
// here is trusted.
const KEY = 'tioy-cart-v1';
const FAVORITE_KEY = 'tioy-favorite-city';
let memory = []; // used when the browser won't let us store anything

export function readCart() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(value) ? value.filter((i) => i && typeof i === 'object') : [];
  } catch {
    return memory;
  }
}

function write(items) {
  memory = items;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* private mode or storage blocked: the cart lasts for this page only */
  }
  document.dispatchEvent(new CustomEvent('cart:change', { detail: { count: cartCount(items) } }));
}

export const cartCount = (items = readCart()) => items.reduce((n, i) => n + (Number.isInteger(i.quantity) ? i.quantity : 0), 0);

export function newId(prefix) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `${prefix}-${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

// Adds items. Two identical plain items become one line with a higher
// quantity. Sets, gifts and league orders always stay as their own lines.
export function addItems(newItems, maxQuantity = 10) {
  const items = readCart();
  for (const item of newItems) {
    const same =
      item.mode === 'standard' &&
      items.find((i) => i.mode === 'standard' && i.productId === item.productId && i.designId === item.designId && i.slug === item.slug && i.size === item.size);
    if (same) {
      same.quantity = Math.min(maxQuantity, same.quantity + item.quantity);
      same.seenPriceCents = item.seenPriceCents;
    } else {
      items.push({ id: newId('I'), addedAt: new Date().toISOString(), ...item });
    }
  }
  write(items);
  return items;
}

export function setQuantity(id, quantity) {
  const items = readCart();
  const item = items.find((i) => i.id === id);
  if (item && Number.isInteger(quantity) && quantity >= 1) item.quantity = quantity;
  write(items);
}

export function removeWhere(test) {
  write(readCart().filter((i) => !test(i)));
}

export function updateWhere(test, change) {
  const items = readCart();
  for (const i of items) if (test(i)) change(i);
  write(items);
}

export function clearCart() {
  write([]);
}

// The shopper's own city. Optional, and never guessed from what they buy.
export function getFavorite() {
  try {
    return localStorage.getItem(FAVORITE_KEY) || '';
  } catch {
    return '';
  }
}
export function setFavorite(slug) {
  try {
    if (slug) localStorage.setItem(FAVORITE_KEY, slug);
    else localStorage.removeItem(FAVORITE_KEY);
  } catch {
    /* fine */
  }
}

// What the server needs for each line. Nothing else is sent.
export function toOrderItems(items = readCart()) {
  return items.map((i) => {
    const out = { productId: i.productId, designId: i.designId, slug: i.slug, size: i.size, quantity: i.quantity, mode: i.mode ?? 'standard' };
    for (const k of ['bundleId', 'leagueOrderId', 'leagueName', 'recipientSlug', 'giftNote', 'seenPriceCents']) if (i[k] !== undefined && i[k] !== '') out[k] = i[k];
    return out;
  });
}

// Keeps every "Cart (2)" badge on the page up to date.
export function wireCartBadges() {
  const paint = () => {
    const n = cartCount();
    document.querySelectorAll('[data-cart-count]').forEach((el) => {
      el.textContent = n ? String(n) : '';
      el.hidden = n === 0;
    });
    document.querySelectorAll('[data-cart-link]').forEach((el) => el.setAttribute('aria-label', n ? `Cart, ${n} ${n === 1 ? 'item' : 'items'}` : 'Cart, empty'));
  };
  document.addEventListener('cart:change', paint);
  window.addEventListener('storage', (e) => e.key === KEY && paint());
  window.addEventListener('pageshow', paint);
  paint();
}
