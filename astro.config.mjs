import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  // 도메인(7mall.kr) 연결 전까지는 workers.dev 주소를 사용한다. 연결 후 'https://7mall.kr'로 변경.
  site: 'https://coupang.tclee.workers.dev',
  output: 'static',
  integrations: [sitemap()],
});
