// The shop, loaded with the real data files, for the server functions.
// (Pages use src/lib/shop.js, which does the same thing for the website build.)
import teams from '../data/teams.json' with { type: 'json' };
import catalog from '../data/catalog.json' with { type: 'json' };
import store from '../data/store.json' with { type: 'json' };
import palettes from '../data/palettes.json' with { type: 'json' };
import history from '../data/history.json' with { type: 'json' };
import photos from '../data/garment-photos.json' with { type: 'json' };
import printifyConfig from '../data/printify.json' with { type: 'json' };
import { createShop } from '../lib/shop-core.js';

export const shop = createShop({ teams, catalog, store, palettes });
export { teams, catalog, store, palettes, history, photos, printifyConfig };
