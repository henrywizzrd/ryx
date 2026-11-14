import { requireOptionalNativeModule } from 'expo';

import { colors } from '@/theme';

import { log } from './logger';

const Native = requireOptionalNativeModule<{ applyEdgeEffects?: (bg?: string) => Promise<number> }>('RyxNet');
let timer: ReturnType<typeof setTimeout> | null = null;
let logged = false;

/**
 * Bật hiệu ứng mờ dần ở mép trên (iOS 26+) cho trang web và trang chủ; WebView bỏ trong suốt (xem RyxPageBg.swift).
 * Gọi lại mỗi khi có WebView/trang chủ mới hiện ra (gộp các lần gọi sát nhau).
 */
export function applyEdgeEffects(delay = 120): void {
  const fn = Native?.applyEdgeEffects;
  if (!fn) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    // Màu theme app: WebView hiện màu này trước khi trang có nội dung
    fn(/^#[0-9a-f]{6}$/i.test(colors.bg) ? colors.bg.toLowerCase() : undefined)
      .then((n) => {
        if (!logged) {
          logged = true;
          log.debug('ui', `Hiệu ứng mờ mép trên: đã áp cho ${n} vùng`);
        }
      })
      .catch((e: unknown) => log.warn('ui', 'Không bật được hiệu ứng mờ mép trên', e));
  }, delay);
}
