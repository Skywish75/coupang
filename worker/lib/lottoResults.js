import { roundFor, drawDate, isValidResult, sortNums } from '../../src/lib/lotto.js';
import { getJsonFile, commitFiles } from './github.js';

// Lotto 6/45 draw results, kept in data/lottoResults.json so the static
// /lotto page can check visitors' saved numbers without calling the Worker.
//
// Source: smok95/lotto, a public GitHub Pages mirror updated a few minutes
// after each Saturday draw. dhlottery.co.kr's own JSON endpoint
// (common.do?method=getLottoNumber) was removed in its site redesign and the
// site also blocks many overseas IPs, so it can't be called from here.
export const RESULTS_PATH = 'data/lottoResults.json';
const SOURCE = 'https://smok95.github.io/lotto/results';
const KEEP_ROUNDS = 60;
const LOOKBACK = 4; // also fill gaps if a few weekly runs were missed

/** Result for one round, or null when it isn't published (or looks wrong). */
export async function fetchResult(round) {
  const res = await fetch(`${SOURCE}/${round}.json`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`당첨번호 조회 실패 (제${round}회, HTTP ${res.status})`);
  const data = await res.json();
  const result = { date: drawDate(round), numbers: sortNums(data.numbers ?? []), bonus: data.bonus_no };
  return data.draw_no === round && isValidResult(result) ? result : null;
}

/** One round per line, newest KEEP_ROUNDS only. */
export function serializeResults(results) {
  const rounds = Object.keys(results)
    .map(Number)
    .sort((a, b) => a - b)
    .slice(-KEEP_ROUNDS);
  if (!rounds.length) return '{}\n';
  return `{\n${rounds.map((r) => `  "${r}": ${JSON.stringify(results[r])}`).join(',\n')}\n}\n`;
}

/** Adds any missing recent results and commits them (one commit, or none). */
export async function updateLottoResults(env, nowMs = Date.now()) {
  const latest = roundFor(nowMs) - 1; // newest round whose sales have closed
  const results = await getJsonFile(env, RESULTS_PATH, {});
  const added = [];
  for (let round = Math.max(1, latest - LOOKBACK + 1); round <= latest; round++) {
    if (results[round]) continue;
    const result = await fetchResult(round);
    if (result) {
      results[round] = result;
      added.push(round);
    }
  }
  if (added.length) {
    await commitFiles(env, {
      message: `chore: add lotto results for round ${added.join(', ')}`,
      files: [{ path: RESULTS_PATH, content: serializeResults(results) }],
    });
  }
  return { latest, added, missing: results[latest] ? [] : [latest] };
}
