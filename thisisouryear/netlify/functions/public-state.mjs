// Tells the site whether a campaign message is showing and which cities are
// confirmed alive in the playoffs. Says "nothing" unless a person set it up.
import { shop } from '../../src/server/shop.js';
import { makePublicStateHandler } from '../../src/server/admin.js';
import { blobStorage } from '../../src/server/storage.js';

export default makePublicStateHandler({ shop, getStorage: blobStorage });
