import links from '../data/affiliateLinks.json';
import { getTopics, setTopics, getLogs, addLog } from './lib/state.js';
import { runAutoPublish } from './lib/publish.js';
import { getSiteStats } from './lib/stats.js';
import { getClickStats } from './lib/clicks.js';
import { getAds, saveAds } from './lib/ads.js';
import { slugify } from './lib/slug.js';
import { shiftDate } from './lib/dates.js';
import { connectBot, sendWeekly, getTelegramStatus } from './lib/telegram.js';
import { updateLottoResults } from './lib/lottoResults.js';
import { getDrafts, createThreadsDraft, candidateLabel, candidateReason, AD_TAG } from './lib/threads.js';

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

function renderLotto(status) {
  if (status.error) {
    return `<p class="notice">상태를 불러오지 못했습니다: ${escapeHtml(status.error)}</p>`;
  }
  const t = status.value;
  const connected = t.webhookUrl.endsWith('/telegram/webhook');
  const steps = t.tokenSet
    ? ''
    : `<ol class="help">
        <li>텔레그램에서 <b>@BotFather</b>에게 <code>/newbot</code>을 보내 봇을 만들고 토큰을 받습니다.</li>
        <li>Cloudflare 대시보드 → Workers &amp; Pages → coupang → 설정 → 변수 및 비밀(Variables and Secrets)에서
            <b>비밀(Secret)</b> 이름 <code>TELEGRAM_BOT_TOKEN</code>, 값에 토큰을 넣고 배포합니다.</li>
        <li>이 페이지를 새로고침한 뒤 아래 <b>텔레그램 봇 연결</b>을 누릅니다.</li>
      </ol>`;
  return `
    <div class="cards">
      ${card('봇 토큰', t.tokenSet ? '등록됨' : '없음')}
      ${card('웹훅', connected ? '연결됨' : '미연결', t.webhookError ? `최근 오류: ${t.webhookError}` : '')}
      ${card('구독자', t.subscribers === null ? '-' : num(t.subscribers), `제${t.round}회 발송 ${num(t.sentThisRound)}명`)}
      ${card('저장된 당첨번호', t.latestResult ? `제${t.latestResult}회` : '없음', '토 22시·일 0시/10시 자동 수집')}
    </div>
    ${t.botUsername ? `<p>봇: <a href="https://t.me/${escapeHtml(t.botUsername)}" target="_blank" rel="noopener">@${escapeHtml(t.botUsername)}</a> · /lotto 페이지에 "텔레그램으로 매주 받기" 버튼이 표시됩니다.</p>` : ''}
    ${steps}
    <p class="muted">매주 토요일 오전 10~12시에 구독자에게 그 주 추천 번호 5게임과 지난주 결과를 보냅니다(무료 플랜 제한으로 매시 최대 40명씩).</p>
    <div class="row">
      <form method="post" action="/admin/api/telegram/connect"><button type="submit" ${t.tokenSet ? '' : 'disabled'}>텔레그램 봇 연결</button></form>
      <form method="post" action="/admin/api/telegram/send"><button type="submit" ${connected ? '' : 'disabled'}>이번 회차 번호 지금 보내기</button></form>
      <form method="post" action="/admin/api/lotto/results"><button type="submit">당첨번호 지금 가져오기</button></form>
    </div>`;
}

function renderThreads(stats, drafts) {
  const intro = `
    <p>사이트에 매일 쌓이는 실제 가격 기록으로 스레드 본글과 댓글 초안을 만듭니다. 올리는 건 직접 하세요.</p>
    <ul class="help">
      <li>본글 맨 앞에 <b>${escapeHtml(AD_TAG)}</b>, 마지막 댓글에 가격 비교 페이지 링크와 쿠팡 파트너스 고지 문구가 자동으로 붙습니다. 첫 줄을 다른 후보로 바꿔도 이 표시는 지우지 마세요.</li>
      <li>가격 글과 링크 없는 정보글을 번갈아 올리면 광고만 하는 계정처럼 보이지 않아요.</li>
      <li>고른 상품을 직접 써 봤다면 메모를 남기세요. 메모가 없으면 사용 후기 없이 가격 사실과 상황만으로 씁니다.</li>
    </ul>`;
  if (stats.error) {
    return `${intro}<p class="notice">후보를 불러오지 못했습니다: ${escapeHtml(stats.error)}</p>${renderDrafts(drafts)}`;
  }

  const { deals, units, tips } = stats.value.threads;
  let n = 0;
  // The first candidate starts selected: with nothing picked a browser just
  // shows a small tooltip and sends nothing, which looked like a dead button.
  const radio = (value, label) => {
    n += 1;
    return `<td><input type="radio" name="candidate" value="${escapeHtml(value)}" id="tc-${n}"${n === 1 ? ' checked' : ''} /></td>
      <td><label class="plain" for="tc-${n}">${escapeHtml(label)}</label></td>`;
  };
  const group = (title, list, empty) =>
    `<tr class="group"><th colspan="3">${escapeHtml(title)}</th></tr>` +
    (list.length
      ? list.map((c) => `<tr>${radio(c.id, candidateLabel(c))}<td>${escapeHtml(candidateReason(c))}</td></tr>`).join('')
      : `<tr><td colspan="3" class="muted">${escapeHtml(empty)}</td></tr>`);
  // Built in table order so the first row (the biggest price drop) is the default.
  const dealRows = group('가격 내린 상품 · 30일 최저가', deals, '오늘은 눈에 띄게 내린 상품이 없어요.');
  const unitRows = group('단위 가격 차이', units, '오늘은 단위 가격 차이가 큰 카테고리가 없어요.');
  const tipRow = tips.length
    ? `<tr class="group"><th colspan="3">정보글 (링크 없음)</th></tr>
       <tr>${radio('tip', '구매 가이드로 정보글')}<td><select name="tipTopic" aria-label="정보글 카테고리">${tips
         .map((t) => `<option>${escapeHtml(t.topic)}</option>`)
         .join('')}</select></td></tr>`
    : '';

  return `${intro}
    <form method="post" action="/admin/api/threads" id="threads-form">
      <table class="pick">
        <thead><tr><th></th><th>후보</th><th>근거 (${escapeHtml(stats.value.pricesUpdatedAt ?? '-')} 기록)</th></tr></thead>
        <tbody>
          ${dealRows}
          ${unitRows}
          ${tipRow}
        </tbody>
      </table>
      <label for="threads-memo">내가 직접 써 본 메모 (선택)</label>
      <p class="help">얼마나 썼는지, 언제 쓰는지, 좋았던 점, 아쉬운 점. 고른 상품을 실제로 써 봤을 때만 적으세요.</p>
      <textarea id="threads-memo" name="memo" maxlength="1000"></textarea>
      <button type="submit">초안 만들기</button> <span class="muted">10~20초 걸려요</span>
    </form>
    ${renderDrafts(drafts)}`;
}

function renderDrafts(drafts) {
  if (!drafts.length) return '<p class="muted">아직 만든 초안이 없습니다.</p>';
  // Extra rows for lines that wrap (the link line always does on phones).
  const rows = (text) => Math.min(18, text.split('\n').length + 3);
  const box = (id, label, text) => `
    <div class="draft-box">
      <div class="draft-head"><span>${escapeHtml(label)}</span><button type="button" class="small" data-copy="${id}">복사</button></div>
      <textarea id="${id}" rows="${rows(text)}">${escapeHtml(text)}</textarea>
    </div>`;

  const items = drafts.map((d, i) => {
    const warnings = d.warnings.length
      ? `<ul class="warn">${d.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`
      : '<p class="ok">자동 점검: 고칠 점 없음</p>';
    const hooks = d.hooks.length
      ? `<p class="sub">첫 줄 후보 <span class="muted">(본글은 1번으로 시작해요)</span></p>
         <ol class="hooks">${d.hooks
           .map((h) => `<li>${escapeHtml(h.text)} <span class="muted">· ${escapeHtml(h.type)} — ${escapeHtml(h.why)}</span></li>`)
           .join('')}</ol>`
      : '';
    const last = d.comments.length - 1;
    const comments = d.comments
      .map((c, j) => box(`d-${d.id}-c${j}`, `댓글 ${j + 1}${j === last && d.link ? ' · 링크' : ''}`, c))
      .join('');
    const checks = d.checks.length
      ? `<p class="sub">AI가 짚은 확인할 점</p><ul class="help">${d.checks.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`
      : '';
    return `
      <details class="draft"${i === 0 ? ' open' : ''}>
        <summary>${escapeHtml(kstTime(d.at))} · ${escapeHtml(d.label)}</summary>
        <p class="muted">${escapeHtml(d.reason)}${d.withMemo ? ' · 사용 메모 반영' : ''}${d.model ? ` · ${escapeHtml(d.model)}` : ''}</p>
        ${warnings}
        ${hooks}
        ${box(`d-${d.id}-post`, '본글', d.post)}
        ${comments}
        ${checks}
      </details>`;
  });
  return `<h3>최근 초안</h3>${items.join('')}`;
}

const settle = (promise) => promise.then((value) => ({ value }), (err) => ({ error: err.message }));

async function renderPage(env, notice, { focus } = {}) {
  const [topics, logs, ads, stats, clicks, lotto, drafts] = await Promise.all([
    getTopics(env),
    getLogs(env),
    getAds(env),
    settle(getSiteStats(env)),
    settle(getClickStats(env)),
    settle(getTelegramStatus(env)),
    getDrafts(env),
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
<title>가격일기 관리자</title>
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
  button:disabled { background: #d1d5db; cursor: not-allowed; }
  .row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .row form { margin: 0; }
  ol.help { padding-left: 1.2rem; font-size: 0.85rem; color: #374151; }
  .notice { background: #fff7ed; border: 1px solid #fed7aa; padding: 0.75rem 1rem; border-radius: 8px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.75rem; }
  .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 0.8rem 0.9rem; }
  .card-label { color: #6b7280; font-size: 0.8rem; }
  .card-value { font-size: 1.5rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .card-sub { color: #6b7280; font-size: 0.75rem; }
  table.pick tr.group th { background: #fff7ed; }
  label.plain { display: inline; font-weight: 400; margin: 0; }
  details.draft { border: 1px solid #e5e7eb; border-radius: 10px; padding: 0.6rem 0.9rem; margin-top: 0.75rem; }
  details.draft summary { cursor: pointer; font-weight: 600; }
  .draft-box { margin-top: 0.75rem; }
  .draft-head { display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; font-weight: 600; margin-bottom: 0.25rem; }
  .draft textarea { height: auto; font-family: inherit; font-size: 0.9rem; line-height: 1.5; }
  button.small { margin: 0; padding: 0.25rem 0.7rem; font-size: 0.75rem; background: #374151; }
  ul.warn { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 0.5rem 0.75rem 0.5rem 1.6rem; font-size: 0.85rem; }
  .ok { color: #15803d; font-size: 0.85rem; }
  .sub { font-weight: 600; font-size: 0.85rem; margin: 0.9rem 0 0.25rem; }
  ol.hooks { font-size: 0.9rem; padding-left: 1.3rem; margin: 0; }
</style>
</head>
<body>
  <h1>가격일기 관리자</h1>
  <nav><a href="#threads">스레드</a><a href="#stats">통계</a><a href="#run">지금 실행</a><a href="#topics">키워드</a><a href="#ads">광고</a><a href="#lotto">로또·텔레그램</a><a href="#logs">로그</a></nav>
  ${notice && !focus ? `<p class="notice">${escapeHtml(notice)}</p>` : ''}

  <!-- First: the button used most, so it isn't confused with 지금 실행 below. -->
  <section id="threads">
    <h2>스레드 초안</h2>
    ${notice && focus === 'threads' ? `<p class="notice">${escapeHtml(notice)}</p>` : ''}
    ${renderThreads(stats, drafts)}
  </section>

  <section id="stats">
    <h2>통계</h2>
    ${renderStats(stats, clicks)}
  </section>

  <section id="run">
    <h2>지금 실행</h2>
    <p>모든 키워드의 쿠팡 가격을 지금 기록하고 비교·가격 변동 페이지를 갱신합니다. 구매 가이드가 없는 키워드가 있으면 1개 작성합니다. (매일 오전 9시에 자동으로도 실행됩니다)</p>
    <form method="post" action="/admin/api/run">
      <button type="submit">지금 실행 (가격 데이터 갱신)</button>
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

  <section id="lotto">
    <h2>로또 번호 · 텔레그램</h2>
    ${renderLotto(lotto)}
  </section>

  <section id="logs">
    <h2>최근 실행 로그</h2>
    <table>
      <thead><tr><th>시간</th><th>키워드</th><th>상태</th><th>비고</th></tr></thead>
      <tbody>${logRows || '<tr><td colspan="4">기록 없음</td></tr>'}</tbody>
    </table>
  </section>
  <script>
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-copy]');
      if (!b) return;
      const t = document.getElementById(b.dataset.copy);
      navigator.clipboard.writeText(t.value).then(
        () => { b.textContent = '복사됨'; setTimeout(() => (b.textContent = '복사'), 1500); },
        () => t.select()
      );
    });
    document.getElementById('threads-form')?.addEventListener('submit', (e) => {
      const b = e.target.querySelector('button[type=submit]');
      b.disabled = true;
      b.textContent = '만드는 중… 10~20초 걸려요';
    });
    document.querySelector('select[name=tipTopic]')?.addEventListener('change', (e) => {
      e.target.closest('tr').querySelector('input[type=radio]').checked = true;
    });
    ${focus ? `document.getElementById(${JSON.stringify(focus)})?.scrollIntoView();` : ''}
  </script>
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

export async function handleAdmin(request, env, ctx) {
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
      // A run takes ~25s; if the browser leaves or reloads meanwhile,
      // waitUntil keeps it going instead of cancelling it half-way.
      const run = runAutoPublish(env);
      ctx?.waitUntil(run.catch(() => {}));
      const result = await run;
      return htmlResponse(
        await renderPage(
          env,
          `가격 데이터 갱신 완료 (키워드 ${result.tracked}개)` +
            (result.guideTopic ? ` · 가이드 작성: ${result.guideTopic}` : '') +
            (result.reason ? ` · 문제: ${result.reason}` : '') +
            ' · 1~2분 뒤 사이트에 반영됩니다.'
        )
      );
    } catch (err) {
      await addLog(env, { status: 'error', reason: err.message });
      return htmlResponse(await renderPage(env, `실행 실패: ${err.message}`), 500);
    }
  }

  if (url.pathname === '/admin/api/threads' && request.method === 'POST') {
    const form = await request.formData();
    let id = String(form.get('candidate') || '');
    if (id === 'tip') id = `tip:${String(form.get('tipTopic') || '')}`;
    if (!id) {
      return htmlResponse(await renderPage(env, '후보를 하나 골라 주세요.', { focus: 'threads' }), 400);
    }
    try {
      // Like the run above: keep going (and save to KV) if the browser leaves.
      const job = createThreadsDraft(env, { id, memo: String(form.get('memo') || ''), origin: url.origin });
      ctx?.waitUntil(job.catch(() => {}));
      const draft = await job;
      await addLog(env, { kind: 'threads', topic: '스레드 초안', status: 'draft', reason: draft.label });
      const msg =
        `스레드 초안을 만들었습니다: ${draft.label}` +
        (draft.warnings.length ? ` · 올리기 전에 고칠 점 ${draft.warnings.length}개` : ' · 자동 점검 통과');
      return htmlResponse(await renderPage(env, msg, { focus: 'threads' }));
    } catch (err) {
      console.error('threads draft failed', id, err);
      await addLog(env, { kind: 'threads', topic: '스레드 초안', status: 'error', reason: `${id} · ${err.message}`.slice(0, 500) });
      return htmlResponse(await renderPage(env, `초안 만들기 실패: ${err.message}`, { focus: 'threads' }), 500);
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

  if (url.pathname === '/admin/api/telegram/connect' && request.method === 'POST') {
    try {
      const r = await connectBot(env, url.origin);
      return htmlResponse(
        await renderPage(
          env,
          `@${r.username} 봇을 연결했습니다.` +
            (r.committed ? ' /lotto 페이지의 텔레그램 버튼은 자동 빌드 후 2~3분 뒤 나타납니다.' : '')
        )
      );
    } catch (err) {
      return htmlResponse(await renderPage(env, `봇 연결 실패: ${err.message}`), 500);
    }
  }

  if (url.pathname === '/admin/api/telegram/send' && request.method === 'POST') {
    try {
      const r = await sendWeekly(env);
      const msg = r.skipped
        ? '봇 토큰 또는 DB가 설정되지 않았습니다.'
        : `제${r.round}회 번호를 ${r.sent}명에게 보냈습니다.` +
          (r.removed ? ` 봇을 차단한 ${r.removed}명은 정리했습니다.` : '') +
          (r.failed ? ` ${r.failed}명은 실패했습니다.` : '') +
          (r.remaining ? ` 남은 ${r.remaining}명은 다시 누르거나 다음 자동 실행 때 보냅니다.` : '');
      return htmlResponse(await renderPage(env, msg));
    } catch (err) {
      return htmlResponse(await renderPage(env, `발송 실패: ${err.message}`), 500);
    }
  }

  if (url.pathname === '/admin/api/lotto/results' && request.method === 'POST') {
    try {
      const r = await updateLottoResults(env);
      const msg = r.added.length
        ? `제${r.added.join(', ')}회 당첨번호를 저장했습니다. 자동 빌드 후 2~3분 뒤 /lotto 페이지에 반영됩니다.`
        : r.missing.length
          ? `제${r.latest}회 당첨번호가 아직 공개되지 않았습니다(보통 토요일 21시쯤 공개).`
          : `이미 최신(제${r.latest}회)까지 저장되어 있습니다.`;
      return htmlResponse(await renderPage(env, msg));
    } catch (err) {
      return htmlResponse(await renderPage(env, `당첨번호 가져오기 실패: ${err.message}`), 500);
    }
  }

  return htmlResponse(await renderPage(env));
}
