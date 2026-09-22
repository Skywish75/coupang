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
  // TEMP DEBUG: log the raw shape so we can confirm the correct field path
  // for the product list once a real response comes back. Remove once
  // parsing below is confirmed correct.
  console.log('coupang search raw response:', JSON.stringify(json).slice(0, 2000));
  return json.data?.productData ?? json.rData?.productData ?? json.data ?? [];
}

// Converts a Coupang product URL into the caller's own affiliate deep link.
export async function createDeeplink(env, coupangUrl) {
  const path = '/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink';
  const authorization = await authHeader(env, 'POST', path);

  const res = await fetch(`${API_HOST}${path}`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ coupangUrls: [coupangUrl] }),
  });

  if (!res.ok) {
    throw new Error(`Coupang deeplink failed (${res.status}): ${await res.text()}`);
  }

  const json = await res.json();
  return json.data?.[0]?.shortenUrl ?? json.data?.[0]?.landingUrl;
}
