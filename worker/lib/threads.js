import { priceStats, discountPct, isAtLow, weekChange } from '../../src/lib/priceStats.js';
import { unitKindsForTopic, unitPrice, formatUnitPrice, formatQuantity } from '../../src/lib/units.js';
import { shortProductName } from '../../src/lib/names.js';
import { slugify } from './slug.js';
import { getFileContent, getJsonFile } from './github.js';
import { generateText } from './gemini.js';
import { PRICES_PATH, SNAPSHOTS_PATH } from './publish.js';

// Threads (threads.com) post drafts for the admin page, built from the prices
// this site records. The admin copies them and posts by hand; nothing here
// posts anywhere. Three kinds:
//   deal — a product that got cheaper this week / is under its 30-day average
//          / is at its 30-day low
//   unit — the cheapest product per sheet/100ml/… in a category
//   tip  — a link-free post from the category's buying guide, so the account
//          isn't only ads
// The facts come from the data and the guide only. Experience ("써 보니")
// only comes from the admin's own memo — never invented.

const DRAFTS_KEY = 'threads-drafts';
const MAX_DRAFTS = 10;
const MAX_DEALS = 8;
const MAX_MEMO = 1000;

// Korea FTC guideline: the commercial relationship has to be visible at the
// start of the post, not only in a comment. Coupang Partners asks for this
// exact sentence next to its links.
export const AD_TAG = '[광고·쿠팡 파트너스]';
export const DISCLOSURE = '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
const LINK_SLOT = '[링크]';

const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
const md = (date) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;

// Candidates the admin can pick from, all as of the latest daily run. Stale
// topics (today's search failed) are skipped so no draft quotes an old price.
export function threadCandidates(prices, snapshots) {
  const today = prices?.updatedAt;
  const deals = [];
  const units = [];
  const tips = [];
  const seen = new Set();

  for (const [topic, snap] of Object.entries(snapshots ?? {})) {
    const products = snap?.products ?? [];
    if (!products.length) continue;
    const slug = slugify(topic);
    if (snap.hasGuide) tips.push({ id: `tip:${topic}`, kind: 'tip', topic, slug });
    if (!today || snap.updatedAt !== today) continue;

    const kinds = unitKindsForTopic(topic);
    for (const kind of kinds) {
      const priced = products
        .map((p) => ({ p, u: unitPrice(p.name, p.price, kinds) }))
        .filter((x) => x.u?.kind === kind)
        .sort((a, b) => a.u.value - b.u.value);
      if (priced.length < 2) continue;
      const cheap = priced[0];
      const dear = priced[priced.length - 1];
      const ratio = dear.u.value / cheap.u.value;
      if (ratio < 1.2) continue; // nothing worth a post when they're all alike
      units.push({
        id: `unit:${topic}:${kind}`,
        kind: 'unit',
        topic,
        slug,
        rank: cheap.p.rank,
        name: cheap.p.name,
        short: shortProductName(cheap.p.name),
        price: cheap.p.price,
        date: today,
        unit: cheap.u,
        dear: { short: shortProductName(dear.p.name), unit: dear.u },
        count: priced.length,
        ratio: Math.round(ratio * 10) / 10,
      });
    }

    for (const p of products) {
      const key = p.priceKey ?? p.productId;
      if (seen.has(key)) continue;
      seen.add(key);
      const stats = priceStats(prices, key);
      if (!stats || stats.currentDate !== today) continue;
      const change = weekChange(prices, key);
      const drop = change && change.pct <= -3 ? change : null;
      const discount = discountPct(stats);
      const atLow = isAtLow(stats);
      if (!drop && discount === null && !atLow) continue;
      deals.push({
        id: `deal:${key}`,
        kind: 'deal',
        topic,
        slug,
        rank: p.rank,
        name: p.name,
        short: shortProductName(p.name),
        price: stats.current,
        date: today,
        change: drop,
        discount,
        atLow,
        min: stats.min,
        avg: stats.avg,
        days: stats.count,
        unit: unitPrice(p.name, stats.current, kinds),
        score: Math.max(drop ? -drop.pct : 0, discount ?? 0) + (atLow ? 2 : 0),
      });
    }
  }

  deals.sort((a, b) => b.score - a.score);
  return { deals: deals.slice(0, MAX_DEALS), units, tips };
}

// One line for the admin list: why this one is worth a post today.
export function candidateReason(c) {
  if (c.kind === 'tip') return `${c.topic} 고르는 법 · 링크 없는 정보글`;
  if (c.kind === 'unit') {
    return `${c.unit.label} ${formatUnitPrice(c.unit.value)}으로 단위 가격이 나온 ${c.count}개 중 가장 쌈 · 가장 비싼 것은 ${formatUnitPrice(
      c.dear.unit.value
    )} (${c.ratio}배 차이)`;
  }
  const parts = [];
  if (c.change) parts.push(`${md(c.change.fromDate)} ${won(c.change.fromPrice)} → ${won(c.price)} (${c.change.pct}%)`);
  if (c.discount !== null) parts.push(`30일 평균보다 ${c.discount}% 낮음`);
  if (c.atLow) parts.push('30일 최저가');
  return parts.join(' · ');
}

export function candidateLabel(c) {
  // The price tells apart options that share a short name (2L vs 500ml packs).
  return c.kind === 'tip' ? `정보글 · ${c.topic}` : `${c.topic} · ${c.short} (${won(c.price)})`;
}

// The only numbers and claims the model may use.
function factLines(c) {
  if (c.kind === 'unit') {
    return [
      `카테고리: ${c.topic}`,
      `오늘(${md(c.date)}) 쿠팡에서 "${c.topic}" 검색 상위 상품 중 ${c.unit.label} 가격을 계산할 수 있는 상품: ${c.count}개`,
      `가장 싼 상품: ${c.short} — 판매가 ${won(c.price)}, ${formatQuantity(c.unit.kind, c.unit.quantity)}, ${c.unit.label} ${formatUnitPrice(c.unit.value)}`,
      `가장 비싼 상품: ${c.dear.short} — ${c.dear.unit.label} ${formatUnitPrice(c.dear.unit.value)}`,
      `차이: 같은 ${c.unit.label} 기준으로 약 ${c.ratio}배`,
      `단위 가격은 판매가를 상품명에 적힌 수량으로 나눈 값`,
    ];
  }
  const lines = [
    `카테고리: ${c.topic}`,
    `상품: ${c.short}`,
    `오늘(${md(c.date)}) 쿠팡 판매가: ${won(c.price)}`,
  ];
  if (c.change) lines.push(`${md(c.change.fromDate)} 기록 가격 ${won(c.change.fromPrice)} → 오늘 ${won(c.price)} (${Math.abs(c.change.pct)}% 내림)`);
  lines.push(`최근 30일(${c.days}일 기록) 최저 ${won(c.min)}, 평균 ${won(c.avg)}`);
  if (c.discount !== null) lines.push(`지금 가격은 30일 평균보다 ${c.discount}% 낮음`);
  if (c.atLow) lines.push('지금 가격이 최근 30일 기록 중 최저가');
  if (c.unit) lines.push(`${c.unit.label} ${formatUnitPrice(c.unit.value)} (${formatQuantity(c.unit.kind, c.unit.quantity)} 기준)`);
  else if (unitKindsForTopic(c.topic).length) lines.push('상품명에 용량·수량이 적혀 있지 않음 (묶음 크기는 링크에서 확인해야 함)');
  return lines;
}

export function buildPrompt(c, { memo = '', guide = '' } = {}) {
  const memoRule = memo
    ? `[내 사용 메모]에 적힌 경험만 써. 메모에 아쉬운 점이 있으면 숨기지 말고 댓글에 담백하게 넣어. 메모에 없는 경험·효과는 보태지 마.`
    : `[내 사용 메모]가 없어. "써 봤다", "써 보니" 같은 사용 경험·후기 문장은 절대 쓰지 마. 장면은 "~할 때 있잖아"처럼 누구나 겪을 법한 상황으로만 쓰고, 고백형 첫 줄도 만들지 마.`;

  const common = `말투와 형식
- 친구한테 툭 던지듯 반말로. 광고 카피처럼 쓰지 마.
- 한 줄은 40자 안쪽에서 줄을 바꿔.
- "강추", "인생템", "무조건", "역대급", "꿀템", "필수템", "나만 몰랐던" 같은 말은 쓰지 마.
- 아래 자료에 없는 숫자, 효과, 성능, 다른 상품보다 낫다는 비교는 지어내지 마.
- ${memoRule}

첫 줄 후보 [첫줄1]~[첫줄3]
- 상품명, 브랜드, 가격, "추천"은 넣지 마. 실제로 겪을 법한 불편한 순간으로 시작해.
- 유형은 반전형(예상을 뒤집음), 질문형(물음표로 끝남), 고백형(내 얘기를 털어놓음) 중 그 문장 구조에 실제로 맞는 것 하나. 유형을 골고루 맞추려고 억지로 붙이지 마.
- 이유에는 그 줄에서 스크롤이 멈추는 이유를 한 줄로.`;

  // Plain text with markers, not JSON: see generateText in gemini.js.
  const output = (n) => `출력 형식 (이 형식 그대로, 앞뒤에 다른 말 없이):
[첫줄1] 문장 || 유형 || 이유
[첫줄2] 문장 || 유형 || 이유
[첫줄3] 문장 || 유형 || 이유
[본글]
(본글 여러 줄)
${Array.from({ length: n }, (_, i) => `[댓글${i + 1}]\n(댓글 ${i + 1})`).join('\n')}
[점검]
- 올리기 전에 사람이 직접 확인할 점 1~3개(근거가 약한 표현, 바뀌기 쉬운 정보 등)`;

  if (c.kind === 'tip') {
    return `너는 쿠팡 생활용품 가격을 매일 기록하는 사이트 "가격일기"의 스레드(Threads) 계정 글을 쓰는 사람이야.
이번 글은 링크 없는 정보글이야. 팔로우할 이유를 만드는 글이라 상품 이름, 브랜드, 가격, 링크는 쓰지 마.

[카테고리] ${c.topic}
[가이드] (이 내용 안에서만 써)
${guide}

[내 사용 메모]
${memo || '(없음)'}

${common}

본글 쓰는 법
- [첫줄1] 문장으로 시작해.
- ${c.topic}를 고를 때 헷갈리거나 잘못 사서 아쉬운 장면 하나(언제·어디서·누가)를 3~5줄로 보여 주고 궁금증을 남긴 채 끝내.

댓글 정확히 2개
- [댓글1]: [가이드]의 기준 중 1~2개만 골라 그 장면과 엮어서 설명해. 끝 문장은 다음 댓글이 궁금하게.
- [댓글2]: 한눈에 정리 2~3줄, 마지막 줄은 "다음 편:"으로 시작하는 예고 한 줄(다음에 다룰 생활용품 이야기).

${output(2)}`;
  }

  const n = c.kind === 'unit' ? 3 : 2;
  const commentRules =
    c.kind === 'unit'
      ? `댓글 정확히 3개
- [댓글1]: 본글의 궁금증에 먼저 답해. 같은 ${c.topic}인데 ${c.unit.label} 가격이 몇 배 차이 난다는 사실을 여기서 처음 꺼내.
- [댓글2]: 단위 가격 보는 법(판매가 ÷ 수량)과 가장 싼 것·가장 비싼 것의 ${c.unit.label} 가격. 끝 문장은 다음 댓글이 궁금하게.
- [댓글3](마지막): 지금 확인해 볼 이유를 [사실] 하나로 말하고, 링크 자리에 ${LINK_SLOT}를 정확히 한 번 써.`
      : `댓글 정확히 2개
- [댓글1]: 본글의 궁금증에 먼저 답하고, [사실]의 가격 이야기를 여기서 처음 꺼내. 끝 문장은 다음 댓글이 궁금하게.
- [댓글2](마지막): 지금 확인해 볼 이유를 [사실] 하나로 말하고, 링크 자리에 ${LINK_SLOT}를 정확히 한 번 써.`;

  return `너는 쿠팡 생활용품 가격을 매일 기록하는 사이트 "가격일기"의 스레드(Threads) 계정 글을 쓰는 사람이야.
아래 [사실]로 스레드 본글 1개와 댓글 ${n}개 초안을 써 줘. 링크는 이 사이트의 가격 비교 페이지(30일 가격 기록)로 가.

[사실] (숫자는 이것만 써)
${factLines(c).map((l) => `- ${l}`).join('\n')}

[내 사용 메모]
${memo || '(없음)'}

${common}

본글 쓰는 법
- [첫줄1] 문장으로 시작해.
- 이게 아쉬운 일상 장면 1~2개를 언제·어디서·누가 보이게, 짜증나고 귀찮은 순간 위주로 써.
- 상품 이름, 브랜드, 가격, 숫자, 할인율은 본글에 쓰지 마. 궁금증을 남긴 채 끝내. 5~9줄.

${commentRules}
- "사세요", "둘러보세요", "구매하세요" 대신 왜 지금 보면 좋은지를 말해.
- 가격은 금방 바뀌니까 단정하지 말고 "오늘 기준"처럼 날짜 기준을 붙여.

${output(n)}`;
}

// Reads the marker format the prompt asks for into the shape assembleDraft
// takes. Tolerates bold/heading marks around a marker, a hook on the line
// after its marker, and a code fence around the whole answer.
const MARKER = /^[\s#*]*\[(첫\s?줄\s?\d|본\s?글|댓글\s?\d+|점\s?검)\][*\s]*(.*)$/;

export function parseDraftText(text) {
  const blocks = new Map();
  let current = null;
  for (const line of String(text).replace(/\r/g, '').split('\n')) {
    if (/^\s*```/.test(line)) continue;
    const m = line.match(MARKER);
    if (m) {
      current = m[1].replace(/\s/g, '');
      blocks.set(current, m[2] ? [m[2]] : []);
    } else if (current) {
      blocks.get(current).push(line);
    }
  }
  const get = (key) => (blocks.get(key) ?? []).join('\n').trim();
  const keys = [...blocks.keys()];
  const numbered = (prefix) =>
    keys.filter((k) => k.startsWith(prefix)).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));

  const hooks = numbered('첫줄')
    .map((k) => {
      const [hook = '', type = '', why = ''] = get(k).replace(/\n+/g, ' ').split('||').map((x) => x.trim());
      return { text: hook, type, why };
    })
    .filter((h) => h.text);
  const draft = {
    hooks,
    post: get('본글'),
    comments: numbered('댓글').map(get).filter(Boolean),
    checks: get('점검')
      .split('\n')
      .map((l) => l.replace(/^\s*[-•*]\s*/, '').trim())
      .filter(Boolean),
  };
  if (!draft.post || !draft.comments.length) {
    throw new Error(`Gemini 답이 정해진 형식이 아니었습니다: ${String(text).slice(0, 80)}`);
  }
  return draft;
}

// Address of the product's row on its compare page. Percent-encoded so the
// Korean path survives being pasted into any app.
export function compareUrl(origin, c) {
  return `${origin}/compare/${encodeURIComponent(c.slug)}/#rank-${c.rank}`;
}

const clean = (t) =>
  String(t ?? '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// Puts the model's text into postable shape. The parts that must not be left
// to the model are added here: the ad tag at the start of the post, the link
// in the last comment only, the price-date note and the disclosure next to it.
export function assembleDraft(c, raw, { origin, memo = '', now = Date.now() } = {}) {
  const hooks = (Array.isArray(raw?.hooks) ? raw.hooks : [])
    .map((h) => ({ text: clean(h?.text), type: clean(h?.type), why: clean(h?.why) }))
    .filter((h) => h.text)
    .slice(0, 3);
  let post = clean(raw?.post).replaceAll(LINK_SLOT, '').trim();
  let comments = (Array.isArray(raw?.comments) ? raw.comments : []).map(clean).filter(Boolean);
  const notes = [];
  const link = c.kind === 'tip' ? null : compareUrl(origin, c);

  if (link) {
    const lastIndex = Math.max(comments.length - 1, 0);
    comments = comments.map((t, i) => (i === lastIndex ? t : t.replaceAll(LINK_SLOT, '').trim()));
    let last = comments[lastIndex] ?? '';
    if (last.includes(LINK_SLOT)) {
      last = last.replace(LINK_SLOT, link).replaceAll(LINK_SLOT, '');
    } else {
      last = `${last}\n${link}`.trim();
      notes.push('링크 자리가 없어서 마지막 댓글 끝에 붙였어요.');
    }
    comments[lastIndex] = `${last.trim()}\n\n가격은 ${md(c.date)} 기록 기준이라 바뀔 수 있어.\n${DISCLOSURE}`;
    if (!post.startsWith(AD_TAG)) post = `${AD_TAG} ${post}`;
  } else {
    comments = comments.map((t) => t.replaceAll(LINK_SLOT, '').trim());
  }

  const draft = {
    id: now.toString(36),
    at: new Date(now).toISOString(),
    kind: c.kind,
    topic: c.topic,
    label: candidateLabel(c),
    reason: candidateReason(c),
    hooks,
    post,
    comments,
    link,
    withMemo: Boolean(memo),
    checks: (Array.isArray(raw?.checks) ? raw.checks : []).map(clean).filter(Boolean).slice(0, 3),
  };
  draft.warnings = [...notes, ...lintDraft(draft, c)];
  return draft;
}

const OVERSOLD = ['강추', '인생템', '무조건', '역대급', '꿀템', '필수템', '나만 몰랐던', '최저가 보장', '대박'];
const PUSHY = /사세요|둘러보세요|구매하세요|지르세요|담으세요/;
const EXPERIENCE = /써\s?봤|써\s?보니|써\s?본|사용해\s?봤|사용해\s?보니|직접\s?써|내돈내산|후기/;
// The date note assembleDraft adds under the link.
const PRICE_NOTE = /^가격은 \d+월 \d+일 기록 기준이라 바뀔 수 있어\.$/;
const GENERIC = new Set(['무라벨', '대용량', '프리미엄', '아기', '유아', '휴대용', '캡형', '밴드형', '팬티형', '일자형', '무선', '블루투스']);

// Words of the product name that would give it away in the post: the first
// word (usually the brand) and any word with Latin letters (model names).
function nameTokens(c) {
  if (!c.short) return [];
  const topicWords = new Set(c.topic.split(/\s+/));
  const words = c.short.split(/\s+/).filter((w) => w.length >= 2 && !/\d/.test(w) && !topicWords.has(w) && !GENERIC.has(w));
  return [...new Set([words[0], ...words.filter((w) => /[A-Za-z]/.test(w))].filter(Boolean))];
}

// The pre-post check, done in code so it doesn't depend on the model
// grading its own work. Each entry is something for the admin to fix.
export function lintDraft(draft, c) {
  const warnings = [];
  const noUrl = (t) => t.replace(/https?:\/\/\S+/g, '').trim();
  const body = noUrl(draft.post.replace(AD_TAG, ''));
  // The other first-line candidates may replace the post's first line.
  const lead = [body, ...draft.hooks.map((h) => h.text)].join('\n');
  const comments = draft.comments.map((t) =>
    t
      .split('\n')
      .filter((l) => l !== DISCLOSURE && !PRICE_NOTE.test(l))
      .map(noUrl)
      .join('\n')
  );
  const all = [lead, ...comments].join('\n');

  if (/\d[\d,]*\s*원|\d+(\.\d+)?\s*%/.test(lead)) {
    warnings.push('본글이나 첫 줄 후보에 가격·할인율이 있어요. 숫자는 댓글로 옮기세요.');
  }
  const named = nameTokens(c).find((w) => lead.includes(w));
  if (named) warnings.push(`본글이나 첫 줄 후보에 상품명("${named}")이 들어 있어요. 본글은 상황만 두세요.`);
  const oversold = OVERSOLD.filter((w) => all.includes(w));
  if (oversold.length) warnings.push(`과한 표현이 있어요: ${oversold.join(', ')}`);
  if (PUSHY.test(all)) warnings.push('"사세요·둘러보세요" 같은 권유 말투가 있어요. 지금 볼 이유로 바꾸세요.');
  if (!draft.withMemo && EXPERIENCE.test(all)) {
    warnings.push('사용 메모 없이 써 본 것처럼 읽히는 문장이 있어요. 직접 쓴 적이 없다면 지우세요.');
  }
  if (!draft.withMemo && draft.hooks.some((h) => h.type.includes('고백'))) {
    warnings.push('고백형 첫 줄은 직접 겪은 이야기일 때만 쓰세요.');
  }
  if (c.kind === 'tip' && /https?:\/\//.test([draft.post, ...draft.comments].join('\n'))) {
    warnings.push('정보글인데 링크가 들어 있어요.');
  }
  const long = all.split('\n').filter((l) => [...l.trim()].length > 40).length;
  if (long) warnings.push(`40자가 넘는 줄이 ${long}개 있어요. 스레드에서 읽기 편하게 끊어 주세요.`);
  return warnings;
}

function stripFrontmatter(md) {
  return String(md ?? '').replace(/^---\n[\s\S]*?\n---\n/, '').trim();
}

export async function getDrafts(env) {
  const raw = await env.STATE.get(DRAFTS_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function saveDraft(env, draft) {
  const drafts = await getDrafts(env);
  drafts.unshift(draft);
  await env.STATE.put(DRAFTS_KEY, JSON.stringify(drafts.slice(0, MAX_DRAFTS)));
}

// Looks the candidate up again from live data (the form only sends its id),
// writes the draft and keeps it in KV for the admin page.
export async function createThreadsDraft(env, { id, memo = '', origin }) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  const [prices, snapshots] = await Promise.all([
    getJsonFile(env, PRICES_PATH, { updatedAt: null, products: {} }),
    getJsonFile(env, SNAPSHOTS_PATH, {}),
  ]);
  const { deals, units, tips } = threadCandidates(prices, snapshots);
  const c = [...deals, ...units, ...tips].find((x) => x.id === id);
  if (!c) throw new Error('고른 후보를 찾지 못했습니다. 페이지를 새로고침한 뒤 다시 골라 주세요.');

  let guide = '';
  if (c.kind === 'tip') {
    guide = stripFrontmatter(await getFileContent(env, `src/content/guides/${c.slug}.md`));
    if (!guide) throw new Error(`${c.topic} 구매 가이드가 아직 없습니다.`);
  }

  const note = String(memo).trim().slice(0, MAX_MEMO);
  const raw = parseDraftText(await generateText(env, buildPrompt(c, { memo: note, guide })));
  const draft = assembleDraft(c, raw, { origin, memo: note });
  await saveDraft(env, draft);
  return draft;
}
