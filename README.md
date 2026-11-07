# 가격일기

쿠팡 인기 상품 가격을 매일 기록해 30일 최저가와 비교하는 사이트(쿠팡 파트너스 제휴)와 로또 번호 생성기. 주소: https://coupang.tclee.workers.dev Astro(정적 사이트) + Cloudflare Workers(Static Assets).

## 로컬 개발

```bash
npm install
npm run dev
```

## 구조

- `src/content/blog/` — 상품 정리 글(Markdown). frontmatter의 `products` 배열에 소개할 상품을 적으면 본문 아래 쿠팡 링크 카드가 자동으로 생성됩니다. 매일 1건씩 자동으로 쓰던 글은 2026-11-07에 멈췄고(기존 글은 그대로 둠), 지금은 직접 쓴 글만 추가합니다.
- `data/affiliateLinks.json` — 상품 slug → 실제 쿠팡파트너스 링크 매핑. 글을 쓸 때 여기에 slug/URL을 추가하세요.
- `worker/index.js` — Cloudflare Worker 엔트리포인트. `/go/{slug}` 요청은 실제 쿠팡 링크로 302 리다이렉트(클로킹용)하고, 나머지 요청은 `dist/`의 정적 파일(`ASSETS` 바인딩)로 전달합니다. **로컬 `astro dev`에서는 리다이렉트가 동작하지 않고, `wrangler dev`로만 테스트 가능합니다.**
- `src/components/AffiliateDisclosure.astro` — 공정거래위원회 표시광고 고지 문구. `hasAffiliateLinks: true`인 글에 자동 표시됩니다.
- `src/components/AiNotice.astro` — "AI 도움으로 작성, 직접 사용 후기 아님" 안내. `aiAssisted`가 `true`(기본값)인 글에 표시됩니다. 직접 써 보고 쓴 글은 frontmatter에 `aiAssisted: false`를 넣으세요.
- `data/priceHistory.json` — 상품별 일일 판매가 기록(최근 90일). 글의 "가격 정보" 박스와 비교 페이지의 30일 최저가에 쓰입니다.
- `data/topicSnapshots.json` — 키워드별 쿠팡 검색 상위 10개 상품(`TOP_N`). `/compare/{키워드}` 비교 페이지가 이 파일로 만들어집니다.
- `/compare/{키워드}` — 현재가, 단위 가격(물티슈·기저귀 1매당, 생수 100ml당, 세제 100ml·100g·1개당), 30일 최저가와 작은 가격 그래프, "평소보다 N% 쌈"(7일 이상 기록 · 30일 평균보다 3% 이상 낮음) 표시. 단위 가격은 상품명의 수량으로 계산하며(`src/lib/units.js`, 테스트 `worker/lib/units.test.js`), 수량이 애매하면 계산하지 않습니다.
- `/price-changes/` — 최근 7일 동안 가격이 내린/오른 상품과 지금 30일 최저가인 상품. 매일 가격 커밋 때 다시 빌드됩니다.
- `src/content/guides/` — 키워드별 구매 가이드(비교 페이지 하단). 키워드마다 한 번 자동 생성됩니다.

## 매일 자동 실행 (00:00 UTC = 오전 9시)

cron은 `wrangler.toml`에 하나만 있고(무료 플랜 계정당 5개 제한), 실행 시각에 따라 `worker/lib/schedule.js`가 할 일을 고릅니다: 매일 09시 가격 기록, 토요일 10~12시 텔레그램 로또 발송, 토 22시·일 0시/10시 당첨번호 수집.

Worker의 cron이 한 번 실행될 때 다음을 하나의 커밋으로 GitHub에 올립니다.

1. 모든 키워드를 쿠팡 검색 API로 1회씩 조회해 가격 기록·비교 데이터 갱신 (검색 API 호출 제한 때문에 최대 8개 키워드 — 지금 8개라 키워드를 더 넣으면 매일 일부가 돌아가며 빠집니다)
2. 구매 가이드가 없는 키워드 1개에 가이드 생성

커밋 메시지는 `chore: update price data (날짜)`이고, 이 커밋으로 사이트가 다시 빌드되어 비교·가격 변동 페이지가 갱신됩니다.
기본 키워드는 `worker/lib/state.js`의 `DEFAULT_TOPICS`(관리자 페이지에서 키워드를 저장하면 KV `topics`가 대신 쓰입니다).

가격은 옵션별로 기록합니다(`priceKey` = productId-itemId). 쿠팡은 10개/20개 같은 옵션에 같은 productId를 쓰기 때문입니다.
Gemini가 실패해도 가격 데이터는 저장됩니다(가이드는 다음 실행에 다시 시도). 테스트는 `npm test` (실제 API 호출 없음).

## 관리자 페이지 (`/admin`)

`ADMIN_USERNAME` / `ADMIN_PASSWORD` secret으로 로그인합니다 (`npx wrangler secret put ADMIN_PASSWORD` 로 변경).

- **통계**: 전체·키워드별·날짜별 글 수(GitHub 저장소 기준), 가격 추적 상품 수, 비교 페이지·가이드 현황, 마지막 실행 결과
- **지금 실행**: cron을 기다리지 않고 가격 기록을 바로 실행 (쿠팡 검색 API는 시간당 호출 수 제한이 있으니, 09시 자동 실행 직후에는 누르지 마세요)
- **쿠팡 클릭 수**: `/go/` 링크 클릭을 날짜·상품·출발 페이지별로 집계 (D1 `coupang-stats`, 봇·미리보기 제외)
- **광고 코드**: `<head>` 코드, 상단 배너, 본문 아래 배너, `ads.txt`를 편집. 저장하면 `data/ads.json`이 커밋되고 자동 빌드로 2~3분 뒤 반영됩니다. 쿠팡 배너에는 파트너스 고지 문구가 자동으로 붙습니다.

D1 테이블을 바꿀 때는 `migrations/`에 SQL을 추가하고 `npx wrangler d1 migrations apply coupang-stats --remote`를 직접 실행하세요 (자동 배포로는 적용되지 않습니다).

## 로또 번호 추천 페이지 (`/lotto`)

- 이미 산 게임(용지 QR 사진 또는 직접 입력)과 빼고 싶은 번호를 제외하고 무작위로 1~5게임을 뽑습니다. 모든 계산은 방문자 브라우저에서 하므로 Worker 요청이 생기지 않습니다.
- 용지 QR은 `jsqr`로 기기 안에서 읽습니다(QR 형식: `?v=<회차>` 뒤에 게임마다 문자 1개 + 숫자 12자리). 로직은 `src/lib/lotto.js`, 테스트는 `worker/lib/lotto.test.js`.
- **당첨 확인 기록**: 회차마다 마지막으로 뽑은 번호를 브라우저에 저장하고, `data/lottoResults.json`의 당첨번호와 맞춰 등수를 보여 줍니다.
- **당첨번호 수집**: 토요일 22시, 일요일 0시·10시에 [smok95/lotto](https://github.com/smok95/lotto) 공개 JSON에서 가져와 커밋합니다(동행복권 자체 API는 개편으로 없어졌고 해외 IP를 막습니다). 관리자 페이지에서 바로 가져올 수도 있습니다.
- **텔레그램 주간 발송**: 매주 토요일 10~12시에 구독자에게 추천 번호 5게임과 지난주 결과를 보냅니다(무료 플랜 제한으로 매시 최대 40명). 봇에게 산 번호를 보내면 그 번호를 빼고 다시 뽑아 줍니다. 구독자는 D1 `lotto_subscribers` 테이블(Worker가 처음 쓸 때 자동 생성).

텔레그램 봇 설정 (한 번만):
1. 텔레그램 @BotFather 에게 `/newbot` → 봇 이름·아이디 정하고 토큰 받기
2. Cloudflare 대시보드 → Workers & Pages → coupang → 설정 → Variables and Secrets → Secret `TELEGRAM_BOT_TOKEN` 추가 (또는 `npx wrangler secret put TELEGRAM_BOT_TOKEN`)
3. `/admin` → "로또 번호 · 텔레그램" → **텔레그램 봇 연결**. 웹훅·명령어 메뉴가 설정되고 `data/telegram.json`에 봇 아이디가 커밋되어 `/lotto` 페이지에 구독 버튼이 생깁니다.
4. 사이트 주소가 바뀌면 새 주소의 `/admin`에서 **텔레그램 봇 연결**을 한 번 더 누르세요(웹훅 주소 갱신).

## 검색엔진(SEO)

- 자동 글은 가격 기록 14일 이상 · 최근 3일 안에 기록 있음 · 30일 가격 변동 2배 미만일 때만 검색에 노출합니다(`src/lib/posts.ts`의 `isIndexablePost`). 나머지는 `noindex, follow`이고 사이트맵·RSS에서도 빠집니다. 직접 쓴 글(`aiAssisted: false`)은 항상 노출됩니다.
- 사이트맵 `/sitemap-index.xml`(페이지별 lastmod), RSS `/rss.xml`, `/robots.txt`는 빌드 때 `site` 값으로 만들어집니다. 네이버 서치어드바이저에 사이트맵과 RSS를 제출하세요.
- 공유 이미지·아이콘(`public/icons/`)은 `node scripts/make-icons.mjs`로 다시 만듭니다(로컬 Mac에서 실행 후 커밋 — 빌드 서버엔 한글 폰트가 없을 수 있음).

## 직접 글 추가하기

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

## 사이트 주소

당분간 `https://coupang.tclee.workers.dev`를 씁니다. 나중에 주소를 바꾸면 `astro.config.mjs`의 `SITE`를 바꾸고(canonical·og·사이트맵·robots.txt·RSS가 이 값을 따름), 옛 주소에서 301 리다이렉트를 걸고, 검색엔진 등록과 텔레그램 봇 연결을 새 주소로 다시 하세요.

## 법적 고지 체크리스트

- [ ] 모든 제휴 링크가 포함된 글에 `hasAffiliateLinks: true` 설정 (기본값 true)
- [x] `/privacy` 페이지 내용을 실제 운영 방식에 맞게 구체화 (개인정보 보호책임자 연락처 포함)
- [ ] `data/affiliateLinks.json`의 placeholder URL을 실제 쿠팡파트너스 링크로 교체

## 자동 가격 기록 시스템 (관리자)

매일 지정된 시각에 Cloudflare Cron이 실행되어: 모든 키워드로 쿠팡 상품을 검색 → 가격 기록·비교 데이터·
제휴 링크 갱신(+ 필요하면 구매 가이드 1개) → GitHub에 한 커밋으로 올림 → 커밋이 Cloudflare Workers Build를
자동 트리거해서 몇 분 내 사이트에 반영됩니다.

관리자 화면: `https://coupang.tclee.workers.dev/admin`
- 최근 실행 로그 확인
- 키워드 목록 편집 (한 줄에 하나씩)
- "지금 실행" 버튼으로 cron을 기다리지 않고 즉시 실행

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
- AI가 쓴 구매 가이드와 예전 자동 글은 실제 사용 후기가 아니라 일반 기준·상품 정보 기반 소개글입니다. 프롬프트에서 사적 경험 지어내기를 금지해뒀지만, 새 키워드의 가이드가 생기면 한 번씩 읽어 보고 점검하는 걸 권장합니다.
