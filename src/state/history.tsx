import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { log } from '@/lib/logger';

/**
 * Lịch sử duyệt web: lưu tiêu đề, link, thời gian.
 * - Giữ RETENTION_DAYS ngày, tối đa MAX_ENTRIES mục (mới nhất trước).
 * - Mở lại cùng một link trong vòng MERGE_MS thì cập nhật mục cũ thay vì thêm trùng.
 */

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  /** Lần truy cập gần nhất (ms epoch). */
  t: number;
}

const STORAGE_KEY = 'ryx:history:v1';
export const RETENTION_DAYS = 90;
const MAX_ENTRIES = 3000;
const MERGE_MS = 30 * 60 * 1000;

interface Ctx {
  entries: HistoryEntry[];
  record: (url: string, title: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

type Actions = Omit<Ctx, 'entries'>;

const HistoryCtx = createContext<Ctx | null>(null);
/** Chỉ chứa các hàm (không đổi), để tab trình duyệt ghi lịch sử mà không phải render lại mỗi khi lịch sử thay đổi. */
const HistoryActionsCtx = createContext<Actions | null>(null);

function prune(list: HistoryEntry[]): HistoryEntry[] {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return list.filter((e) => e.t >= cutoff).slice(0, MAX_ENTRIES);
}

let seq = 0;
const newId = () => `h-${Date.now().toString(36)}-${seq++}`;

export function HistoryProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = prune(JSON.parse(raw) as HistoryEntry[]);
        // Gộp với những mục ghi được trong lúc đang đọc bộ nhớ
        setEntries((cur) => [...cur, ...saved.filter((s) => !cur.some((c) => c.id === s.id))]);
      })
      .catch((e) => log.error('history', 'Không đọc được lịch sử đã lưu', e))
      .finally(() => {
        loaded.current = true;
      });
  }, []);

  // Lưu (gộp nhiều thay đổi liên tiếp)
  useEffect(() => {
    if (!loaded.current) return;
    const timer = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch((e) =>
        log.error('history', 'Không lưu được lịch sử', e),
      );
    }, 800);
    return () => clearTimeout(timer);
  }, [entries]);

  const record = useCallback((url: string, title: string) => {
    if (!/^https?:/i.test(url)) return;
    const now = Date.now();
    setEntries((list) => {
      const first = list[0];
      if (first && first.url === url && now - first.t < MERGE_MS) {
        return [{ ...first, title: title || first.title, t: now }, ...list.slice(1)];
      }
      const idx = list.findIndex((e) => e.url === url && now - e.t < MERGE_MS);
      const rest = idx >= 0 ? [...list.slice(0, idx), ...list.slice(idx + 1)] : list;
      return prune([{ id: newId(), url, title, t: now }, ...rest]);
    });
  }, []);

  const remove = useCallback((id: string) => setEntries((list) => list.filter((e) => e.id !== id)), []);

  const clear = useCallback(() => {
    setEntries([]);
    log.info('history', 'Đã xoá toàn bộ lịch sử');
  }, []);

  const actions = useMemo(() => ({ record, remove, clear }), [record, remove, clear]);
  const value = useMemo(() => ({ entries, ...actions }), [entries, actions]);
  return (
    <HistoryActionsCtx.Provider value={actions}>
      <HistoryCtx.Provider value={value}>{children}</HistoryCtx.Provider>
    </HistoryActionsCtx.Provider>
  );
}

export function useHistory() {
  const ctx = useContext(HistoryCtx);
  if (!ctx) throw new Error('useHistory must be used inside HistoryProvider');
  return ctx;
}

export function useHistoryActions() {
  const ctx = useContext(HistoryActionsCtx);
  if (!ctx) throw new Error('useHistoryActions must be used inside HistoryProvider');
  return ctx;
}
