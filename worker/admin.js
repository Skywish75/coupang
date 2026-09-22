import { getTopics, setTopics, getLogs } from './lib/state.js';
import { runAutoPublish } from './lib/publish.js';

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

async function renderPage(env, notice) {
  const topics = await getTopics(env);
  const logs = await getLogs(env);

  const logRows = logs
    .map(
      (l) => `<tr>
        <td>${escapeHtml(l.at)}</td>
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
<title>7mall 자동발행 관리자</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  section { margin-bottom: 2rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { border: 1px solid #e5e7eb; padding: 0.5rem; font-size: 0.85rem; text-align: left; }
  textarea { width: 100%; height: 120px; font-family: inherit; }
  button { padding: 0.6rem 1.1rem; cursor: pointer; border: none; border-radius: 6px; background: #ff6f0f; color: #fff; font-weight: 600; }
  .notice { background: #fff7ed; border: 1px solid #fed7aa; padding: 0.75rem 1rem; border-radius: 8px; }
</style>
</head>
<body>
  <h1>7mall 자동발행 관리자</h1>
  ${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ''}

  <section>
    <h2>지금 실행</h2>
    <p>다음 순서의 키워드로 상품을 찾아 즉시 1건을 자동 발행합니다.</p>
    <form method="post" action="/admin/api/run">
      <button type="submit">지금 1건 자동 발행</button>
    </form>
  </section>

  <section>
    <h2>키워드 목록 (한 줄에 하나씩, 순서대로 순환)</h2>
    <form method="post" action="/admin/api/topics">
      <textarea name="topics">${escapeHtml(topics.join('\n'))}</textarea>
      <button type="submit">저장</button>
    </form>
  </section>

  <section>
    <h2>최근 실행 로그</h2>
    <table>
      <thead><tr><th>시간</th><th>키워드</th><th>상태</th><th>비고</th></tr></thead>
      <tbody>${logRows || '<tr><td colspan="4">기록 없음</td></tr>'}</tbody>
    </table>
  </section>
</body>
</html>`;
}

export async function handleAdmin(request, env) {
  const authenticatedEmail = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (!authenticatedEmail) {
    return new Response(
      'Forbidden: 이 경로는 Cloudflare Access 뒤에서만 접근 가능합니다. Zero Trust에서 Access 애플리케이션을 먼저 설정하세요.',
      { status: 403 }
    );
  }

  const url = new URL(request.url);

  if (url.pathname === '/admin/api/run' && request.method === 'POST') {
    try {
      const result = await runAutoPublish(env);
      const html = await renderPage(
        env,
        result.status === 'published'
          ? `발행 완료: ${result.productName} (${result.topic})`
          : `건너뜀: ${result.topic} - 새로 소개할 상품 없음`
      );
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    } catch (err) {
      const html = await renderPage(env, `실행 실패: ${err.message}`);
      return new Response(html, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
  }

  if (url.pathname === '/admin/api/topics' && request.method === 'POST') {
    const form = await request.formData();
    const topics = String(form.get('topics') || '')
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
    await setTopics(env, topics);
    const html = await renderPage(env, '키워드 목록을 저장했습니다.');
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const html = await renderPage(env);
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
