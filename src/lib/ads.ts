import ads from '../../data/ads.json';
import { slotHtml } from './adSlot.js';

// Written by the admin page (worker/lib/ads.js) and baked in at build time.
export const adHead: string = ads.head ?? '';
export const adTop: string = slotHtml(ads.top);
export const adBottom: string = slotHtml(ads.bottom);
export const adsTxt: string = ads.adsTxt ?? '';
