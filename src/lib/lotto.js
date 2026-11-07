// Lotto 6/45 helpers for the /lotto page. Pure functions (no DOM, no storage)
// so the page script and the node tests share the same logic.

export const MIN = 1;
export const MAX = 45;
export const PICK = 6;
export const MAX_GAMES = 5;
export const GAME_LABELS = ['A', 'B', 'C', 'D', 'E'];

const HOUR = 60 * 60 * 1000;
const WEEK = 7 * 24 * HOUR;
// Round 1 sales closed Saturday 2002-12-07 20:00 KST (11:00 UTC), and there
// has been one draw every Saturday since, so round N closes N-1 weeks later.
const FIRST_CUTOFF = Date.UTC(2002, 11, 7, 11, 0, 0);

/** Round currently on sale: it switches to the next one at Saturday 20:00 KST. */
export function roundFor(nowMs = Date.now()) {
  if (nowMs < FIRST_CUTOFF) return 1;
  return Math.floor((nowMs - FIRST_CUTOFF) / WEEK) + 2;
}

/** Draw date of a round as YYYY-MM-DD (Korea time). */
export function drawDate(round) {
  return new Date(FIRST_CUTOFF + (round - 1) * WEEK + 9 * HOUR).toISOString().slice(0, 10);
}

export const sortNums = (nums) => [...nums].sort((a, b) => a - b);
export const gameKey = (nums) => sortNums(nums).join('-');

/** Returns an error message for an invalid game, or '' when it is valid. */
export function gameError(nums) {
  if (nums.length !== PICK) return `번호 ${PICK}개가 필요해요 (${nums.length}개 입력됨)`;
  const bad = nums.filter((n) => !Number.isInteger(n) || n < MIN || n > MAX);
  if (bad.length) return `${MIN}~${MAX} 사이 번호만 쓸 수 있어요 (${bad.join(', ')})`;
  if (new Set(nums).size !== PICK) return '같은 번호가 두 번 들어 있어요';
  return '';
}

/**
 * Reads the QR printed on a Lotto 6/45 ticket, e.g.
 *   https://m.dhlottery.co.kr/?v=1245q182729303537q032728363741...
 * `v` is the round followed by one segment per game: a letter (auto, manual,
 * semi-auto) and six 2-digit numbers. Real tickets may append a serial
 * number and zero-filled unused slots, so anything else is skipped.
 */
export function parseTicketQr(text) {
  const raw = String(text ?? '').trim();
  const match = raw.match(/[?&]v=([0-9a-z]+)/i);
  if (!match) return null;
  const v = match[1];
  const head = v.match(/^\d+/);
  if (!head) return null;

  const games = [];
  for (const seg of v.slice(head[0].length).matchAll(/[a-z](\d{12})/gi)) {
    const nums = seg[1].match(/\d\d/g).map(Number);
    if (nums.every((n) => n === 0)) continue;
    if (!gameError(nums)) games.push(sortNums(nums));
  }
  return games.length ? { round: Number(head[0]), games } : null;
}

/**
 * Parses games typed one per line ("3 11 19 27 35 42", "03,11,19,27,35,42",
 * "A 자동 03 11 ..."). A line with 12 or 18 numbers counts as several games,
 * and a pasted ticket QR link is read like a scan.
 */
export function parseTypedGames(text) {
  const games = [];
  const errors = [];
  const invalidLines = [];
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((line, i) => {
      const qr = parseTicketQr(line);
      if (qr) {
        games.push(...qr.games);
        return;
      }
      const nums = (line.match(/\d+/g) || []).map(Number);
      if (nums.length === 0) return;
      if (nums.length % PICK !== 0) {
        errors.push(`${i + 1}번째 줄: 번호 ${PICK}개가 필요해요 (${nums.length}개 입력됨)`);
        invalidLines.push(line);
        return;
      }
      let lineOk = true;
      for (let k = 0; k < nums.length; k += PICK) {
        const game = nums.slice(k, k + PICK);
        const err = gameError(game);
        if (err) {
          errors.push(`${i + 1}번째 줄: ${err}`);
          lineOk = false;
        } else games.push(sortNums(game));
      }
      if (!lineOk) invalidLines.push(line);
    });
  // invalidLines lets the page keep only the lines that still need fixing.
  return { games, errors, invalidLines };
}

/** Unbiased integer in [0, n) from Web Crypto. */
export function cryptoInt(n) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  do {
    globalThis.crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % n;
}

function pickGame(pool, randInt) {
  const a = pool.slice();
  for (let i = 0; i < PICK; i++) {
    const j = i + randInt(a.length - i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return sortNums(a.slice(0, PICK));
}

/**
 * Draws `count` games from 1..45 minus `excluded`, never repeating a game
 * from `avoid` (games already bought) or from this batch.
 * Returns { games, poolSize } or { error, poolSize } when fewer than six
 * numbers remain.
 */
export function generateGames({ count = MAX_GAMES, excluded = [], avoid = [], randInt = cryptoInt } = {}) {
  const ex = new Set(excluded);
  const pool = [];
  for (let n = MIN; n <= MAX; n++) if (!ex.has(n)) pool.push(n);
  if (pool.length < PICK) {
    return { error: `제외한 번호가 너무 많아요. 남은 번호가 ${pool.length}개라 ${PICK}개를 뽑을 수 없어요.`, poolSize: pool.length };
  }

  const seen = new Set(avoid.map(gameKey));
  const games = [];
  for (let tries = 0; games.length < count && tries < 2000; tries++) {
    const game = pickGame(pool, randInt);
    const key = gameKey(game);
    if (seen.has(key)) continue;
    seen.add(key);
    games.push(game);
  }
  return { games, poolSize: pool.length };
}

const pad = (n) => String(n).padStart(2, '0');

/** Plain-text message for KakaoTalk / Telegram / clipboard. */
export function shareText({ round, games, excludedCount = 0 }) {
  const lines = [`[가격일기] 로또 6/45 제${round}회 추천 번호`];
  games.forEach((g, i) => lines.push(`${GAME_LABELS[i]}  ${g.map(pad).join(' ')}`));
  if (excludedCount) lines.push(`(번호 ${excludedCount}개 제외하고 뽑음)`);
  lines.push('무작위 추천이며 당첨을 보장하지 않습니다.');
  return lines.join('\n');
}

export { pad };

/** A draw result is { numbers: [6 sorted], bonus }. */
export function isValidResult(result) {
  return (
    !!result &&
    Array.isArray(result.numbers) &&
    !gameError(result.numbers) &&
    Number.isInteger(result.bonus) &&
    result.bonus >= MIN &&
    result.bonus <= MAX &&
    !result.numbers.includes(result.bonus)
  );
}

/**
 * Compares one game with a draw. rank: 1-5 (prize tier) or 0 (no prize).
 * 1등 6개 · 2등 5개+보너스 · 3등 5개 · 4등 4개 · 5등 3개
 */
export function checkGame(game, result) {
  const winning = new Set(result.numbers);
  const matched = game.filter((n) => winning.has(n));
  const bonus = game.includes(result.bonus);
  const m = matched.length;
  const rank = m === 6 ? 1 : m === 5 && bonus ? 2 : m === 5 ? 3 : m === 4 ? 4 : m === 3 ? 5 : 0;
  return { rank, matched, bonus: rank === 2 };
}

/**
 * Lines up saved draws ({ round, at, games }) with results keyed by round.
 * Rounds without a result yet come back with pending: true.
 */
export function reviewHistory(history, results) {
  return history.map((entry) => {
    const result = results[entry.round];
    if (!isValidResult(result)) return { ...entry, pending: true };
    const checks = entry.games.map((game) => ({ game, ...checkGame(game, result) }));
    return {
      ...entry,
      result,
      checks,
      wins: checks.filter((c) => c.rank > 0),
      best: Math.max(0, ...checks.map((c) => c.matched.length)),
    };
  });
}

// Telegram /start payloads may hold up to 64 characters of [A-Za-z0-9_-], so a
// draw is packed as "p<round>_" plus one character per number (1-45 -> '1'..'j').
const PAYLOAD_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';

/** "p1249_" + 6 characters per game; at most 36 characters for 5 games. */
export function encodeStartPayload(round, games) {
  return `p${round}_${games.map((g) => g.map((n) => PAYLOAD_DIGITS[n]).join('')).join('')}`;
}

/** Inverse of encodeStartPayload, or null for anything that isn't a valid draw. */
export function decodeStartPayload(payload) {
  const m = /^p(\d{1,5})_([1-9A-Za-j]+)$/.exec(String(payload ?? ''));
  if (!m || m[2].length % PICK !== 0 || m[2].length > PICK * MAX_GAMES) return null;
  const games = [];
  for (let i = 0; i < m[2].length; i += PICK) {
    const nums = [...m[2].slice(i, i + PICK)].map((c) => PAYLOAD_DIGITS.indexOf(c));
    if (gameError(nums)) return null;
    games.push(sortNums(nums));
  }
  return { round: Number(m[1]), games };
}
