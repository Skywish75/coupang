const COUPANG_CODE = /coupang\.com|coupa\.ng/i;

// Every ad slot is labelled as an ad; Coupang banners also need the Partners
// disclosure right next to them, wherever they appear.
export function slotHtml(code) {
  if (!code) return '';
  const disclosure = COUPANG_CODE.test(code)
    ? '<p class="ad-disclosure">이 배너는 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.</p>'
    : '';
  return `<span class="ad-label">광고</span>${code}${disclosure}`;
}
