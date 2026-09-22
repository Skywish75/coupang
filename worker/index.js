import links from '../data/affiliateLinks.json';
import { handleAdmin } from './admin.js';
import { runAutoPublish } from './lib/publish.js';
import { addLog } from './lib/state.js';

// Cloaked affiliate redirect: /go/example-product -> real Coupang Partners URL.
// /admin* is the auto-publish control panel (protected by Cloudflare Access).
// Everything else falls through to the static site build in `dist/` via ASSETS.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/admin')) {
      return handleAdmin(request, env);
    }

    const match = url.pathname.match(/^\/go\/([^/]+)\/?$/);
    if (match) {
      const entry = links[match[1]];
      if (!entry) {
        return new Response('Link not found', { status: 404 });
      }
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
