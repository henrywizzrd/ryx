/**
 * Bộ chọn CSS cho phần tử quảng cáo thông thường.
 * Các phần tử khớp sẽ bị ẩn (display: none) và được đếm.
 * Tránh bộ chọn quá rộng để không làm hỏng giao diện trang.
 */
export const AD_SELECTORS: string[] = [
  // Google AdSense / GPT
  'ins.adsbygoogle',
  '.adsbygoogle',
  '[id^="google_ads_"]',
  '[id^="div-gpt-ad"]',
  '[data-ad-slot]',
  '[data-ad-client]',
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'iframe[id^="google_ads_iframe"]',
  // Mạng quảng cáo nội dung
  '[id^="taboola-"]',
  '.trc_related_container',
  '.OUTBRAIN',
  '[data-widget-id][class*="mgid"]',
  'iframe[src*="adnxs.com"]',
  'iframe[src*="amazon-adsystem.com"]',
  // Tên lớp chung
  '.ad-banner',
  '.ads-banner',
  '.banner-ads',
  '.ad-container',
  '.ad-slot',
  '.advertisement',
  '.sponsored-ad',
  '[aria-label="Advertisement"]',
  '[aria-label="Quảng cáo"]',
  // Trang Việt Nam
  '.quang-cao',
  '.box-quangcao',
  '.banner-qc',
  '.box-qc',
  '[id^="admzone"]',
  '[id^="adm-slot"]',
  'iframe[src*="admicro.vn"]',
  'iframe[src*="eclick.vn"]',
  'div[id^="ads_"]',
];

/**
 * Bộ chọn cho lớp phủ pop-up / quảng cáo dính (sticky) hay chặn nội dung.
 */
export const POPUP_SELECTORS: string[] = [
  '.popup-ads',
  '.ads-popup',
  '.ad-overlay',
  '.sticky-ad',
  '.sticky-ads',
  '[id*="catfish"]',
  '[class*="catfish"]',
  '[id*="balloon-ad"]',
  '.ads-preload',
];
