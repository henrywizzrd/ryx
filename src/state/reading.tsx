import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * "Đang đọc": nhớ chương truyện mới nhất của từng bộ truyện để đọc tiếp từ trang Thẻ mới.
 */
export interface ReadingEntry {
  /** Khoá bộ truyện (tên miền + đường dẫn bỏ phần chương) */
  series: string;
  title: string;
  url: string;
  /** Tên chương ngắn, vd "Chương 45" */
  chapter: string;
  t: number;
}

const STORAGE_KEY = 'ryx:reading:v1';
const MAX = 30;

interface Ctx {
  reading: ReadingEntry[];
  recordChapter: (e: Omit<ReadingEntry, 't'>) => void;
  forget: (series: string) => void;
}

const ReadingCtx = createContext<Ctx | null>(null);

export function ReadingProvider({ children }: { children: React.ReactNode }) {
  const [reading, setReading] = useState<ReadingEntry[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) setReading(JSON.parse(raw) as ReadingEntry[]);
      })
      .catch(() => {})
      .finally(() => {
        loaded.current = true;
      });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(reading)).catch(() => {});
  }, [reading]);

  const recordChapter = useCallback((e: Omit<ReadingEntry, 't'>) => {
    setReading((list) => [{ ...e, t: Date.now() }, ...list.filter((x) => x.series !== e.series)].slice(0, MAX));
  }, []);
  const forget = useCallback((series: string) => {
    setReading((list) => list.filter((x) => x.series !== series));
  }, []);

  const value = useMemo(() => ({ reading, recordChapter, forget }), [reading, recordChapter, forget]);
  return <ReadingCtx.Provider value={value}>{children}</ReadingCtx.Provider>;
}

export function useReading() {
  const ctx = useContext(ReadingCtx);
  if (!ctx) throw new Error('useReading must be used inside ReadingProvider');
  return ctx;
}
