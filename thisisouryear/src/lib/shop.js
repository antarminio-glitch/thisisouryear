// The shop, loaded with the real data files. Pages and browser scripts import
// this. (The checkout server builds its own copy the same way.)
import teams from '../data/teams.json';
import catalog from '../data/catalog.json';
import store from '../data/store.json';
import palettes from '../data/palettes.json';
import { createShop } from './shop-core.js';

export const shop = createShop({ teams, catalog, store, palettes });
export { teams, catalog, store };
