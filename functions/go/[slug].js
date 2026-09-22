import links from '../../data/affiliateLinks.json';

// Cloaked affiliate redirect: /go/example-product -> real Coupang Partners URL.
// Keeps the outbound link short/clean and gives one place to swap partner URLs.
export async function onRequestGet({ params }) {
  const entry = links[params.slug];

  if (!entry) {
    return new Response('Link not found', { status: 404 });
  }

  return Response.redirect(entry.url, 302);
}
