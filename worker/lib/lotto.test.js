import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  roundFor,
  drawDate,
  parseTicketQr,
  parseTypedGames,
  generateGames,
  shareText,
  gameKey,
} from '../../src/lib/lotto.js';

const kst = (iso) => Date.parse(`${iso}+09:00`);

test('roundFor follows the weekly draw and switches at Saturday 20:00 KST', () => {
  assert.equal(roundFor(kst('2002-12-07T10:00:00')), 1);
  assert.equal(roundFor(kst('2022-01-29T19:59:00')), 1000);
  assert.equal(roundFor(kst('2026-09-21T10:32:00')), 1243); // logged purchase
  assert.equal(roundFor(kst('2026-10-04T09:00:00')), 1245); // logged purchase
  assert.equal(roundFor(kst('2026-11-07T19:59:59')), 1249);
  assert.equal(roundFor(kst('2026-11-07T20:00:00')), 1250);
  assert.equal(drawDate(1000), '2022-01-29');
  assert.equal(drawDate(1249), '2026-11-07');
});

test('parseTicketQr reads round and games, ignoring serials and empty slots', () => {
  const five =
    'https://www.dhlottery.co.kr/qr.do?method=winQr&v=1245q182729303537q032728363741q030513223238q010721313341q051825263335';
  const parsed = parseTicketQr(five);
  assert.equal(parsed.round, 1245);
  assert.equal(parsed.games.length, 5);
  assert.deepEqual(parsed.games[0], [18, 27, 29, 30, 35, 37]);
  assert.deepEqual(parsed.games[4], [5, 18, 25, 26, 33, 35]);

  assert.deepEqual(parseTicketQr(`${five}0000000000`).games, parsed.games);
  assert.deepEqual(parseTicketQr('http://m.dhlottery.co.kr/?v=1243q102126303540'), {
    round: 1243,
    games: [[10, 21, 26, 30, 35, 40]],
  });
  // Zero-padded round, manual/semi-auto letters, unused slot, trailing serial.
  assert.deepEqual(parseTicketQr('http://m.dhlottery.co.kr/?v=0912m061314233843s071822283945n0000000000001234567890'), {
    round: 912,
    games: [
      [6, 13, 14, 23, 38, 43],
      [7, 18, 22, 28, 39, 45],
    ],
  });
  assert.equal(parseTicketQr('https://example.com/?q=1'), null);
  assert.equal(parseTicketQr('hello'), null);
  assert.equal(parseTicketQr('https://x/?v=1245q999999999999'), null); // out of range
});

test('parseTypedGames accepts common formats and reports bad lines', () => {
  const { games, errors } = parseTypedGames(
    ['3 11 19 27 35 42', '05,14,21,29,32,40', 'A 자동 45 1 2 3 4 5', '', '1 2 3 4 5 6 7 8 9 10 11 12'].join('\n')
  );
  assert.deepEqual(games, [
    [3, 11, 19, 27, 35, 42],
    [5, 14, 21, 29, 32, 40],
    [1, 2, 3, 4, 5, 45],
    [1, 2, 3, 4, 5, 6],
    [7, 8, 9, 10, 11, 12],
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(parseTypedGames('1 2 3 4 5 6\n1 2 3').invalidLines, ['1 2 3']);

  const bad = parseTypedGames('1 2 3 4 5\n1 2 3 4 5 46\n7 7 8 9 10 11');
  assert.equal(bad.games.length, 0);
  assert.match(bad.errors[0], /^1번째 줄: 번호 6개가 필요해요 \(5개/);
  assert.match(bad.errors[1], /^2번째 줄: .*46/);
  assert.match(bad.errors[2], /^3번째 줄: 같은 번호/);
  assert.deepEqual(bad.invalidLines, ['1 2 3 4 5', '1 2 3 4 5 46', '7 7 8 9 10 11']);

  const pasted = parseTypedGames('http://m.dhlottery.co.kr/?v=1243q102126303540');
  assert.deepEqual(pasted.games, [[10, 21, 26, 30, 35, 40]]);
});

test('generateGames never uses excluded numbers and returns sorted unique games', () => {
  const excluded = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 44, 45];
  for (let run = 0; run < 200; run++) {
    const { games, poolSize } = generateGames({ count: 5, excluded });
    assert.equal(poolSize, 33);
    assert.equal(games.length, 5);
    assert.equal(new Set(games.map(gameKey)).size, 5);
    for (const g of games) {
      assert.equal(g.length, 6);
      assert.equal(new Set(g).size, 6);
      assert.deepEqual(g, [...g].sort((a, b) => a - b));
      assert.ok(g.every((n) => n >= 11 && n <= 43), g.join(','));
    }
  }
});

test('generateGames reports a too-small pool and avoids bought combinations', () => {
  const all = Array.from({ length: 40 }, (_, i) => i + 1);
  const tooMany = generateGames({ excluded: all });
  assert.equal(tooMany.poolSize, 5);
  assert.match(tooMany.error, /남은 번호가 5개/);

  // Exactly 7 numbers left = 7 possible games; the bought one must never appear.
  const excluded = Array.from({ length: 38 }, (_, i) => i + 8);
  const bought = [1, 2, 3, 4, 5, 6];
  for (let run = 0; run < 50; run++) {
    const { games } = generateGames({ count: 5, excluded, avoid: [bought] });
    assert.equal(games.length, 5);
    assert.ok(!games.some((g) => gameKey(g) === gameKey(bought)));
  }
  // Only one game possible and it is bought: nothing is returned, no endless loop.
  const none = generateGames({ count: 3, excluded: Array.from({ length: 39 }, (_, i) => i + 7), avoid: [bought] });
  assert.deepEqual(none.games, []);
});

test('generateGames uses the injected random source', () => {
  const { games } = generateGames({ count: 1, randInt: () => 0 });
  assert.deepEqual(games, [[1, 2, 3, 4, 5, 6]]);
});

test('shareText lists games with zero-padded numbers', () => {
  const text = shareText({ round: 1249, games: [[3, 11, 19, 27, 35, 42], [1, 2, 3, 4, 5, 6]], excludedCount: 14 });
  assert.equal(
    text,
    [
      '[7mall.kr] 로또 6/45 제1249회 추천 번호',
      'A  03 11 19 27 35 42',
      'B  01 02 03 04 05 06',
      '(번호 14개 제외하고 뽑음)',
      '무작위 추천이며 당첨을 보장하지 않습니다.',
    ].join('\n')
  );
});

test('checkGame ranks every prize tier', async () => {
  const { checkGame, isValidResult, reviewHistory } = await import('../../src/lib/lotto.js');
  const result = { numbers: [16, 18, 27, 36, 38, 42], bonus: 22 }; // round 1248
  assert.equal(isValidResult(result), true);
  assert.equal(isValidResult({ numbers: [16, 18, 27, 36, 38, 42], bonus: 42 }), false);
  const rank = (g) => checkGame(g, result).rank;
  assert.equal(rank([16, 18, 27, 36, 38, 42]), 1);
  assert.equal(rank([16, 18, 22, 27, 36, 38]), 2);
  assert.equal(rank([1, 16, 18, 27, 36, 38]), 3);
  assert.equal(rank([1, 2, 16, 18, 27, 36]), 4);
  assert.equal(rank([1, 2, 3, 16, 18, 27]), 5);
  assert.equal(rank([1, 2, 3, 4, 16, 22]), 0);
  assert.deepEqual(checkGame([1, 2, 3, 16, 18, 27], result).matched, [16, 18, 27]);

  const reviewed = reviewHistory(
    [
      { round: 1249, at: '2026-11-07T08:00:00Z', games: [[1, 2, 3, 4, 5, 6]] },
      { round: 1248, at: '2026-10-30T08:00:00Z', games: [[1, 2, 3, 16, 18, 27], [1, 2, 3, 4, 5, 16]] },
    ],
    { 1248: result }
  );
  assert.equal(reviewed[0].pending, true);
  assert.equal(reviewed[1].wins.length, 1);
  assert.equal(reviewed[1].wins[0].rank, 5);
  assert.equal(reviewed[1].best, 3);
});
