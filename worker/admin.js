import links from '../data/affiliateLinks.json';
import { getTopics, setTopics, getLogs, addLog } from './lib/state.js';
import { runAutoPublish } from './lib/publish.js';
import { getSiteStats } from './lib/stats.js';
import { getClickStats } from './lib/clicks.js';
import { getAds, saveAds } from './lib/ads.js';
import { slugify } from './lib/slug.js';
import { shiftDate } from './lib/dates.js';

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

const num = (n) => Number(n ?? 0).toLocaleString('ko-KR');
const kstTime = (iso) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

function card(label, value, sub = '') {
  return `<div class="card"><div class="card-label">${escapeHtml(label)}</div><div class="card-value">${value}</div>${
    sub ? `<div class="card-sub">${escapeHtml(sub)}</div>` : ''
  }</div>`;
}

function table(headers, rows, empty) {
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows.length
    ? rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}">${escapeHtml(empty)}</td></tr>`;
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderStats(stats, clicks) {
  if (stats.error) {
    return `<p class="notice">통계를 불러오지 못했습니다: ${escapeHtml(stats.error)}</p>`;
  }
  const s = stats.value;
  const c = clicks.value;
  const clickCards = c
    ? [card('오늘 쿠팡 클릭', num(c.today)), card('최근 7일 클릭', num(c.last7)), card('최근 30일 클릭', num(c.last30))]
    : [card('쿠팡 클릭', '-', clicks.error ? '집계 오류' : 'DB 미연결')];

  const lastRun = s.lastRun
    ? `${kstTime(s.lastRun.at)} · ${escapeHtml(s.lastRun.status)} · ${escapeHtml(
        s.lastRun.productName ?? s.lastRun.reason ?? ''
      )}`
    : '기록 없음';

  const topicRows = s.posts.byTopic.map((t) => {
    const snap = s.comparisons[t.topic];
    return [
      escapeHtml(t.topic),
      num(t.count),
      escapeHtml(t.lastDate || '-'),
      snap
        ? `<a href="/compare/${encodeURIComponent(slugify(t.topic))}/" target="_blank">상품 ${snap.products.length}개 · ${escapeHtml(snap.updatedAt)}</a>`
        : '아직 없음',
      snap?.hasGuide ? '있음' : '-',
    ];
  });

  const dayRows = [];
  for (let i = 0; i < 14; i++) {
    const day = shiftDate(s.today, -i);
    dayRows.push([escapeHtml(day), num(s.posts.perDay[day]), c ? num(c.perDay[day]) : '-']);
  }

  const slugRows = (c?.topSlugs ?? []).map((r) => [
    `<a href="/go/${encodeURIComponent(r.slug)}" target="_blank" rel="noopener">${escapeHtml(links[r.slug]?.name ?? r.slug)}</a>`,
    num(r.n),
  ]);
  const pageRows = (c?.topPages ?? []).map((r) => [
    r.page ? `<a href="${escapeHtml(encodeURI(r.page))}" target="_blank">${escapeHtml(r.page)}</a>` : '(알 수 없음)',
    num(r.n),
  ]);

  return `
    <div class="cards">
      ${card('전체 글', num(s.posts.total))}
      ${card('최근 7일 글', num(s.posts.last7))}
      ${card('최근 30일 글', num(s.posts.last30))}
      ${card('가격 추적 상품', num(s.trackedProducts), s.pricesUpdatedAt ? `${s.pricesUpdatedAt} 기록` : '기록 없음')}
      ${card('비교 페이지', num(s.comparisonCount))}
      ${card('구매 가이드', num(s.guideCount))}
      ${clickCards.join('')}
    </div>
    <p class="muted">마지막 실행: ${lastRun}</p>

    <h3>키워드별</h3>
    ${table(['키워드', '글 수', '마지막 글', '비교 페이지', '가이드'], topicRows, '키워드 없음')}

    <h3>최근 14일</h3>
    ${table(['날짜', '발행 글', '쿠팡 클릭'], dayRows, '')}

    <h3>클릭 많은 상품 (최근 30일)</h3>
    ${table(['상품', '클릭'], slugRows, '아직 클릭 기록이 없습니다')}

    <h3>클릭이 나온 페이지 (최근 30일)</h3>
    ${table(['페이지', '클릭'], pageRows, '아직 클릭 기록이 없습니다')}
    <p class="muted">검색엔진 봇과 링크 미리보기 요청은 클릭에서 제외합니다.</p>`;
}

function renderAdsForm(ads) {
  const field = (name, label, help) => `
    <label for="ad-${name}">${label}</label>
    <p class="help">${help}</p>
    <textarea id="ad-${name}" name="${name}" spellcheck="false">${escapeHtml(ads[name] ?? '')}</textarea>`;

  return `
    <p>저장하면 GitHub에 커밋되고 자동 빌드를 거쳐 2~3분 뒤 사이트에 반영됩니다. 비워 두면 그 위치에는 광고가 나오지 않습니다.</p>
    <form method="post" action="/admin/api/ads">
      ${field('head', '① &lt;head&gt; 코드', '구글 애드센스 자동 광고 스크립트 등. 모든 페이지의 &lt;head&gt; 안에 들어갑니다.')}
      ${field('top', '② 상단 배너', '모든 페이지의 본문 위. 쿠팡 배너 코드를 넣으면 파트너스 고지 문구가 자동으로 붙습니다.')}
      ${field('bottom', '③ 본문 아래 배너', '상품 정리 글과 비교 페이지의 본문 아래.')}
      ${field('adsTxt', '④ ads.txt', '애드센스 승인 후 안내받는 줄(예: google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0)을 넣으면 /ads.txt 로 제공됩니다.')}
      <button type="submit">광고 설정 저장</button>
    </form>
    ${ads.updatedAt ? `<p class="muted">마지막 저장: ${kstTime(ads.updatedAt)}</p>` : ''}`;
}

const settle = (promise) => promise.then((value) => ({ value }), (err) => ({ error: err.message }));

async function renderPage(env, notice) {
  const [topics, logs, ads, stats, clicks] = await Promise.all([
    getTopics(env),
    getLogs(env),
    getAds(env),
    settle(getSiteStats(env)),
    settle(getClickStats(env)),
  ]);

  const logRows = logs
    .map(
      (l) => `<tr>
        <td>${escapeHtml(kstTime(l.at))}</td>
        <td>${escapeHtml(l.topic ?? '')}</td>
        <td>${escapeHtml(l.status)}</td>
        <td>${escapeHtml(l.productName ?? l.reason ?? '')}</td>
      </tr>`
    )
    .join('');

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>7mall 자동발행 관리자</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  nav a { margin-right: 1rem; color: #ff6f0f; }
  section { margin-bottom: 2.5rem; }
  h3 { margin-top: 1.75rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.75rem; }
  th, td { border: 1px solid #e5e7eb; padding: 0.5rem; font-size: 0.85rem; text-align: left; }
  th { background: #f9fafb; }
  textarea { width: 100%; height: 120px; font-family: ui-monospace, monospace; font-size: 0.8rem; box-sizing: border-box; }
  label { display: block; font-weight: 600; margin-top: 1.25rem; }
  .help, .muted { color: #6b7280; font-size: 0.8rem; margin: 0.25rem 0 0.4rem; }
  button { margin-top: 1rem; padding: 0.6rem 1.1rem; cursor: pointer; border: none; border-radius: 6px; background: #ff6f0f; color: #fff; font-weight: 600; }
  .notice { background: #fff7ed; border: 1px solid #fed7aa; padding: 0.75rem 1rem; border-radius: 8px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.75rem; }
  .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 0.8rem 0.9rem; }
  .card-label { color: #6b7280; font-size: 0.8rem; }
  .card-value { font-size: 1.5rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .card-sub { color: #6b7280; font-size: 0.75rem; }
</style>
</head>
<body>
  <h1>7mall 자동발행 관리자</h1>
  <nav><a href="#stats">통계</a><a href="#run">지금 실행</a><a href="#topics">키워드</a><a href="#ads">광고</a><a href="#logs">로그</a></nav>
  ${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ''}

  <section id="stats">
    <h2>통계</h2>
    ${renderStats(stats, clicks)}
  </section>

  <section id="run">
    <h2>지금 실행</h2>
    <p>모든 키워드의 가격·비교 데이터를 갱신하고, 다음 순서의 키워드로 상품을 찾아 즉시 1건을 자동 발행합니다.</p>
    <form method="post" action="/admin/api/run">
      <button type="submit">지금 실행 (데이터 갱신 + 1건 발행)</button>
    </form>
  </section>

  <section id="topics">
    <h2>키워드 목록 (한 줄에 하나씩, 순서대로 순환)</h2>
    <form method="post" action="/admin/api/topics">
      <textarea name="topics">${escapeHtml(topics.join('\n'))}</textarea>
      <button type="submit">저장</button>
    </form>
  </section>

  <section id="ads">
    <h2>광고 코드</h2>
    ${renderAdsForm(ads)}
  </section>

  <section id="logs">
    <h2>최근 실행 로그</h2>
    <table>
      <thead><tr><th>시간</th><th>키워드</th><th>상태</th><th>비고</th></tr></thead>
      <tbody>${logRows || '<tr><td colspan="4">기록 없음</td></tr>'}</tbody>
    </table>
  </section>
</body>
</html>`;
}

// Simple HTTP Basic Auth in front of /admin, checked against the
// ADMIN_USERNAME / ADMIN_PASSWORD secrets. No Cloudflare Access / Zero
// Trust subscription required.
function isAuthorized(request, env) {
  const header = request.headers.get('Authorization');
  if (!header || !header.startsWith('Basic ')) {
    return false;
  }
  const decoded = atob(header.slice('Basic '.length));
  const separatorIndex = decoded.indexOf(':');
  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);
  return username === env.ADMIN_USERNAME && password === env.ADMIN_PASSWORD;
}

// Browsers resend Basic Auth credentials on cross-site form posts, so without
// this another site could submit the ad form and inject script into every page.
function isSameOriginPost(request, url) {
  const origin = request.headers.get('Origin');
  if (origin) {
    return origin === url.origin;
  }
  return request.headers.get('Sec-Fetch-Site') !== 'cross-site';
}

function unauthorizedResponse() {
  return new Response('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="7mall admin"' },
  });
}

const htmlResponse = (html, status = 200) =>
  new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

export async function handleAdmin(request, env) {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
    return new Response(
      'Forbidden: ADMIN_USERNAME / ADMIN_PASSWORD secret이 설정되지 않았습니다.',
      { status: 403 }
    );
  }
  if (!isAuthorized(request, env)) {
    return unauthorizedResponse();
  }

  const url = new URL(request.url);
  if (request.method === 'POST' && !isSameOriginPost(request, url)) {
    return new Response('Forbidden: cross-site request', { status: 403 });
  }

  if (url.pathname === '/admin/api/run' && request.method === 'POST') {
    try {
      const result = await runAutoPublish(env);
      return htmlResponse(
        await renderPage(
          env,
          result.status === 'published'
            ? `발행 완료: ${result.productName} (${result.topic})`
            : `글 발행 건너뜀 (가격 데이터는 저장됨): ${result.topic} - ${result.reason}`
        )
      );
    } catch (err) {
      await addLog(env, { status: 'error', reason: err.message });
      return htmlResponse(await renderPage(env, `실행 실패: ${err.message}`), 500);
    }
  }

  if (url.pathname === '/admin/api/topics' && request.method === 'POST') {
    const form = await request.formData();
    const topics = String(form.get('topics') || '')
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
    await setTopics(env, topics);
    return htmlResponse(await renderPage(env, '키워드 목록을 저장했습니다.'));
  }

  if (url.pathname === '/admin/api/ads' && request.method === 'POST') {
    const form = await request.formData();
    await saveAds(env, Object.fromEntries(form));
    return htmlResponse(await renderPage(env, '광고 설정을 저장했습니다. 자동 빌드 후 2~3분 뒤 사이트에 반영됩니다.'));
  }

  return htmlResponse(await renderPage(env));
}
