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
