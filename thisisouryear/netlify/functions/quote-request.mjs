// Saves a bulk quote request from the fantasy league page.
import { shop } from '../../src/server/shop.js';
import { makeQuoteRequestHandler } from '../../src/server/quotes.js';
import { blobStorage } from '../../src/server/storage.js';

export default makeQuoteRequestHandler({ shop, getStorage: blobStorage });
