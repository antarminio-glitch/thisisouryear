// Small price helpers for pages. The real pricing rules live in shop-core.js.
import { shop } from './shop.js';
export { dollars } from './shop-core.js';

// Lowest price of the adult tee, the item the store is built around.
export const TEE_ID = 'adult-tee';
export const DESIGN_ID = 'this-is-our-year';

export function fromPriceCents(productId = TEE_ID) {
  return shop.priceRange(productId)?.lowCents ?? null;
}
