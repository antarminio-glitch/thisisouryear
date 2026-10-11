// Receives a fan photo (or a request to take one down). Nothing is shown
// publicly until the owner approves it.
import { shop } from '../../src/server/shop.js';
import { makeFanSubmitHandler } from '../../src/server/fans.js';
import { blobStorage } from '../../src/server/storage.js';

export default makeFanSubmitHandler({ shop, getStorage: blobStorage });
