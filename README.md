# 7mall.kr

쿠팡파트너스 제휴 링크 기반 리뷰 사이트. Astro(정적 사이트) + Cloudflare Pages.

## 로컬 개발

```bash
npm install
npm run dev
```

## 구조

- `src/content/blog/` — 리뷰 글(Markdown). frontmatter의 `products` 배열에 소개할 상품을 적으면 본문 아래 쿠팡 링크 카드가 자동으로 생성됩니다.
- `data/affiliateLinks.json` — 상품 slug → 실제 쿠팡파트너스 링크 매핑. 글을 쓸 때 여기에 slug/URL을 추가하세요.
- `functions/go/[slug].js` — Cloudflare Pages Function. `/go/{slug}` 접속 시 실제 쿠팡 링크로 302 리다이렉트(클로킹용). **로컬 `astro dev`에서는 동작하지 않고, `wrangler pages dev`로만 테스트 가능합니다.**
- `src/components/AffiliateDisclosure.astro` — 공정거래위원회 표시광고 고지 문구. `hasAffiliateLinks: true`인 글에 자동 표시됩니다.

## 새 리뷰 글 추가하기

1. `data/affiliateLinks.json`에 상품 slug와 실제 쿠팡파트너스 링크 추가
2. `src/content/blog/`에 새 `.md` 파일 생성, `products` frontmatter에 같은 slug 사용

## Cloudflare에 배포하기

### 방법 A: Git 연동 (권장)

1. GitHub에 이 저장소 push
2. Cloudflare 대시보드 → Pages → "Create a project" → 저장소 연결
3. Build command: `npm run build`, Build output directory: `dist`
4. 이후 `git push`마다 자동 배포됨

### 방법 B: CLI 직접 배포

```bash
npm install -g wrangler
wrangler login          # 브라우저 인증 필요 - 직접 실행
npm run build
wrangler pages deploy dist --project-name=7mall
```

## 도메인(7mall.kr) 연결

1. Cloudflare 대시보드에 7mall.kr 도메인 추가
2. 도메인 등록기관(가비아 등)에서 네임서버를 Cloudflare가 안내하는 값으로 변경
3. Cloudflare Pages 프로젝트 설정 → Custom domains → 7mall.kr 추가

## 법적 고지 체크리스트

- [ ] 모든 제휴 링크가 포함된 글에 `hasAffiliateLinks: true` 설정 (기본값 true)
- [ ] `/privacy` 페이지 내용을 실제 운영 방식에 맞게 구체화
- [ ] `data/affiliateLinks.json`의 placeholder URL을 실제 쿠팡파트너스 링크로 교체
