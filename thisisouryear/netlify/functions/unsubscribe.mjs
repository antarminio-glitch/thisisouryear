// The unsubscribe link in marketing emails. Needs UNSUBSCRIBE_SECRET in Netlify.
import { makeUnsubscribeHandler } from '../../src/server/admin.js';
import { blobStorage } from '../../src/server/storage.js';

export default makeUnsubscribeHandler({ env: process.env, getStorage: blobStorage });
