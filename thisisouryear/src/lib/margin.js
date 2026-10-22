// The cost and margin guard.
//
// costs.json says what each item costs us at Printify and what Printify
// charges to ship it. checkMargins() refuses any price on the site that
// would keep less than the minimum margin on top of cost, and any order
// where we pay the shipping (free shipping, or a fee below Printify's) that
// would do the same. The build runs it (scripts/check-data.mjs), the tests
// run it on the real files, and the admin quote screen shows the floors it
// works out, so a hand quote never goes under them.
//
// "Margin" here is a share of cost: the floor for something that costs C is
// C x (1 + minimumMarginPercent / 100), rounded up to the cent.

const int = (n) => (Number.isInteger(n) && n >= 0 ? n : null);
const money = (cents) => `$${(cents / 100).toFixed(2)}`;

// The lowest price that keeps the margin on a cost.
export function floorCents(costCents, marginPercent) {
  return Math.ceil((costCents * (100 + marginPercent)) / 100);
}

// What one item costs to make, or null when costs.json doesn't say.
export function unitCost(costs, productId, size) {
  const c = costs?.products?.[productId]?.sizes?.[size];
  return int(c) && c > 0 ? c : null;
}

// What Printify charges to ship an item: one rate for the first item in an
// order, a smaller one for each item after it.
export function shippingCost(costs, productId) {
  const s = costs?.products?.[productId]?.shipping ?? {};
  return { firstCents: int(s.firstItemCents), extraCents: int(s.extraItemCents) };
}

// What a whole order costs us to make and ship: every item's cost, every
// item's extra-item shipping, and the first-item rate once, taken from
// whichever product in the order has the dearest first item. Null when any
// number it needs is missing. rows: [{ productId, size, quantity }].
export function orderCostCents(costs, rows) {
  let total = 0;
  let firstExtra = 0;
  for (const r of rows) {
    const cost = unitCost(costs, r.productId, r.size);
    const ship = shippingCost(costs, r.productId);
    if (cost == null || ship.firstCents == null || ship.extraCents == null || !Number.isInteger(r.quantity) || r.quantity < 1) return null;
    total += (cost + ship.extraCents) * r.quantity;
    firstExtra = Math.max(firstExtra, ship.firstCents - ship.extraCents);
  }
  return rows.length ? total + firstExtra : null;
}

// The least a whole order can sell for when we pay the shipping, or null
// when a cost is missing.
export function orderFloorCents(costs, rows) {
  const cost = orderCostCents(costs, rows);
  return cost == null ? null : floorCents(cost, costs.minimumMarginPercent);
}

// One row per size on sale: what it sells for, what it costs, and the lowest
// prices that keep the margin. Rows with a missing number say which.
export function priceFloors({ catalog, costs }) {
  const m = costs?.minimumMarginPercent ?? 0;
  const rows = [];
  for (const p of catalog.products) {
    if (p.sellable !== true) continue;
    const ship = shippingCost(costs, p.id);
    for (const v of p.variants ?? []) {
      const cost = unitCost(costs, p.id, v.size);
      rows.push({
        productId: p.id,
        productName: p.name,
        size: v.size,
        priceCents: p.priceCents + (v.extraCents ?? 0),
        costCents: cost,
        // Sold on its own, shipping charged to the buyer: cost plus margin.
        floorCents: cost == null ? null : floorCents(cost, m),
        // Inside an order we ship for free (bulk, or over the free-shipping
        // minimum): cost plus its shipping plus margin. The floor to quote at.
        shippedFloorCents: cost == null || ship.extraCents == null ? null : floorCents(cost + ship.extraCents, m),
        missing: [cost == null ? 'cost' : null, ship.firstCents == null ? 'first-item shipping' : null, ship.extraCents == null ? 'extra-item shipping' : null].filter(Boolean),
      });
    }
  }
  return rows;
}

// Checks every price against the costs. Errors stop the build.
export function checkMargins({ catalog, store, costs }) {
  const errors = [];
  const warnings = [];
  const err = (s) => errors.push(s);
  if (!costs || typeof costs !== 'object') {
    err('costs.json is missing or unreadable.');
    return { errors, warnings, floors: [] };
  }
  const m = costs.minimumMarginPercent;
  if (!Number.isInteger(m) || m < 0 || m > 500) {
    err(`costs.json: minimumMarginPercent is ${JSON.stringify(m)}. It must be a whole number, like 15 for 15% on top of cost.`);
    return { errors, warnings, floors: [] };
  }
  const F = (cents) => floorCents(cents, m);
  const fix = 'Raise the price in catalog.json, or lower minimumMarginPercent in costs.json.';
  const floors = priceFloors({ catalog, costs });
  const sellable = catalog.products.filter((p) => p.sellable === true);
  // Sizes that share a cost share a message, so the log says "Tee S, M, L, XL" once.
  const grouped = new Map();
  const say = (key, size, make) => {
    const g = grouped.get(key) ?? { sizes: [], make };
    g.sizes.push(size);
    grouped.set(key, g);
  };
  const flush = () => {
    for (const g of grouped.values()) err(g.make(g.sizes.join(', ')));
    grouped.clear();
  };

  for (const p of sellable) {
    if (!costs.products?.[p.id]) {
      err(`costs.json: nothing for "${p.id}" (${p.name}), which is for sale. Add its sizes and shipping, or stop selling it.`);
      continue;
    }
    const ship = shippingCost(costs, p.id);
    if (ship.firstCents == null) err(`costs.json "${p.id}": shipping.firstItemCents is not set. Read it from Printify's shipping rates for the ${costs.products[p.id].blank ?? p.name}.`);
    if (ship.extraCents == null) err(`costs.json "${p.id}": shipping.extraItemCents (each item after the first) is not set. Read it from Printify's shipping rates for the ${costs.products[p.id].blank ?? p.name}.`);
    for (const row of floors.filter((r) => r.productId === p.id)) {
      const { size, priceCents: price, costCents: cost } = row;
      if (cost == null) {
        err(`costs.json "${p.id}": no cost for size ${size}. Read it from the cost tab on the Printify product. The build stops until it is filled in.`);
        continue;
      }
      // 1. Every price on the site keeps the margin on the item's cost.
      if (price < row.floorCents) {
        say(`price/${p.id}/${price}/${cost}`, size, (sizes) => `${p.name} ${sizes} sells for ${money(price)} but costs ${money(cost)}. With ${m}% on cost the lowest price is ${money(row.floorCents)}. ${fix}`);
      }
      // 2. One of it on its own, with the shipping fee charged: the fee plus
      //    the price must still keep the margin on making and shipping it.
      if (ship.firstCents != null) {
        const revenue = price + store.shippingCents;
        const need = F(cost + ship.firstCents);
        if (revenue < need) {
          say(`alone/${p.id}/${price}/${cost}`, size, (sizes) => `One ${p.name} ${sizes} ordered alone brings in ${money(revenue)} (${money(price)} plus ${money(store.shippingCents)} shipping) but costs ${money(cost + ship.firstCents)} to make and ship. With ${m}% on cost that order needs ${money(need)}. Raise shippingCents in store.json or the price.`);
        }
      }
      // 3. Each item after the first in an order we ship for free.
      if (row.shippedFloorCents != null && price < row.shippedFloorCents) {
        say(`extra/${p.id}/${price}/${cost}`, size, (sizes) => `In an order with free shipping, each extra ${p.name} ${sizes} brings in ${money(price)} but costs ${money(cost + ship.extraCents)} to make and ship. With ${m}% on cost the lowest price is ${money(row.shippedFloorCents)}. ${fix}`);
      }
    }
  }
  flush();
  if (errors.length) return { errors, warnings, floors };

  // 4. Free shipping. Every order at or over the minimum ships free, so we
  //    pay the shipping. The thinnest orders are the smallest ones that
  //    reach the minimum: one kind of item, or one dear-to-ship item filled
  //    out with the thinnest item. Each has to keep the margin.
  const min = store.freeShippingMinCents;
  if (Number.isInteger(min) && min > 0) {
    const seen = new Set();
    const check = (parts) => {
      const revenue = parts.reduce((n, x) => n + x.priceCents * x.quantity, 0);
      const cost = orderCostCents(costs, parts);
      const key = parts.map((x) => `${x.productId}x${x.quantity}`).join('+') + `:${revenue}:${cost}`;
      if (seen.has(key)) return;
      seen.add(key);
      const need = F(cost);
      if (revenue < need) {
        const what = parts.map((x) => `${x.quantity} ${x.productName} ${x.size}`).join(' and ');
        err(`Free shipping starts at ${money(min)}. An order of ${what} comes to ${money(revenue)}, ships free, and costs ${money(cost)} to make and ship. With ${m}% on cost it needs ${money(need)}. Raise freeShippingMinCents in store.json, raise the price, or lower the margin.`);
      }
    };
    for (const a of floors) {
      check([{ ...a, quantity: Math.ceil(min / a.priceCents) }]);
      for (const b of floors) {
        if (b.productId === a.productId) continue;
        const n = Math.max(1, Math.ceil((min - b.priceCents) / a.priceCents));
        check([{ ...b, quantity: 1 }, { ...a, quantity: n }]);
      }
    }
  }

  // 5. Bulk tiers, whenever they are switched on. A bulk order is always
  //    big enough to ship free, so each discounted item has to clear its
  //    cost plus shipping, and the smallest order in each tier has to clear
  //    the first-item shipping too.
  const tiers = catalog.bulk?.enabled === false ? [] : (catalog.bulk?.tiers ?? []);
  for (const t of tiers) {
    for (const row of floors) {
      const unit = Math.round((row.priceCents * (100 - t.percentOff)) / 100);
      const revenue = unit * t.minQuantity;
      const need = orderFloorCents(costs, [{ productId: row.productId, size: row.size, quantity: t.minQuantity }]);
      if (unit < row.shippedFloorCents || revenue < need) {
        say(`bulk/${t.minQuantity}/${row.productId}/${unit}/${need}`, row.size, (sizes) => `Bulk tier ${t.minQuantity}+ at ${t.percentOff}% off: ${row.productName} ${sizes} drops to ${money(unit)}, and ${t.minQuantity} of them bring in ${money(revenue)} against a floor of ${money(need)} with ${m}% on cost. Set bulk.enabled to false in catalog.json, lower percentOff, or raise the price.`);
      }
    }
  }
  flush();

  // The thinnest item on the site, for the build log.
  const thin = floors.reduce((best, r) => (!best || r.priceCents - r.shippedFloorCents < best.priceCents - best.shippedFloorCents ? r : best), null);
  if (thin) warnings.push(`Margins: every price keeps at least ${m}% over cost and shipping. The thinnest is ${thin.productName} ${thin.size} at ${money(thin.priceCents)}, ${money(thin.priceCents - thin.shippedFloorCents)} over its floor of ${money(thin.shippedFloorCents)}.`);
  return { errors, warnings, floors };
}
