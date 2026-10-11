import product from '../data/product.json';

export function dollars(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function priceFor(size) {
  const extra = product.upchargeSizes.includes(size) ? product.upchargeCents : 0;
  return product.priceCents + extra;
}
