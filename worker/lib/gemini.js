// gemini-3.6-flash is on the free (no billing required) tier as of this
// writing. Newer/heavier models (e.g. gemini-2.5-flash) may require a
// billing-enabled project even at low usage — if this keeps hitting 402s,
// check https://ai.google.dev/gemini-api/docs/pricing for which models
// currently show a free tier and set GEMINI_MODEL in wrangler.toml to match.
const MODEL_FALLBACK = 'gemini-3.6-flash';
// Free-tier model tried when the main one answers 503 "high demand" (seen
// for minutes at a time on gemini-3.6-flash). Override with GEMINI_FALLBACK_MODEL.
const BUSY_FALLBACK = 'gemini-3.5-flash-lite';

// 503 "high demand" and 429 are usually transient; a couple of spaced-out
// retries recover most of the runs that used to fail outright.
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Options:
//   schema    — an OpenAPI-style object (responseSchema in the Gemini docs);
//               the reply is then JSON text matching it
//   thinking  — 'low' | 'high' thinkingLevel. Gemini 3 defaults to high,
//               which made one admin draft wait over 3 minutes.
//   timeoutMs — per attempt; a stalled call fails instead of hanging
//   retries   — extra attempts after a 429/5xx
//   maxOutputTokens — hard cap, thinking tokens included
async function callGemini(env, prompt, { schema, thinking, timeoutMs = 120_000, retries = MAX_RETRIES, maxOutputTokens, model: modelOverride } = {}) {
  const model = modelOverride || env.GEMINI_MODEL || MODEL_FALLBACK;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const body = { contents: [{ parts: [{ text: prompt }] }] };
  const config = {};
  if (schema) Object.assign(config, { responseMimeType: 'application/json', responseSchema: schema });
  if (thinking) config.thinkingConfig = { thinkingLevel: thinking };
  if (maxOutputTokens) config.maxOutputTokens = maxOutputTokens;
  if (Object.keys(config).length) body.generationConfig = config;

  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        console.log(`gemini ${model} attempt ${attempt + 1}: no answer in ${timeoutMs}ms`);
        const timeout = new Error(`Gemini가 ${Math.round(timeoutMs / 1000)}초 안에 답하지 않았습니다. 잠시 뒤 다시 시도해 주세요.`);
        timeout.timedOut = true;
        throw timeout;
      }
      throw err;
    }
    console.log(`gemini ${model} attempt ${attempt + 1}: ${res.status} in ${Date.now() - started}ms`);

    if (res.ok) {
      const json = await res.json();
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
      if (!text.trim()) {
        throw new Error('Gemini API returned empty content');
      }
      return text.trim();
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) {
      const failed = new Error(`Gemini API failed (${res.status}): ${await res.text()}`);
      failed.status = res.status;
      throw failed;
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

// Plain-text answer for a person waiting on the admin page: low thinking, a
// token cap and no in-place retry. If the main model is busy (429/503) or
// silent for 25s, the free lite model gets one try, so the wait stays under
// a minute. Returns the text and the model that wrote it.
// (JSON mode was dropped for drafts: both requests made with it got nothing.)
export async function generateText(env, prompt, options = {}) {
  const { timeoutMs = 25_000, ...rest } = options;
  const models = [env.GEMINI_MODEL || MODEL_FALLBACK, env.GEMINI_FALLBACK_MODEL || BUSY_FALLBACK];
  const busy = (err) => err.timedOut || err.status === 429 || err.status === 503;
  for (const [i, model] of models.entries()) {
    try {
      const text = await callGemini(env, prompt, { thinking: 'low', maxOutputTokens: 8192, retries: 0, timeoutMs, ...rest, model });
      return { text, model };
    } catch (err) {
      if (!busy(err)) throw err;
      if (i === models.length - 1) {
        throw new Error('Gemini가 지금 붐벼서 답하지 못했습니다(기본·예비 모델 모두). 잠시 뒤 다시 눌러 주세요.');
      }
    }
  }
}
