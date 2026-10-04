import { getJsonFile, commitFiles } from './github.js';

// Ad code edited in the admin page. Saving commits data/ads.json to GitHub;
// the Workers Build then bakes it into the static pages (src/lib/ads.ts), so
// page views stay plain static-asset requests (free and unlimited) instead
// of each running the Worker.
//   head   -> inside <head> on every page (e.g. AdSense auto-ads script)
//   top    -> above the content on every page
//   bottom -> below posts and comparison pages
//   adsTxt -> served as /ads.txt
export const ADS_PATH = 'data/ads.json';
export const AD_FIELDS = ['head', 'top', 'bottom', 'adsTxt'];
const EMPTY = { head: '', top: '', bottom: '', adsTxt: '', updatedAt: null };

export async function getAds(env) {
  return { ...EMPTY, ...(await getJsonFile(env, ADS_PATH, {})) };
}

export async function saveAds(env, input) {
  const ads = { ...EMPTY, updatedAt: new Date().toISOString() };
  for (const field of AD_FIELDS) {
    ads[field] = String(input[field] ?? '').replace(/\r\n/g, '\n').trim();
  }
  await commitFiles(env, {
    message: 'chore: update ad code from admin',
    files: [{ path: ADS_PATH, content: JSON.stringify(ads, null, 2) + '\n' }],
  });
  return ads;
}
