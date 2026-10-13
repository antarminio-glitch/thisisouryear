// Server/build only: draft identities are omitted from normal published HTML.
import selections from '../data/player-spotlights.json';
import store from '../data/store.json';
import { todayIn } from './counter.js';
import { visibleSpotlights } from './player-spotlights.js';

export const spotlightPreview = import.meta.env.DEV || import.meta.env.PLAYER_SPOTLIGHT_PREVIEW === 'true';
export const playerSpotlights = visibleSpotlights(selections, { preview: spotlightPreview, today: todayIn(store.timezone) });
