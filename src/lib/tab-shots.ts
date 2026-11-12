import type { RefObject } from 'react';
import type { HostInstance } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { log } from './logger';

/**
 * Ảnh chụp thu nhỏ của trang cho màn quản lý thẻ.
 * Mỗi thẻ đăng ký vùng hiển thị WebView của nó; chỉ chụp được khi thẻ đang hiện trên màn hình.
 */
type Target = { ref: RefObject<HostInstance | null>; isVisible: () => boolean; onShot: (uri: string) => void };

const targets = new Map<string, Target>();
let failures = 0;

export function registerShotTarget(tabId: string, target: Target) {
  targets.set(tabId, target);
  return () => {
    if (targets.get(tabId) === target) targets.delete(tabId);
  };
}

/** Chụp thẻ (nếu đang hiện). Không bao giờ ném lỗi: chụp hỏng thì thẻ dùng hình mặc định. */
export async function captureTab(tabId: string): Promise<void> {
  const t = targets.get(tabId);
  if (!t || !t.isVisible() || !t.ref.current) return;
  try {
    const uri = await captureRef(t.ref, { format: 'jpg', quality: 0.6, width: 360, result: 'tmpfile' });
    t.onShot(uri);
  } catch (e) {
    failures++;
    if (failures <= 3) log.warn('tabs', 'Không chụp được ảnh thẻ', e);
  }
}
