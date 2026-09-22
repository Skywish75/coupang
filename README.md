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

## 자동 발행 시스템 (관리자)

매일 지정된 시각에 Cloudflare Cron이 실행되어: 키워드 목록에서 다음 순서의 키워드로
쿠팡 상품을 검색 → 아직 소개하지 않은 상품 1개 선택 → 딥링크 생성 → Gemini로 리뷰 글
생성 → GitHub에 자동 커밋(새 글 + `affiliateLinks.json` 갱신을 한 커밋으로) → 커밋이
Cloudflare Workers Build를 자동 트리거해서 몇 분 내 사이트에 반영됩니다. 사람이 매 건
검수하지 않고 그대로 발행되므로, 초기에는 로그를 자주 확인하고 필요시 키워드를 조정하세요.

관리자 화면: `https://coupang.tclee.workers.dev/admin` (도메인 연결 후에는 `https://7mall.kr/admin`)
- 최근 실행 로그 확인
- 키워드 목록 편집 (한 줄에 하나씩, 순서대로 순환)
- "지금 1건 자동 발행" 버튼으로 cron을 기다리지 않고 즉시 실행

### 설정 체크리스트 (모두 Cloudflare/GitHub 계정에서 직접 하셔야 합니다)

**1. `/admin` 로그인 비밀번호 설정 (Basic Auth, 무료)**
   - Cloudflare Zero Trust Access는 결제 정보 등록을 요구할 수 있어, 대신 Worker 자체에 아이디/비밀번호 로그인을 내장했습니다 (추가 비용 없음).
   - 아래 시크릿을 등록하면 `/admin` 접속 시 브라우저 기본 로그인 창이 뜹니다.
   ```bash
   wrangler secret put ADMIN_USERNAME
   wrangler secret put ADMIN_PASSWORD
   ```

**2. KV 네임스페이스 생성** (키워드 목록/로그/중복방지 저장용)
   - Cloudflare 대시보드 → Storage & Databases → KV → Create a namespace (이름 예: `coupang-state`)
   - 생성된 namespace id를 [wrangler.toml](wrangler.toml)의 `REPLACE_WITH_KV_NAMESPACE_ID`에 넣고 커밋/푸시

**3. 나머지 Secrets 등록** (Cloudflare 대시보드 → Workers & Pages → coupang → 설정 → Variables and Secrets, 또는 아래 CLI)
   ```bash
   wrangler secret put COUPANG_ACCESS_KEY
   wrangler secret put COUPANG_SECRET_KEY
   wrangler secret put GEMINI_API_KEY
   wrangler secret put GITHUB_TOKEN
   ```
   - `COUPANG_ACCESS_KEY` / `COUPANG_SECRET_KEY`: partners.coupang.com → Open API 메뉴에서 발급
   - `GEMINI_API_KEY`: console.cloud.google.com 또는 aistudio.google.com에서 발급
   - `GITHUB_TOKEN`: GitHub → Settings → Developer settings → Fine-grained personal access token, `Skywish75/coupang` 저장소에 대해 **Contents: Read and write** 권한만 부여해서 발급 (다른 저장소 권한은 주지 마세요)

**4. Cron 실행 시각 조정 (선택)**
   - [wrangler.toml](wrangler.toml)의 `crons = ["0 0 * * *"]`가 매일 UTC 00:00(한국시간 09:00) 실행. 필요시 [crontab.guru](https://crontab.guru)로 표현식 확인 후 수정

### 주의사항

- 쿠팡 Open API의 정확한 요청 서명 방식은 `worker/lib/coupang.js` 주석에 적어뒀지만, 문서 버전에 따라 세부 사항이 다를 수 있어 최초 실행 시 401 오류가 나면 partners.coupang.com의 최신 API 문서와 대조해서 조정이 필요할 수 있습니다.
- AI가 생성한 글은 실제 사용 후기가 아니라 상품 정보 기반 소개글입니다. 과장/허위 후기로 보이지 않도록 프롬프트에서 사적 경험 지어내기를 금지해뒀지만, 주기적으로 관리자 화면에서 실제 발행된 글을 훑어보고 품질을 점검하는 걸 권장합니다.
