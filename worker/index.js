import links from '../data/affiliateLinks.json';
import { handleAdmin } from './admin.js';
import { runAutoPublish } from './lib/publish.js';
import { addLog } from './lib/state.js';
import { recordClick } from './lib/clicks.js';

// Cloaked affiliate redirect: /go/example-product -> real Coupang Partners URL.
// /admin* is the auto-publish control panel (HTTP Basic Auth, see admin.js).
// Everything else falls through to the static site build in `dist/` via ASSETS.
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/admin')) {
      return handleAdmin(request, env);
    }

    const match = url.pathname.match(/^\/go\/([^/]+)\/?$/);
    if (match) {
      // url.pathname keeps non-ASCII slug segments percent-encoded (e.g.
      // Korean product slugs come back as %ED%95%98...), so decode before
      // looking the key up in the affiliate link map.
      const slug = decodeURIComponent(match[1]);
      const entry = links[slug];
      if (!entry) {
        return new Response('Link not found', { status: 404 });
      }
      // Counting happens after the redirect is sent; a failed count is dropped.
      ctx.waitUntil(recordClick(env, request, slug).catch(() => {}));
      return Response.redirect(entry.url, 302);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runAutoPublish(env).catch((err) => addLog(env, { status: 'error', reason: err.message }))
    );
  },
};
