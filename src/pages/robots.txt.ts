import type { APIRoute } from 'astro';

// Built from `site` in astro.config.mjs, so it follows a domain change.
// Daum 웹마스터도구가 주는 확인 줄(#DaumWebMasterTool:…)을 받으면 여기에 넣는다.
const DAUM_PIN = '';

export const GET: APIRoute = ({ site }) =>
  new Response(
    [
      'User-agent: *',
      'Allow: /',
      // Affiliate redirects to Coupang: nothing to index there.
      'Disallow: /go/',
      '',
      `Sitemap: ${new URL('/sitemap-index.xml', site)}`,
      DAUM_PIN,
    ]
      .join('\n')
      .trim() + '\n',
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
  );
