import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://7mall.kr',
  output: 'static',
  integrations: [sitemap()],
});
