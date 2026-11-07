import links from '../data/affiliateLinks.json';
import { handleAdmin } from './admin.js';
import { runAutoPublish } from './lib/publish.js';
import { addLog } from './lib/state.js';
import { recordClick } from './lib/clicks.js';
import { scheduledJob } from './lib/schedule.js';
import { handleTelegramWebhook, sendWeekly } from './lib/telegram.js';
import { updateLottoResults } from './lib/lottoResults.js';

// Cloaked affiliate redirect: /go/example-product -> real Coupang Partners URL.
// /admin* is the auto-publish control panel (HTTP Basic Auth, see admin.js).
// /telegram/webhook receives messages for the lotto bot (see lib/telegram.js).
// Everything else falls through to the static site build in `dist/` via ASSETS.
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/admin')) {
      return handleAdmin(request, env);
    }

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      return handleTelegramWebhook(request, env);
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

  async scheduled(controller, env, ctx) {
    const job = scheduledJob(controller.scheduledTime);
    if (job === 'publish') {
      ctx.waitUntil(
        runAutoPublish(env).catch((err) => addLog(env, { status: 'error', reason: err.message }))
      );
    } else if (job === 'lotto-send') {
      ctx.waitUntil(runLottoSend(env));
    } else if (job === 'lotto-results') {
      ctx.waitUntil(runLottoResults(env));
    }
  },
};

const lottoLog = (env, status, reason) => addLog(env, { kind: 'lotto', topic: '로또', status, reason });

async function runLottoSend(env) {
  try {
    const r = await sendWeekly(env);
    if (r.skipped || (!r.sent && !r.removed && !r.failed)) return;
    await lottoLog(
      env,
      'telegram',
      `제${r.round}회 ${r.sent}명 발송` +
        (r.removed ? `, 차단 ${r.removed}명 정리` : '') +
        (r.failed ? `, 실패 ${r.failed}명(다음 실행에 재시도)` : '') +
        (r.remaining ? `, 남은 ${r.remaining}명` : '')
    );
  } catch (err) {
    await lottoLog(env, 'error', `텔레그램 발송 실패: ${err.message}`);
  }
}

async function runLottoResults(env) {
  try {
    const r = await updateLottoResults(env);
    if (r.added.length) await lottoLog(env, 'results', `제${r.added.join(', ')}회 당첨번호 저장`);
  } catch (err) {
    await lottoLog(env, 'error', `당첨번호 저장 실패: ${err.message}`);
  }
}
