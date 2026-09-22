import links from '../data/affiliateLinks.json';

// Cloaked affiliate redirect: /go/example-product -> real Coupang Partners URL.
// Everything else falls through to the static site build in `dist/` via ASSETS.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
};
