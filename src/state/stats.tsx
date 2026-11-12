import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import type { BlockCategory } from '@/lib/blocker';

export type Counts = Record<BlockCategory, number>;
export const EMPTY_COUNTS: Counts = { ads: 0, gambling: 0, popups: 0 };

/** Số lượng chặn theo ngày, khoá "YYYY-MM-DD". */
type Daily = Record<string, Counts>;

const STORAGE_KEY = 'ryx.stats.v1';
const KEEP_DAYS = 14;

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    out.push(dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
  }
  return out;
}

interface StatsCtx {
  week: Counts & { total: number };
  record: (delta: Partial<Counts>) => void;
}

const Ctx = createContext<StatsCtx | null>(null);

export function StatsProvider({ children }: { children: React.ReactNode }) {
  const [daily, setDaily] = useState<Daily>({});
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          const saved = JSON.parse(raw) as Daily;
          // Gộp với số liệu ghi nhận trước khi tải xong
          setDaily((cur) => {
            const merged = { ...saved };
            for (const [k, v] of Object.entries(cur)) {
              const b = merged[k] ?? EMPTY_COUNTS;
              merged[k] = { ads: b.ads + v.ads, gambling: b.gambling + v.gambling, popups: b.popups + v.popups };
            }
            return merged;
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        loaded.current = true;
      });
  }, []);

  // Lưu có trì hoãn để tránh ghi liên tục
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => {
      const keep = new Set(lastNDays(KEEP_DAYS));
      const pruned = Object.fromEntries(Object.entries(daily).filter(([k]) => keep.has(k)));
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pruned)).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [daily]);

  const record = useCallback((delta: Partial<Counts>) => {
    const k = dayKey(new Date());
    setDaily((d) => {
      const b = d[k] ?? EMPTY_COUNTS;
      return {
        ...d,
        [k]: {
          ads: b.ads + (delta.ads ?? 0),
          gambling: b.gambling + (delta.gambling ?? 0),
          popups: b.popups + (delta.popups ?? 0),
        },
      };
    });
  }, []);

  const week = useMemo(() => {
    const sum = { ...EMPTY_COUNTS };
    for (const k of lastNDays(7)) {
      const c = daily[k];
      if (!c) continue;
      sum.ads += c.ads;
      sum.gambling += c.gambling;
      sum.popups += c.popups;
    }
    return { ...sum, total: sum.ads + sum.gambling + sum.popups };
  }, [daily]);

  const value = useMemo(() => ({ week, record }), [week, record]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStats() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStats must be used inside StatsProvider');
  return ctx;
}
