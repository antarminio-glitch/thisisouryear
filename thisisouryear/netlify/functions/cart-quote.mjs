// Prices a cart and says whether each item can be bought. No payment involved.
import { shop } from '../../src/server/shop.js';
import { makeQuoteHandler } from '../../src/server/checkout.js';

export default makeQuoteHandler({ shop });
