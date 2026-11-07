import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitPrice, unitKindsForTopic, formatUnitPrice } from '../../src/lib/units.js';

const wipes = unitKindsForTopic('아기 물티슈');
const sheets = (name) => unitPrice(name, 10000, wipes)?.quantity ?? null;

test('topics map to the unit they are compared by', () => {
  assert.deepEqual(unitKindsForTopic('아기 물티슈'), ['sheet']);
  assert.deepEqual(unitKindsForTopic('기저귀'), ['sheet']);
  assert.deepEqual(unitKindsForTopic('생수'), ['volume']);
  assert.deepEqual(unitKindsForTopic('세탁세제'), ['volume', 'weight', 'piece']);
  assert.deepEqual(unitKindsForTopic('무선 이어폰'), []);
  assert.equal(unitPrice('어반사운드 에어 프로, 2개', 11480, []), null);
});

// Real names from data/priceHistory.json.
test('wipe sheet counts from real Coupang names', () => {
  assert.equal(sheets('위프리 프리미엄 그린 엠보싱 아기물티슈, 20개, 70매, 75g'), 1400);
  assert.equal(sheets('베베숲 프리미어 유아물티슈 캡형, 70g, 70매, 20개'), 1400);
  assert.equal(sheets('하늘수 퓨어 아기 물티슈 캡형, 55g, 76매, 20개'), 1520);
  assert.equal(sheets('Bebeen 포유 프리미엄 유아물티슈 캡형, 75g, 70개입, 10개'), 700);
  assert.equal(sheets('위드네이쳐 데일리 아기물티슈 캡형, 47g, 120매, 10세트'), 1200);
  assert.equal(sheets('프랑프랑 더제로 프리미엄 안심 아기 물티슈, 10개, 70매입, 73g'), 700);
  assert.equal(sheets('소중한습관 휴대용 소중한 아기 물티슈 캡형, 20매, 36개'), 720);
});

test('numbers repeated in the title are not counted twice', () => {
  assert.equal(
    sheets('아이러브베베 시그니앙75 오션 70매 20팩 캡형 75g 고평량 엠보 아기물티슈, 20개, 70매, 75g'),
    1400
  );
});

test('names without an amount have no unit price', () => {
  assert.equal(unitPrice('코멧 오리지널 유아용 아기물티슈 캡형', 10890, wipes), null);
  assert.equal(unitPrice('Bebeen 120 유아물티슈 캡형', 11600, wipes), null);
});

test('unit price value and label', () => {
  const u = unitPrice('위프리 프리미엄 그린 엠보싱 아기물티슈, 20개, 70매, 75g', 31800, wipes);
  assert.equal(u.kind, 'sheet');
  assert.equal(u.label, '1매당');
  assert.equal(Math.round(u.value * 10) / 10, 22.7);
});

test('diapers: sheet count only, weight ranges are ignored', () => {
  const kinds = unitKindsForTopic('기저귀');
  assert.equal(unitPrice('하기스 네이처메이드 팬티형 4단계(9~14kg), 44매, 4팩', 1, kinds).quantity, 176);
  assert.equal(unitPrice('팸퍼스 베이비드라이 밴드형 신생아용 (2~5kg), 192매', 1, kinds).quantity, 192);
  assert.equal(unitPrice('보솜이 기저귀 대형 (9~13kg)', 1, kinds), null);
});

test('water volume in ml', () => {
  const kinds = unitKindsForTopic('생수');
  assert.equal(unitPrice('제주삼다수 그린, 2L, 12개', 1, kinds).quantity, 24000);
  assert.equal(unitPrice('아이시스 8.0 ECO, 500ml, 40개', 1, kinds).quantity, 20000);
  assert.equal(unitPrice('탐사수 무라벨 생수 2L x 6병', 1, kinds).quantity, 12000);
  assert.equal(unitPrice('스파클 생수 1,500ml, 6개', 1, kinds).quantity, 9000);
  const u = unitPrice('제주삼다수 그린, 2L, 12개', 9600, kinds);
  assert.equal(u.label, '100ml당');
  assert.equal(u.value, 40);
});

test('ambiguous amounts give null instead of a guess', () => {
  const water = unitKindsForTopic('생수');
  assert.equal(unitPrice('삼다수 2L 6병, 2개', 1, water), null, 'pack of 6, or 2 bottles?');
  assert.equal(unitPrice('생수, 500ml, 20병, 2개', 1, water), null);
  const detergent = unitKindsForTopic('세탁세제');
  assert.equal(unitPrice('비트 진드기 액체세제 3L + 리필 2.2L', 1, detergent), null);
});

test('detergent: liquid, powder and capsules', () => {
  const kinds = unitKindsForTopic('세탁세제');
  const liquid = unitPrice('퍼실 딥클린 파워젤 액체세제 일반용 리필, 2L, 4개', 32000, kinds);
  assert.equal(liquid.kind, 'volume');
  assert.equal(liquid.value, 400);
  const powder = unitPrice('테크 가루세제 일반 드럼 겸용, 3kg, 2개', 1, kinds);
  assert.equal(powder.kind, 'weight');
  assert.equal(powder.quantity, 6000);
  const caps = unitPrice('타이드 프리미엄 캡슐세제, 81개입, 1개', 24300, kinds);
  assert.equal(caps.kind, 'piece');
  assert.equal(caps.label, '1개당');
  assert.equal(caps.value, 300);
});

test('1+1 bundles and month counts', () => {
  const water = unitKindsForTopic('생수');
  assert.equal(unitPrice('백산수 2L 1+1', 1, water).quantity, 4000);
  const kinds = unitKindsForTopic('세탁세제');
  assert.equal(unitPrice('액체세제 3개월분 3L, 1개', 1, kinds).quantity, 3000);
});

test('formatUnitPrice keeps one decimal under 100원', () => {
  assert.equal(formatUnitPrice(22.714), '22.7원');
  assert.equal(formatUnitPrice(40), '40원');
  assert.equal(formatUnitPrice(1234.4), '1,234원');
});

test('formatQuantity', async () => {
  const { formatQuantity } = await import('../../src/lib/units.js');
  assert.equal(formatQuantity('sheet', 1400), '1,400매');
  assert.equal(formatQuantity('volume', 24000), '24L');
  assert.equal(formatQuantity('volume', 500), '500ml');
  assert.equal(formatQuantity('weight', 2500), '2.5kg');
  assert.equal(formatQuantity('piece', 81), '81개');
});
