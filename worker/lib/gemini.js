// gemini-3.6-flash is on the free (no billing required) tier as of this
// writing. Newer/heavier models (e.g. gemini-2.5-flash) may require a
// billing-enabled project even at low usage — if this keeps hitting 402s,
// check https://ai.google.dev/gemini-api/docs/pricing for which models
// currently show a free tier and set GEMINI_MODEL in wrangler.toml to match.
const MODEL_FALLBACK = 'gemini-3.6-flash';

// 503 "high demand" and 429 are usually transient; a couple of spaced-out
// retries recover most of the runs that used to fail outright.
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callGemini(env, prompt) {
  const model = env.GEMINI_MODEL || MODEL_FALLBACK;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });

    if (res.ok) {
      const json = await res.json();
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
      if (!text.trim()) {
        throw new Error('Gemini API returned empty content');
      }
      return text.trim();
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) {
      throw new Error(`Gemini API failed (${res.status}): ${await res.text()}`);
    }
    await sleep(RETRY_DELAY_MS * (attempt + 1));
  }
}

// Generates a Korean product-overview markdown body for one product.
// Returns plain markdown (no frontmatter, no title). Prices are left out on
// purpose: the page's price box shows the current, updated price and history,
// while text written on publish day would go stale.
export async function generateArticle(env, product, topic, peers = []) {
  const shipping = [product.isRocket && '로켓배송', product.isFreeShipping && '무료배송']
    .filter(Boolean)
    .join(', ');

  const prompt = `당신은 가격 비교 사이트의 한국어 에디터입니다. 아래 데이터만 근거로 쓰세요.

규칙:
- 직접 사용해 본 것처럼 쓰지 마세요. "후기", "리뷰", "사용해 보니" 같은 표현을 쓰지 마세요.
- 상품명에 없는 사양(용량, 소재, 기능, 인증 등)이나 "깔끔한 디자인", "튼튼한" 같은 평가를 지어내지 마세요.
- 가격·할인율 숫자는 쓰지 마세요. 가격과 30일 추이는 페이지의 가격 정보 박스가 매일 갱신해 보여 줍니다.
- 분량: 400~600자
- 아래 소제목을 이 순서대로 사용:
  "## 상품명으로 확인되는 사양" — 마크다운 표(항목 | 내용). 상품명에서 읽히는 것만 적으세요.
  "## 같은 카테고리 인기 상품과 다른 점" — 아래 비교 상품들의 상품명 기준으로 방식·용량·구성 차이를 1~3문장으로.
  "## 구매 전 확인할 점" — 상품명으로 확인되지 않아 상세페이지에서 봐야 할 항목 2~3개를 글머리표로.
- 마크다운 본문만 출력 (제목/프론트매터 없이 본문만)

카테고리(검색 키워드): ${topic}
상품명: ${product.productName}
${shipping ? `배송: ${shipping}\n` : ''}${
    peers.length ? `비교 상품(같은 카테고리 쿠팡 검색 상위):\n${peers.map((p) => `- ${p.productName}`).join('\n')}\n` : ''
  }`;

  return callGemini(env, prompt);
}

// Generates a brand-neutral buying guide for a whole topic, shown on the
// /compare/{topic} page. Created once per topic and then kept as-is.
export async function generateGuide(env, topic) {
  const prompt = `당신은 한국어 쇼핑 가이드 에디터입니다.
"${topic}"을(를) 고를 때 확인해야 할 기준을 정리한 구매 가이드를 작성하세요.

규칙:
- 특정 브랜드나 상품을 추천하거나 언급하지 마세요.
- 직접 사용해 본 경험을 지어내지 마세요.
- 종류별 차이, 크기·용량, 관리 방법, 안전 등 일반적으로 알려진 객관적 기준 위주로 쓰세요. 수치는 일반적인 범위로만 쓰고 단정하지 마세요.
- 분량: 700~1,000자
- "### " 소제목을 3~4개 사용하고, 마지막 소제목은 "### 한눈에 정리"로 핵심 기준 3~5개를 글머리표로 요약하세요.
- 마크다운 본문만 출력 (제목/프론트매터 없이 본문만)
`;

  return callGemini(env, prompt);
}
