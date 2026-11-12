import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

/**
 * Ghi nhớ trang nào vốn có nền tối (1) hay sáng (0), để chế độ tối áp dụng đúng
 * ngay từ khung hình đầu tiên ở lần vào sau (không bị chớp sáng → tối).
 */
export type SiteThemes = Record<string, 0 | 1>;

const STORAGE_KEY = 'ryx:site-themes:v1';
const MAX_SITES = 500;

let themes: SiteThemes = {};
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

AsyncStorage.getItem(STORAGE_KEY)
  .then((raw) => {
    if (!raw) return;
    themes = { ...(JSON.parse(raw) as SiteThemes), ...themes };
    listeners.forEach((l) => l());
  })
  .catch(() => {});

export function setSiteTheme(host: string, dark: boolean) {
  if (!host) return;
  const v = dark ? 1 : 0;
  if (themes[host] === v) return;
  const next: SiteThemes = { ...themes, [host]: v };
  const keys = Object.keys(next);
  if (keys.length > MAX_SITES) delete next[keys[0]];
  themes = next;
  listeners.forEach((l) => l());
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(themes)).catch(() => {});
  }, 1000);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const get = () => themes;

export function useSiteThemes(): SiteThemes {
  return useSyncExternalStore(subscribe, get, get);
}
