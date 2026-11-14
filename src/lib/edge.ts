import { requireOptionalNativeModule } from 'expo';

import { colors } from '@/theme';

import { log } from './logger';

const Native = requireOptionalNativeModule<{
  applyEdgeEffects?: (bg?: string, top?: number, bottom?: number) => Promise<number>;
}>('RyxNet');
let timer: ReturnType<typeof setTimeout> | null = null;
let logged = false;
/** Vùng trên (giờ/pin + thanh địa chỉ nếu ở trên) và dưới (dock) đang che trang — native báo cho WebKit (RyxEdge.obscure) */
let webInsets: { top: number; bottom: number } | null = null;

/** Đặt vùng bị che của trang web; đổi thì áp lại ngay cho mọi WebView */
export function setWebInsets(top: number, bottom: number): void {
  if (webInsets && webInsets.top === top && webInsets.bottom === bottom) return;
  webInsets = { top, bottom };
  applyEdgeEffects(0);
}

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
    fn(/^#[0-9a-f]{6}$/i.test(colors.bg) ? colors.bg.toLowerCase() : undefined, webInsets?.top, webInsets?.bottom)
      .then((n) => {
        if (!logged) {
          logged = true;
          log.debug('ui', `Hiệu ứng mờ mép trên: đã áp cho ${n} vùng`);
        }
      })
      .catch((e: unknown) => log.warn('ui', 'Không bật được hiệu ứng mờ mép trên', e));
  }, delay);
}
