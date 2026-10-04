import { adsTxt } from '../lib/ads';

// /ads.txt for ad networks (AdSense), edited in the admin page.
export function GET() {
  return new Response(adsTxt ? `${adsTxt}\n` : '', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
