import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { scheduledJob } from './schedule.js';
import { handleUpdate, handleTelegramWebhook, sendWeekly, webhookSecret, excludeReply } from './telegram.js';
import { updateLottoResults, fetchResult, serializeResults } from './lottoResults.js';

const kst = (iso) => Date.parse(`${iso}+09:00`);
const R1248 = { date: '2026-10-31', numbers: [16, 18, 27, 36, 38, 42], bonus: 22 };

// Fake D1: records statements and answers the few queries telegram.js makes.
function fakeDb(rows = []) {
  const log = [];
  const stmt = (sql, args = []) => ({
    sql,
    args,
    bind: (...a) => stmt(sql, a),
    run: async () => log.push({ sql, args }),
    all: async () => ({ results: /SELECT chat_id/.test(sql) ? rows : [] }),
    first: async () => ({ n: 0, total: rows.length, sent: 0 }),
  });
  return {
    log,
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => stmts.forEach((s) => log.push({ sql: s.sql, args: s.args, batch: true })),
  };
}

// Fake fetch: Telegram API, GitHub contents and the results mirror.
let sent;
let telegramStatus;
beforeEach(() => {
  sent = [];
  telegramStatus = {};
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.host === 'api.telegram.org') {
      const body = JSON.parse(init.body);
      const status = telegramStatus[body.chat_id] ?? 200;
      sent.push({ method: url.pathname.split('/').pop(), ...body });
      return new Response(
        JSON.stringify(status === 200 ? { ok: true, result: {} } : { ok: false, description: 'Forbidden: bot was blocked by the user' }),
        { status }
      );
    }
    if (url.host === 'api.github.com') {
      if (url.pathname.endsWith('/contents/data/lottoResults.json')) return new Response(JSON.stringify({ 1248: R1248 }));
      return new Response('Not Found', { status: 404 });
    }
    if (url.host === 'smok95.github.io') {
      if (url.pathname.endsWith('/1248.json')) {
        return new Response(JSON.stringify({ draw_no: 1248, numbers: [42, 16, 18, 27, 36, 38], bonus_no: 22 }));
      }
      return new Response('Not Found', { status: 404 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
});

const env = (rows) => ({ TELEGRAM_BOT_TOKEN: '123:abc', GITHUB_REPO: 'o/r', DB: fakeDb(rows) });
const message = (text, type = 'private') => ({ message: { chat: { id: 77, type }, text } });

test('scheduledJob keeps the daily publish and adds the Saturday lotto jobs', () => {
  assert.equal(scheduledJob(kst('2026-11-04T09:00:00')), 'publish'); // Wednesday
  assert.equal(scheduledJob(kst('2026-11-07T09:00:00')), 'publish'); // Saturday
  assert.equal(scheduledJob(kst('2026-11-07T10:00:00')), 'lotto-send');
  assert.equal(scheduledJob(kst('2026-11-07T12:00:00')), 'lotto-send');
  assert.equal(scheduledJob(kst('2026-11-07T22:00:00')), 'lotto-results');
  assert.equal(scheduledJob(kst('2026-11-08T00:00:00')), 'lotto-results');
  assert.equal(scheduledJob(kst('2026-11-08T10:00:00')), 'lotto-results');
  assert.equal(scheduledJob(kst('2026-11-04T10:00:00')), null); // weekday extra hours do nothing
  assert.equal(scheduledJob(kst('2026-11-04T22:00:00')), null);
});

test('/start subscribes and sends help plus numbers with the disclaimer', async () => {
  const e = env();
  await handleUpdate(e, message('/start lotto'), kst('2026-11-05T12:00:00'));
  assert.ok(e.DB.log.some((s) => /INSERT INTO lotto_subscribers/.test(s.sql) && s.args[0] === 77));
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /제1249회 추천 번호/);
  assert.match(sent[1].text, /당첨을 약속하지 않습니다/);
  assert.equal(sent[1].text.split('\n').filter((l) => /^[A-E] {2}\d\d( \d\d){5}$/.test(l)).length, 5);
});

test('/stop deletes the subscriber; group chats are ignored', async () => {
  const e = env();
  await handleUpdate(e, message('/stop'));
  assert.ok(e.DB.log.some((s) => /DELETE FROM lotto_subscribers/.test(s.sql)));
  sent = [];
  await handleUpdate(e, message('/numbers', 'group'));
  assert.equal(sent.length, 0);
});

test('sent numbers are excluded from the reply', async () => {
  await handleUpdate(env(), message('3 11 19 27 35 42\n5 14 21 29 32 40'));
  const lines = sent[0].text.split('\n').filter((l) => /^[A-E] {2}/.test(l));
  assert.equal(lines.length, 5);
  const banned = new Set([3, 11, 19, 27, 35, 42, 5, 14, 21, 29, 32, 40]);
  for (const line of lines) {
    for (const n of line.slice(3).split(' ').map(Number)) assert.ok(!banned.has(n), line);
  }
  assert.match(sent[0].text, /2게임의 번호 12개를 빼고/);
});

test('too many sent numbers falls back to avoiding the same combinations', () => {
  const bought = [];
  for (let i = 0; i < 8; i++) bought.push([1, 2, 3, 4, 5, 6].map((n) => ((n + i * 6 - 1) % 45) + 1));
  const text = excludeReply(1249, bought);
  assert.match(text, /같은 조합만 피했어요/);
});

test('webhook rejects requests without the secret header', async () => {
  const e = env();
  const bad = await handleTelegramWebhook(
    new Request('https://x/telegram/webhook', { method: 'POST', body: JSON.stringify(message('/numbers')) }),
    e
  );
  assert.equal(bad.status, 403);
  const ok = await handleTelegramWebhook(
    new Request('https://x/telegram/webhook', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': await webhookSecret(e) },
      body: JSON.stringify(message('/numbers')),
    }),
    e
  );
  assert.equal(ok.status, 200);
  assert.equal(sent.length, 1);
});

test('sendWeekly includes last week result, records games and drops blocked users', async () => {
  const rows = [
    { chat_id: 1, last_round: 1248, last_games: JSON.stringify([[1, 2, 3, 16, 18, 27], [1, 2, 3, 4, 5, 6]]) },
    { chat_id: 2, last_round: 0, last_games: null },
  ];
  telegramStatus[2] = 403;
  const e = env(rows);
  const r = await sendWeekly(e, kst('2026-11-07T10:00:00'));
  assert.deepEqual({ round: r.round, sent: r.sent, removed: r.removed, failed: r.failed }, { round: 1249, sent: 1, removed: 1, failed: 0 });
  assert.match(sent[0].text, /지난 제1248회 추천 번호 결과/);
  assert.match(sent[0].text, /A {2}3개 일치 → 5등 당첨/);
  assert.match(sent[0].text, /B {2}0개 일치/);
  assert.match(sent[0].text, /제1249회 추천 번호/);
  const batch = e.DB.log.filter((s) => s.batch);
  assert.ok(/UPDATE lotto_subscribers/.test(batch[0].sql) && batch[0].args[0] === 1249 && batch[0].args[2] === 1);
  assert.ok(/DELETE FROM lotto_subscribers/.test(batch[1].sql) && batch[1].args[0] === 2);
});

test('updateLottoResults fetches only missing rounds and commits once', async () => {
  const blobs = [];
  const base = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const json = (b) => new Response(JSON.stringify(b));
    if (url.pathname.endsWith('/contents/data/lottoResults.json')) {
      return json({ 1245: R1248, 1246: R1248, 1247: R1248 }); // 1248 missing
    }
    if (url.pathname.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'base' } });
    if (url.pathname.endsWith('/git/commits/base')) return json({ tree: { sha: 't0' } });
    if (url.pathname.endsWith('/git/blobs')) {
      blobs.push(JSON.parse(init.body).content);
      return json({ sha: 'b' });
    }
    if (url.host === 'api.github.com') return json({ sha: 'x' });
    return base(input, init);
  };
  const r = await updateLottoResults({ GITHUB_REPO: 'o/r', GITHUB_TOKEN: 't' }, kst('2026-11-01T00:00:00'));
  assert.deepEqual(r.added, [1248]);
  assert.deepEqual(JSON.parse(blobs[0])[1248], R1248);
  assert.equal(blobs.length, 1);
  globalThis.fetch = base;
});

test('fetchResult returns null for unpublished or mismatched rounds', async () => {
  assert.deepEqual(await fetchResult(1248), R1248);
  assert.equal(await fetchResult(1249), null);
  assert.equal(serializeResults({}), '{}\n');
});
