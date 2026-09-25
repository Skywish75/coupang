import { hmacSha256Hex } from './crypto.js';

const API_HOST = 'https://api-gateway.coupang.com';

function signedDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const yy = String(d.getUTCFullYear()).slice(2);
  return `${yy}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(
    d.getUTCMinutes()
  )}${pad(d.getUTCSeconds())}Z`;
}

// Coupang's HMAC scheme: message = signedDate + method + path + query,
// where `query` is the query string WITHOUT a leading "?". Including the
// "?" in the signed message (as an earlier version of this file did)
// produces a signature Coupang rejects with HmacSignatureMismatchedException.
async function authHeader(env, method, path, query = '') {
  const date = signedDate();
  const message = date + method + path + query;
  const signature = await hmacSha256Hex(env.COUPANG_SECRET_KEY, message);
  return `CEA algorithm=HmacSHA256, access-key=${env.COUPANG_ACCESS_KEY}, signed-date=${date}, signature=${signature}`;
}

export async function searchProducts(env, keyword, limit = 10) {
  const path = '/v2/providers/affiliate_open_api/apis/openapi/products/search';
  const query = `keyword=${encodeURIComponent(keyword)}&limit=${limit}`;
  const authorization = await authHeader(env, 'GET', path, query);

  const res = await fetch(`${API_HOST}${path}?${query}`, {
    headers: { Authorization: authorization },
  });

  if (!res.ok) {
    throw new Error(`Coupang search failed (${res.status}): ${await res.text()}`);
  }

  const json = await res.json();
  return json.data?.productData ?? [];
}

// Note: products from searchProducts() already carry our own affiliate tag
// in productUrl (see publish.js), so there's normally no need for a
// separate deeplink-conversion call — Coupang's deeplink endpoint rejects
// already-tagged URLs with "url convert failed" if you try.
