// Serves approved fan photos, and only approved ones.
import { shop } from '../../src/server/shop.js';
import { makeFansHandler } from '../../src/server/fans.js';
import { blobStorage } from '../../src/server/storage.js';

export default makeFansHandler({ shop, getStorage: blobStorage });
