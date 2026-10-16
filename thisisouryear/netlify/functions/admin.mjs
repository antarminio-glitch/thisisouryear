// The admin screen's server side. Needs ADMIN_TOKEN (16+ characters) in Netlify.
import { shop, palettes, history, printifyConfig } from '../../src/server/shop.js';
import { makeAdminHandler } from '../../src/server/admin.js';
import { blobStorage } from '../../src/server/storage.js';

export default makeAdminHandler({ shop, palettes, history, printifyConfig, env: process.env, getStorage: blobStorage });
