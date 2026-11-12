import { GAMBLING_HOST_KEYWORDS } from './gambling-domains';

/**
 * Bộ chọn CSS cho banner cờ bạc / nhà cái.
 * Ngoài danh sách thủ công, mọi liên kết/iframe trỏ tới từ khoá nhà cái cũng bị ẩn.
 */
export const GAMBLING_SELECTORS_MANUAL: string[] = [
  '[class*="nhacai"]',
  '[id*="nhacai"]',
  '[class*="banner-casino"]',
  '[class*="bet-banner"]',
  'img[src*="casino"]',
  'img[alt*="nhà cái" i]',
  'img[alt*="casino" i]',
];

export const GAMBLING_SELECTORS: string[] = [
  ...GAMBLING_SELECTORS_MANUAL,
  ...GAMBLING_HOST_KEYWORDS.flatMap((k) => [
    `a[href*="${k}"]`,
    `iframe[src*="${k}"]`,
    // Banner video cờ bạc tải từ chính trang (vd /static/media/mobile-new88-….mp4)
    `video[src*="${k}"]`,
    `video[poster*="${k}"]`,
    `video:has(source[src*="${k}"])`,
  ]),
];
