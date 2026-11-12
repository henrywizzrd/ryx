/**
 * Luật riêng cho từng trang (rút ra từ Nhật ký), áp dụng như quảng cáo thường.
 * Khoá là tên miền không có "www.".
 */
export const SITE_AD_SELECTORS: Record<string, string[]> = {
  'xnhau.pink': [
    // Banner video nhà cái tải từ chính trang: /static/media/mobile-…-ddmmyy.mp4, catfish-…
    'video[src*="/static/media/mobile-"]',
    'video[src*="/static/media/catfish-"]',
    'video[poster*="/static/media/mobile-"]',
    'video[poster*="/static/media/catfish-"]',
    'video:has(source[src*="/static/media/"])',
    '[class*="catfish"]',
    '[id*="catfish"]',
  ],
};
