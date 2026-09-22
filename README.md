# 7mall.kr

쿠팡파트너스 제휴 링크 기반 리뷰 사이트. Astro(정적 사이트) + Cloudflare Workers(Static Assets).

## 로컬 개발

```bash
npm install
npm run dev
```

## 구조

- `src/content/blog/` — 리뷰 글(Markdown). frontmatter의 `products` 배열에 소개할 상품을 적으면 본문 아래 쿠팡 링크 카드가 자동으로 생성됩니다.
- `data/affiliateLinks.json` — 상품 slug → 실제 쿠팡파트너스 링크 매핑. 글을 쓸 때 여기에 slug/URL을 추가하세요.
- `worker/index.js` — Cloudflare Worker 엔트리포인트. `/go/{slug}` 요청은 실제 쿠팡 링크로 302 리다이렉트(클로킹용)하고, 나머지 요청은 `dist/`의 정적 파일(`ASSETS` 바인딩)로 전달합니다. **로컬 `astro dev`에서는 리다이렉트가 동작하지 않고, `wrangler dev`로만 테스트 가능합니다.**
- `src/components/AffiliateDisclosure.astro` — 공정거래위원회 표시광고 고지 문구. `hasAffiliateLinks: true`인 글에 자동 표시됩니다.

## 새 리뷰 글 추가하기

1. `data/affiliateLinks.json`에 상품 slug와 실제 쿠팡파트너스 링크 추가
2. `src/content/blog/`에 새 `.md` 파일 생성, `products` frontmatter에 같은 slug 사용

## Cloudflare에 배포하기

이 프로젝트는 Cloudflare Workers의 Git 연동(Workers Builds)으로 배포합니다. 대시보드에서 저장소를 연결한 뒤 **빌드 설정**에 다음을 반드시 지정하세요 (비어 있으면 `dist`가 생성되지 않아 배포가 실패합니다):

- **빌드 명령(Build command)**: `npm run build`
- **배포 명령(Deploy command)**: `npx wrangler deploy` (기본값 그대로 사용, `wrangler.toml`이 나머지를 처리함)
- **루트 디렉터리**: `/`

이후 `git push`마다 자동으로 빌드/배포됩니다.

### CLI 직접 배포

```bash
npm install -g wrangler
wrangler login          # 브라우저 인증 필요 - 직접 실행
npm run build
wrangler deploy
```

## 도메인(7mall.kr) 연결

1. Cloudflare 대시보드에 7mall.kr 도메인 추가
2. 도메인 등록기관(가비아 등)에서 네임서버를 Cloudflare가 안내하는 값으로 변경
3. Worker 프로젝트(coupang) 설정 → 도메인 → Custom domains에서 7mall.kr 추가

## 법적 고지 체크리스트

- [ ] 모든 제휴 링크가 포함된 글에 `hasAffiliateLinks: true` 설정 (기본값 true)
- [ ] `/privacy` 페이지 내용을 실제 운영 방식에 맞게 구체화
- [ ] `data/affiliateLinks.json`의 placeholder URL을 실제 쿠팡파트너스 링크로 교체
