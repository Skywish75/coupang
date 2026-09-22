// gemini-2.0-flash is on the free (no billing required) tier as of this
// writing. Newer/heavier models (e.g. gemini-2.5-flash) may require a
// billing-enabled project even at low usage — if this keeps hitting 402s,
// check https://ai.google.dev/gemini-api/docs/pricing for which models
// currently show a free tier and set GEMINI_MODEL in wrangler.toml to match.
const MODEL_FALLBACK = 'gemini-2.0-flash';

// Generates a Korean review-style markdown body for one product.
// Returns plain markdown (no frontmatter, no heading).
export async function generateArticle(env, product, topic) {
  const model = env.GEMINI_MODEL || MODEL_FALLBACK;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

  const prompt = `당신은 쿠팡파트너스 제휴 마케팅 콘텐츠를 작성하는 한국어 카피라이터입니다.
아래 상품 정보를 바탕으로, 실제로 사용해본 것처럼 구체적인 사적 경험(예: "제가 3개월 써봤는데")을
지어내지 않으면서 제품의 특징과 장점을 객관적으로 소개하는 리뷰 스타일 글을 작성하세요.

요구사항:
- 분량: 400~600자, 2~4개 문단
- 상품명과 가격을 본문에 자연스럽게 포함
- 문단 사이는 빈 줄 한 줄로 구분
- 마크다운 본문만 출력 (제목/프론트매터 없이 본문만)

카테고리(검색 키워드): ${topic}
상품명: ${product.productName}
가격: ${product.productPrice}원
`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  if (!res.ok) {
    throw new Error(`Gemini API failed (${res.status}): ${await res.text()}`);
  }

  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  if (!text.trim()) {
    throw new Error('Gemini API returned empty content');
  }
  return text.trim();
}
