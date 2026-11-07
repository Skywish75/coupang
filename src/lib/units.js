// Unit prices (1매당, 100ml당 …) read from Coupang product names.
//
// Coupang names look like "Title, 20개, 70매, 75g": everything after the
// first comma is the chosen option. Quantities are read from the option part
// first and from the title only when the options don't state them, because
// titles often repeat the same numbers ("… 70매 20팩 …, 20개, 70매").
// Anything ambiguous gives null: a wrong unit price is worse than none.

export const UNIT_KINDS = {
  sheet: { label: '1매당', per: 1 },
  volume: { label: '100ml당', per: 100 },
  weight: { label: '100g당', per: 100 },
  piece: { label: '1개당', per: 1 },
};

// Which unit(s) a topic is compared by, in order of preference.
// Topics that match nothing (earphones, chairs …) have no unit price.
export function unitKindsForTopic(topic) {
  if (/물티슈|기저귀/.test(topic)) return ['sheet'];
  if (/생수/.test(topic)) return ['volume'];
  if (/세제|유연제/.test(topic)) return ['volume', 'weight', 'piece'];
  return [];
}

// A number that isn't the tail of a longer number ("2.5", not the "5" of it).
const N = String.raw`(?<![\d.])(\d+(?:\.\d+)?)\s*`;
// Unit letters must not run on into a word ("5G" in "5GHz" is not grams).
const END = String.raw`(?![A-Za-z])`;

const PATTERNS = {
  // "70개입" on wipes and diapers is a sheet count, same as "70매".
  sheet: [[new RegExp(`${N}(?:매입?|개입)`, 'g'), 1]],
  volume: [
    [new RegExp(`${N}(?:ml|mL|ML)${END}`, 'g'), 1],
    [new RegExp(`${N}(?:L|l|리터)${END}`, 'g'), 1000],
  ],
  weight: [
    [new RegExp(`${N}(?:g|G)${END}`, 'g'), 1],
    [new RegExp(`${N}(?:kg|KG|Kg)${END}`, 'g'), 1000],
  ],
  piece: [[new RegExp(`${N}(?:개입|매입?)`, 'g'), 1]],
};

// Pack counts: "20개", "3팩", "6병", "10세트". Not "70개입" or "3개월".
const COUNT = /(?<![\d.])(\d+)\s*(?:개(?![입월])|팩|병|박스|세트|봉|통|캔)/g;
// "1+1" bundles count as one pack token of 2.
const BUNDLE = /(?<![\d.])(\d)\s*\+\s*(\d)(?![\d.]|\s*(?:ml|mL|L|g|kg|매|개입))/g;

function amounts(text, kind) {
  const values = new Set();
  for (const [re, scale] of PATTERNS[kind]) {
    for (const m of text.matchAll(re)) values.add(Number(m[1]) * scale);
  }
  return [...values];
}

function packCounts(text) {
  const counts = [...text.matchAll(COUNT)].map((m) => Number(m[1]));
  for (const m of text.matchAll(BUNDLE)) counts.push(Number(m[1]) + Number(m[2]));
  return counts;
}

// undefined: the name doesn't mention this unit at all.
// null: it does, but the total can't be told for sure.
function totalQuantity(name, kind) {
  const text = String(name).replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
  const comma = text.indexOf(',');
  const title = comma < 0 ? text : text.slice(0, comma);
  const options = comma < 0 ? '' : text.slice(comma + 1);

  let amount = amounts(options, kind);
  const inOptions = amount.length > 0;
  if (!inOptions) amount = amounts(title, kind);
  if (amount.length === 0) return undefined;
  if (amount.length > 1) return null;

  const optionCounts = packCounts(options);
  const titleCounts = inOptions ? [] : packCounts(title);
  if (optionCounts.length > 1 || titleCounts.length > 1) return null;
  const [a, b] = [optionCounts[0], titleCounts[0]];
  // "삼다수 2L 6병, 2개": 2 packs of 6, or 2 bottles? Can't tell.
  if (a && b && a !== b) return null;
  const count = a ?? b ?? 1;

  const total = amount[0] * count;
  return Number.isFinite(total) && total > 0 ? total : null;
}

// { kind, label, quantity, value } where value is the price per label unit,
// or null when the topic has no unit or the name doesn't say the amount.
export function unitPrice(name, price, kinds) {
  if (!(price > 0)) return null;
  for (const kind of kinds) {
    const quantity = totalQuantity(name, kind);
    if (quantity === undefined) continue;
    if (quantity === null) return null;
    const { label, per } = UNIT_KINDS[kind];
    return { kind, label, quantity, value: (price / quantity) * per };
  }
  return null;
}

// 22.7원 under 100원, whole won above.
export function formatUnitPrice(value) {
  if (value < 100) return `${Number(value.toFixed(1)).toLocaleString('ko-KR')}원`;
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

// The total the unit price was computed from: "1,400매", "24L", "6kg", "81개".
export function formatQuantity(kind, quantity) {
  const n = (v) => Number(v.toFixed(2)).toLocaleString('ko-KR');
  if (kind === 'volume') return quantity >= 1000 ? `${n(quantity / 1000)}L` : `${n(quantity)}ml`;
  if (kind === 'weight') return quantity >= 1000 ? `${n(quantity / 1000)}kg` : `${n(quantity)}g`;
  return `${n(quantity)}${kind === 'sheet' ? '매' : '개'}`;
}
