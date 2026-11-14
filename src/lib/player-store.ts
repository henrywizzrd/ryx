import { useSyncExternalStore } from 'react';

/** Trạng thái trình phát toàn màn hình của Ryx (lib/inject: window.__ryxFs gửi về qua ryx:fs / ryx:fst) */
export interface PlayerState {
  on: boolean;
  /** Thẻ đang phát toàn màn hình */
  tabId: string | null;
  w: number;
  h: number;
  t: number;
  d: number;
  playing: boolean;
  rate: number;
  buffered: number;
}

const OFF: PlayerState = { on: false, tabId: null, w: 16, h: 9, t: 0, d: 0, playing: false, rate: 1, buffered: 0 };
let state: PlayerState = OFF;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const playerStore = {
  get: () => state,
  subscribe: (f: () => void) => {
    subs.add(f);
    return () => subs.delete(f);
  },
  start(tabId: string, w: number, h: number) {
    state = { ...OFF, on: true, tabId, w: w || 16, h: h || 9 };
    emit();
  },
  tick(tabId: string, p: Partial<PlayerState>) {
    if (!state.on || state.tabId !== tabId) return;
    state = { ...state, ...p, w: p.w || state.w, h: p.h || state.h };
    emit();
  },
  stop(tabId?: string) {
    if (!state.on || (tabId && state.tabId !== tabId)) return;
    state = OFF;
    emit();
  },
};

export function usePlayer(): PlayerState {
  return useSyncExternalStore(playerStore.subscribe, playerStore.get);
}
/** Chỉ bật/tắt (không vẽ lại mỗi lần thời gian đổi) */
export function usePlayerOn(): { on: boolean; tabId: string | null; landscape: boolean } {
  const on = useSyncExternalStore(playerStore.subscribe, () => state.on);
  const tabId = useSyncExternalStore(playerStore.subscribe, () => state.tabId);
  const landscape = useSyncExternalStore(playerStore.subscribe, () => state.w > state.h * 1.1);
  return { on, tabId, landscape };
}
