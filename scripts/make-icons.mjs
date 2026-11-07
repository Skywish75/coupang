// Renders the PNG images under public/icons/ from inline SVG.
// Run once after changing the designs: `node scripts/make-icons.mjs`
// (sharp is installed with Astro, so there is nothing extra to install).
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const OUT = new URL('../public/icons/', import.meta.url);
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

// Lotto ball colours used on the /lotto page (1–10 yellow, 11–20 blue, 21–30 red).
const BALLS = [
  { n: 7, fill: '#fbc400', shade: '#d9a400', num: '#8a6400', cx: 256, cy: 196 },
  { n: 19, fill: '#1877b8', shade: '#0f5a8e', num: '#0f5a8e', cx: 178, cy: 330 },
  { n: 26, fill: '#d43d3d', shade: '#a82828', num: '#a82828', cx: 334, cy: 330 },
];

function ball({ n, fill, shade, num, cx, cy }, r) {
  const id = `g${n}`;
  return `
    <defs>
      <radialGradient id="${id}" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/>
        <stop offset="35%" stop-color="${fill}"/>
        <stop offset="100%" stop-color="${shade}"/>
      </radialGradient>
    </defs>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id})"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.52}" fill="#ffffff" fill-opacity="0.9"/>
    <text x="${cx}" y="${cy}" dy="0.36em" text-anchor="middle" font-family="${FONT}"
      font-weight="800" font-size="${r * 0.72}" fill="${num}">${n}</text>`;
}

// `scale` shrinks the balls toward the centre (maskable icons need a safe zone).
function lottoIcon({ rounded, scale = 1 }) {
  const balls = BALLS.map((b) =>
    ball({ ...b, cx: 256 + (b.cx - 256) * scale, cy: 263 + (b.cy - 263) * scale }, 92 * scale)
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="#14325a"/>
    ${balls}
  </svg>`;
}

// 1200×630 social preview used as og:image across the site.
function ogImage() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#f7f8fa"/>
    <rect x="0" y="0" width="1200" height="12" fill="#e4312b"/>
    <text x="96" y="250" font-family="${FONT}" font-weight="800" font-size="104" fill="#14325a">7mall.kr</text>
    <text x="96" y="345" font-family="${FONT}" font-weight="600" font-size="46" fill="#374151">쿠팡 인기 상품 가격 기록 · 비교</text>
    <text x="96" y="420" font-family="${FONT}" font-weight="500" font-size="34" fill="#6b7280">매일 기록한 가격으로 30일 최저가를 확인하세요</text>
    <g transform="translate(800 170)">
      <rect width="300" height="260" rx="22" fill="#ffffff" stroke="#e5e7eb" stroke-width="3"/>
      <polyline points="34,92 82,70 130,118 178,104 226,170 266,150" fill="none" stroke="#14325a"
        stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="226" cy="170" r="13" fill="#e4312b"/>
      <rect x="150" y="196" width="122" height="42" rx="21" fill="#e4312b"/>
      <text x="211" y="217" dy="0.36em" text-anchor="middle" font-family="${FONT}" font-weight="700"
        font-size="24" fill="#ffffff">최저가</text>
    </g>
  </svg>`;
}

function lottoOgImage() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#14325a"/>
    <text x="90" y="230" font-family="${FONT}" font-weight="800" font-size="92" fill="#ffffff">로또 번호 추천기</text>
    <text x="90" y="320" font-family="${FONT}" font-weight="600" font-size="44" fill="#dbe7f5">이미 산 번호는 빼고, 남은 번호로 랜덤 생성</text>
    <text x="90" y="395" font-family="${FONT}" font-weight="500" font-size="34" fill="#9fb6d3">용지 QR 인식 · 제외 번호 선택 · 텔레그램 알림</text>
    <text x="90" y="520" font-family="${FONT}" font-weight="700" font-size="30" fill="#fbc400">무작위 조합이며 당첨을 약속하지 않습니다</text>
    <g transform="translate(840 120) scale(0.66)">${BALLS.map((b) => ball(b, 92)).join('')}</g>
  </svg>`;
}

const jobs = [
  ['lotto-512.png', lottoIcon({ rounded: true }), 512],
  ['lotto-192.png', lottoIcon({ rounded: true }), 192],
  ['lotto-maskable-512.png', lottoIcon({ rounded: false, scale: 0.78 }), 512],
  ['lotto-apple-180.png', lottoIcon({ rounded: false, scale: 0.9 }), 180],
  ['og-default.png', ogImage(), null],
  ['og-lotto.png', lottoOgImage(), null],
];

await mkdir(OUT, { recursive: true });
for (const [name, svg, size] of jobs) {
  let img = sharp(Buffer.from(svg));
  if (size) img = img.resize(size, size);
  await img.png({ compressionLevel: 9 }).toFile(new URL(name, OUT).pathname);
  console.log('wrote', name);
}
