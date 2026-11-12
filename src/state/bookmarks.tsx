import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { log } from '@/lib/logger';

/**
 * Dấu trang = các ô "Truy cập nhanh" trên trang Thẻ mới (sửa, xoá, đưa lên đầu được).
 * Lần đầu mở app có sẵn vài trang phổ biến.
 */
export interface Bookmark {
  id: string;
  url: string;
  title: string;
  t: number;
}

const STORAGE_KEY = 'ryx:bookmarks:v1';
const MAX = 200;

const DEFAULTS: { title: string; url: string }[] = [
  { title: 'Google', url: 'https://www.google.com' },
  { title: 'YouTube', url: 'https://m.youtube.com' },
  { title: 'VnExpress', url: 'https://vnexpress.net' },
  { title: 'Tuổi Trẻ', url: 'https://tuoitre.vn' },
  { title: 'Wikipedia', url: 'https://vi.wikipedia.org' },
  { title: 'Facebook', url: 'https://m.facebook.com' },
  { title: 'Shopee', url: 'https://shopee.vn' },
  { title: 'Zing MP3', url: 'https://zingmp3.vn' },
];

let seq = 0;
const newId = () => `b-${Date.now().toString(36)}-${seq++}`;

/** So khớp bỏ qua dấu "/" cuối và "www." để không lưu trùng. */
export function sameUrl(a: string, b: string): boolean {
  const n = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '').toLowerCase();
  return n(a) === n(b);
}

interface Ctx {
  bookmarks: Bookmark[];
  isBookmarked: (url: string | null | undefined) => boolean;
  add: (url: string, title: string) => void;
  remove: (url: string) => void;
  toggle: (url: string, title: string) => boolean;
  moveToFront: (id: string) => void;
  rename: (id: string, title: string) => void;
}

const BookmarksCtx = createContext<Ctx | null>(null);

export function BookmarksProvider({ children }: { children: React.ReactNode }) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) setBookmarks(JSON.parse(raw) as Bookmark[]);
        else setBookmarks(DEFAULTS.map((d, i) => ({ id: newId(), url: d.url, title: d.title, t: Date.now() - i })));
      })
      .catch((e) => log.error('bookmarks', 'Không đọc được dấu trang', e))
      .finally(() => {
        loaded.current = true;
      });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks)).catch(() => {});
  }, [bookmarks]);

  const add = useCallback((url: string, title: string) => {
    setBookmarks((list) =>
      list.some((b) => sameUrl(b.url, url))
        ? list
        : [...list, { id: newId(), url, title: title || url, t: Date.now() }].slice(0, MAX),
    );
  }, []);
  const remove = useCallback((url: string) => {
    setBookmarks((list) => list.filter((b) => !sameUrl(b.url, url)));
  }, []);
  const moveToFront = useCallback((id: string) => {
    setBookmarks((list) => {
      const b = list.find((x) => x.id === id);
      return b ? [b, ...list.filter((x) => x.id !== id)] : list;
    });
  }, []);
  const rename = useCallback((id: string, title: string) => {
    setBookmarks((list) => list.map((b) => (b.id === id ? { ...b, title: title.trim() || b.title } : b)));
  }, []);

  const isBookmarked = useCallback(
    (url: string | null | undefined) => !!url && bookmarks.some((b) => sameUrl(b.url, url)),
    [bookmarks],
  );
  const toggle = useCallback(
    (url: string, title: string) => {
      const has = bookmarks.some((b) => sameUrl(b.url, url));
      if (has) remove(url);
      else add(url, title);
      return !has;
    },
    [bookmarks, add, remove],
  );

  const value = useMemo(
    () => ({ bookmarks, isBookmarked, add, remove, toggle, moveToFront, rename }),
    [bookmarks, isBookmarked, add, remove, toggle, moveToFront, rename],
  );
  return <BookmarksCtx.Provider value={value}>{children}</BookmarksCtx.Provider>;
}

export function useBookmarks() {
  const ctx = useContext(BookmarksCtx);
  if (!ctx) throw new Error('useBookmarks must be used inside BookmarksProvider');
  return ctx;
}
