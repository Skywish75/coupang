import {
  MAX_GAMES,
  GAME_LABELS,
  roundFor,
  drawDate,
  generateGames,
  parseTypedGames,
  checkGame,
  decodeStartPayload,
  pad,
} from '../../src/lib/lotto.js';
import { getJsonFile, commitFiles } from './github.js';
import { RESULTS_PATH } from './lottoResults.js';

// Telegram bot for the /lotto page: people who press /start get random
// numbers every Saturday morning, plus last week's result for the numbers
// they were sent. Subscribers live in D1 (binding DB).
//
// Setup (once): create a bot with @BotFather, store its token as the
// TELEGRAM_BOT_TOKEN secret, then press "텔레그램 봇 연결" in /admin.

export const TELEGRAM_CONFIG_PATH = 'data/telegram.json';
// Free plan: 50 outgoing requests per run. One GitHub read + 40 messages
// leaves headroom; the rest go out on the next hourly run.
export const SEND_BATCH = 40;
const API = 'https://api.telegram.org';

export const DISCLAIMER = '⚠️ 무작위로 만든 조합이며 당첨을 약속하지 않습니다.';

const HELP = [
  '사용 방법',
  '• 매주 토요일 오전 10시쯤 그 주 추천 번호 5게임을 보내 드려요.',
  '• 이미 산 번호를 보내 주시면 그 번호를 빼고 다시 뽑아 드려요.',
  '  예) 3 11 19 27 35 42  (여러 게임은 줄을 바꿔서)',
  '  용지 QR을 휴대폰 카메라로 찍어 나온 주소를 붙여넣어도 돼요.',
  '• /numbers 지금 바로 번호 받기',
  '• /stop 매주 알림 끄기  · /start 다시 켜기',
].join('\n');

// --- Telegram API ----------------------------------------------------------

export async function callTelegram(env, method, body = {}) {
  const res = await fetch(`${API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const err = new Error(`Telegram ${method} 실패 (${res.status}): ${data.description ?? ''}`);
    err.status = res.status;
    throw err;
  }
  return data.result;
}

/** Webhook secret derived from the bot token, so no second secret is needed.
 * Keep the "7mall-" prefix (the old site name): changing it changes the secret,
 * and the bot would reject every update until "봇 연결" is pressed again. */
export async function webhookSecret(env) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`7mall-telegram-webhook:${env.TELEGRAM_BOT_TOKEN}`)
  );
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- subscribers (D1) ------------------------------------------------------

// Created on first use so no manual `wrangler d1 migrations apply` is needed
// (same schema as migrations/0002_lotto_subscribers.sql).
let tableReady = false;
async function ensureTable(env) {
  if (tableReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS lotto_subscribers (
       chat_id INTEGER PRIMARY KEY,
       subscribed_at TEXT NOT NULL,
       last_round INTEGER NOT NULL DEFAULT 0,
       last_games TEXT
     )`
  ).run();
  tableReady = true;
}

// --- messages --------------------------------------------------------------

const monthDay = (date) => {
  const [, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일`;
};

export function numbersText(round, games, note = '') {
  const lines = [`🎱 로또 6/45 제${round}회 추천 번호 (${monthDay(drawDate(round))} 추첨)`];
  games.forEach((g, i) => lines.push(`${GAME_LABELS[i]}  ${g.map(pad).join(' ')}`));
  if (note) lines.push(note);
  lines.push('', DISCLAIMER);
  return lines.join('\n');
}

export function resultText(round, games, result) {
  const lines = [
    `📋 지난 제${round}회 추천 번호 결과`,
    `당첨 번호  ${result.numbers.map(pad).join(' ')} + 보너스 ${pad(result.bonus)}`,
  ];
  games.forEach((g, i) => {
    const c = checkGame(g, result);
    const hit = `${c.matched.length}개 일치${c.bonus ? ' + 보너스' : ''}`;
    lines.push(`${GAME_LABELS[i]}  ${hit}${c.rank ? ` → ${c.rank}등 당첨` : ''}`);
  });
  return lines.join('\n');
}

/** Numbers drawn without any number from the games the person bought. */
export function excludeReply(round, bought, randInt) {
  const excluded = [...new Set(bought.flat())];
  let drawn = generateGames({ count: MAX_GAMES, excluded, avoid: bought, randInt });
  let note = `(보내 주신 ${bought.length}게임의 번호 ${excluded.length}개를 빼고 뽑았어요)`;
  if (drawn.error) {
    drawn = generateGames({ count: MAX_GAMES, avoid: bought, randInt });
    note = '(보내 주신 번호가 너무 많아 번호는 빼지 못하고, 같은 조합만 피했어요)';
  }
  return numbersText(round, drawn.games, note);
}

// --- webhook ---------------------------------------------------------------

export async function handleTelegramWebhook(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.DB) return new Response('Not found', { status: 404 });
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== (await webhookSecret(env))) {
    return new Response('Forbidden', { status: 403 });
  }
  let update;
  try {
    update = await request.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  try {
    await handleUpdate(env, update);
  } catch (err) {
    console.error('telegram update failed', err);
  }
  // Always 200, or Telegram keeps re-sending the same update.
  return new Response('ok');
}

export async function handleUpdate(env, update, nowMs = Date.now()) {
  const msg = update?.message;
  if (!msg || msg.chat?.type !== 'private' || typeof msg.text !== 'string') return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const command = text.startsWith('/') ? text.slice(1).split(/[\s@]/)[0].toLowerCase() : '';
  const round = roundFor(nowMs);
  const reply = (body) =>
    callTelegram(env, 'sendMessage', { chat_id: chatId, text: body, link_preview_options: { is_disabled: true } });

  if (command === 'start') {
    await ensureTable(env);
    // "텔레그램으로 받기" on /lotto opens the bot with the drawn numbers packed
    // into the start payload: send those back without subscribing anyone.
    const drawn = decodeStartPayload(text.split(/\s+/)[1]);
    if (drawn) {
      const subscribed = await env.DB.prepare('SELECT 1 AS ok FROM lotto_subscribers WHERE chat_id = ?1')
        .bind(chatId)
        .first();
      const hint = subscribed ? '' : '\n\n매주 토요일 추천 번호도 받으려면 /start 를 보내 주세요.';
      await reply(numbersText(drawn.round, drawn.games, '(로또 페이지에서 뽑은 번호예요)') + hint);
      return;
    }
    await env.DB.prepare(
      'INSERT INTO lotto_subscribers (chat_id, subscribed_at) VALUES (?1, ?2) ON CONFLICT (chat_id) DO NOTHING'
    )
      .bind(chatId, new Date(nowMs).toISOString())
      .run();
    await reply(`가격일기 로또 번호 알림을 켰어요.\n\n${HELP}`);
    await reply(numbersText(round, generateGames({ count: MAX_GAMES }).games));
    return;
  }
  if (command === 'stop') {
    await ensureTable(env);
    await env.DB.prepare('DELETE FROM lotto_subscribers WHERE chat_id = ?1').bind(chatId).run();
    await reply('매주 알림을 껐어요. 다시 받으려면 /start 를 보내 주세요.');
    return;
  }
  if (command === 'numbers') {
    await reply(numbersText(round, generateGames({ count: MAX_GAMES }).games));
    return;
  }
  if (command) {
    await reply(HELP);
    return;
  }

  const { games: bought, errors } = parseTypedGames(text);
  if (!bought.length) {
    await reply(errors.length ? `${errors.join('\n')}\n\n${HELP}` : HELP);
    return;
  }
  const extra = errors.length ? `\n\n읽지 못한 줄:\n${errors.join('\n')}` : '';
  await reply(excludeReply(round, bought) + extra);
}

// --- weekly send -----------------------------------------------------------

/**
 * Sends this round's numbers to up to SEND_BATCH subscribers who haven't had
 * them yet. Run it several times (hourly cron) to reach everyone.
 */
export async function sendWeekly(env, nowMs = Date.now()) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.DB) return { skipped: true };
  await ensureTable(env);
  const round = roundFor(nowMs);
  const { results: rows } = await env.DB.prepare(
    'SELECT chat_id, last_round, last_games FROM lotto_subscribers WHERE last_round < ?1 ORDER BY chat_id LIMIT ?2'
  )
    .bind(round, SEND_BATCH)
    .all();
  if (!rows.length) return { round, sent: 0, removed: 0, failed: 0, remaining: 0 };

  const results = await getJsonFile(env, RESULTS_PATH, {});
  const writes = [];
  let sent = 0;
  let removed = 0;
  let failed = 0;
  for (const row of rows) {
    const games = generateGames({ count: MAX_GAMES }).games;
    const parts = [];
    let lastGames = null;
    try {
      lastGames = row.last_games ? JSON.parse(row.last_games) : null;
    } catch {
      lastGames = null;
    }
    if (lastGames && results[row.last_round]) parts.push(resultText(row.last_round, lastGames, results[row.last_round]));
    parts.push(numbersText(round, games));
    try {
      await callTelegram(env, 'sendMessage', { chat_id: row.chat_id, text: parts.join('\n\n') });
      writes.push(
        env.DB.prepare('UPDATE lotto_subscribers SET last_round = ?1, last_games = ?2 WHERE chat_id = ?3').bind(
          round,
          JSON.stringify(games),
          row.chat_id
        )
      );
      sent++;
    } catch (err) {
      if (err.status === 403) {
        // The person blocked the bot or deleted their account.
        writes.push(env.DB.prepare('DELETE FROM lotto_subscribers WHERE chat_id = ?1').bind(row.chat_id));
        removed++;
      } else {
        failed++; // retried on the next run
      }
    }
  }
  if (writes.length) await env.DB.batch(writes);
  const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM lotto_subscribers WHERE last_round < ?1').bind(round).first();
  return { round, sent, removed, failed, remaining: left?.n ?? 0 };
}

// --- admin -----------------------------------------------------------------

/**
 * Points the bot's webhook at this Worker, sets its command menu and
 * description, and saves the bot username so the /lotto page can link to it.
 */
export async function connectBot(env, origin) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN secret이 없습니다. 먼저 봇 토큰을 등록하세요.');
  }
  const me = await callTelegram(env, 'getMe');
  await callTelegram(env, 'setWebhook', {
    url: `${origin}/telegram/webhook`,
    secret_token: await webhookSecret(env),
    allowed_updates: ['message'],
    drop_pending_updates: true,
  });
  await callTelegram(env, 'setMyCommands', {
    commands: [
      { command: 'numbers', description: '지금 추천 번호 받기' },
      { command: 'stop', description: '매주 알림 끄기' },
      { command: 'start', description: '매주 알림 켜기' },
      { command: 'help', description: '사용 방법' },
    ],
  });
  await callTelegram(env, 'setMyDescription', {
    description:
      '매주 토요일 로또 6/45 추천 번호를 무작위로 보내 드립니다. 산 번호를 보내면 그 번호를 빼고 뽑아 드려요.\n\n무작위로 만든 조합이며 당첨을 약속하지 않습니다. 만 19세 미만은 복권을 살 수 없습니다.',
  });
  await callTelegram(env, 'setMyShortDescription', {
    short_description: '매주 로또 추천 번호(무작위)를 보내 드려요. 당첨을 약속하지 않습니다.',
  });

  const config = await getJsonFile(env, TELEGRAM_CONFIG_PATH, {});
  const committed = config.botUsername !== me.username;
  if (committed) {
    await commitFiles(env, {
      message: 'chore: link Telegram bot on lotto page',
      files: [{ path: TELEGRAM_CONFIG_PATH, content: `${JSON.stringify({ botUsername: me.username }, null, 2)}\n` }],
    });
  }
  return { username: me.username, committed };
}

export async function getTelegramStatus(env) {
  const round = roundFor();
  const [config, results] = await Promise.all([
    getJsonFile(env, TELEGRAM_CONFIG_PATH, {}),
    getJsonFile(env, RESULTS_PATH, {}),
  ]);
  const status = {
    round,
    tokenSet: Boolean(env.TELEGRAM_BOT_TOKEN),
    botUsername: config.botUsername || '',
    latestResult: Math.max(0, ...Object.keys(results).map(Number)),
    subscribers: null,
    sentThisRound: null,
    webhookUrl: '',
    webhookError: '',
  };
  if (env.DB) {
    await ensureTable(env);
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS total, SUM(CASE WHEN last_round >= ?1 THEN 1 ELSE 0 END) AS sent FROM lotto_subscribers'
    )
      .bind(round)
      .first();
    status.subscribers = row?.total ?? 0;
    status.sentThisRound = row?.sent ?? 0;
  }
  if (status.tokenSet) {
    try {
      const info = await callTelegram(env, 'getWebhookInfo');
      status.webhookUrl = info.url || '';
      status.webhookError = info.last_error_message || '';
    } catch (err) {
      status.webhookError = err.message;
    }
  }
  return status;
}
