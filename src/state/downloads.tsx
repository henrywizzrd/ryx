import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths, type DownloadTask } from 'expo-file-system';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { log } from '@/lib/logger';

/**
 * Quản lý tải về: file lưu trong Documents/Downloads của app (hiện trong app Tệp → Ryx từ bản 1.0.3).
 * Tải dở khi app bị tắt thì không tải tiếp được (đánh dấu lỗi, bấm để tải lại).
 */
export type DownloadStatus = 'downloading' | 'done' | 'error' | 'canceled';

export interface DownloadItem {
  id: string;
  url: string;
  name: string;
  /** file:// trên máy */
  uri: string;
  status: DownloadStatus;
  received: number;
  total: number;
  t: number;
  error?: string;
  referer?: string;
}

const STORAGE_KEY = 'ryx:downloads:v1';
const MAX_ITEMS = 200;

let seq = 0;
const newId = () => `d-${Date.now().toString(36)}-${seq++}`;

const KNOWN_EXT = /\.(mp4|m4v|mov|webm|mkv|mp3|m4a|aac|wav|flac|jpe?g|png|gif|webp|heic|pdf|zip|rar|7z|ipa|apk|epub|txt|docx?|xlsx?|pptx?)$/i;

/** Tên file từ link: phần cuối đường dẫn (bỏ tham số), giải mã, bỏ ký tự cấm. */
export function fileNameFromUrl(url: string, fallbackExt = ''): string {
  let name = '';
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    // Link kiểu get_file/…/123.mp4/ : lấy đoạn cuối có đuôi file
    name = [...parts].reverse().find((p) => KNOWN_EXT.test(p)) ?? parts[parts.length - 1] ?? u.hostname;
    name = decodeURIComponent(name);
  } catch {
    name = 'tap-tin';
  }
  name = name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) || 'tap-tin';
  if (!KNOWN_EXT.test(name) && fallbackExt) name += `.${fallbackExt}`;
  return name;
}

function downloadsDir(): Directory {
  const dir = new Directory(Paths.document, 'Downloads');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Tránh ghi đè: "a.mp4" đã có → "a (1).mp4". */
function uniqueFile(dir: Directory, name: string): File {
  let f = new File(dir, name);
  if (!f.exists) return f;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 1000; i++) {
    f = new File(dir, `${base} (${i})${ext}`);
    if (!f.exists) return f;
  }
  return new File(dir, `${base}-${Date.now()}${ext}`);
}

function deleteFile(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {}
}

interface Ctx {
  items: DownloadItem[];
  start: (url: string, opts?: { referer?: string; ext?: string }) => string;
  cancel: (id: string) => void;
  remove: (id: string) => void;
  retry: (id: string) => void;
  clearFinished: () => void;
  /** Gọi khi một file tải xong (để hiện thông báo) */
  onFinished: React.MutableRefObject<((item: DownloadItem) => void) | null>;
}

const DownloadsCtx = createContext<Ctx | null>(null);

export function DownloadsProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const loaded = useRef(false);
  const tasks = useRef(new Map<string, DownloadTask>());
  const onFinished = useRef<((item: DownloadItem) => void) | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = (JSON.parse(raw) as DownloadItem[]).map((d) =>
          d.status === 'downloading' ? { ...d, status: 'error' as const, error: 'Bị gián đoạn khi app tắt' } : d,
        );
        setItems((cur) => [...cur, ...saved.filter((s) => !cur.some((c) => c.id === s.id))]);
      })
      .catch(() => {})
      .finally(() => {
        loaded.current = true;
      });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS))).catch(() => {});
  }, [items]);

  const patch = useCallback((id: string, p: Partial<DownloadItem>) => {
    setItems((list) => list.map((d) => (d.id === id ? { ...d, ...p } : d)));
  }, []);

  const run = useCallback(
    (item: DownloadItem) => {
      const dest = new File(item.uri);
      let last = 0;
      const task = File.createDownloadTask(item.url, dest, {
        headers: item.referer ? { Referer: item.referer } : undefined,
        onProgress: ({ bytesWritten, totalBytes }) => {
          if (bytesWritten > 0) gotBytes = true;
          const now = Date.now();
          if (now - last < 300) return; // đỡ vẽ lại liên tục
          last = now;
          patch(item.id, { received: bytesWritten, total: totalBytes > 0 ? totalBytes : 0 });
        },
      });
      tasks.current.set(item.id, task);
      const started = Date.now();
      // Không nhận được byte nào sau 25 s: gần như chắc là không kết nối được tới máy chủ
      // (tải về đi đường mạng của máy, không qua DNS riêng của Ryx → tên miền bị nhà mạng chặn sẽ treo)
      let gotBytes = false;
      const stall = setTimeout(() => {
        if (gotBytes || !tasks.current.has(item.id)) return;
        task.cancel();
        tasks.current.delete(item.id);
        patch(item.id, {
          status: 'error',
          error: 'Không kết nối được tới máy chủ (có thể bị nhà mạng chặn)',
        });
        log.warn(
          'download',
          `Tải ${item.name}: 25 s không nhận được dữ liệu`,
          `${item.url}\nTải về đi đường mạng của máy, không qua DNS riêng của Ryx. Cài hồ sơ DNS cho cả máy (Menu → DNS bảo mật) để tải được trang bị chặn.`,
        );
      }, 25000);
      task
        .downloadAsync()
        .then((file) => {
          clearTimeout(stall);
          tasks.current.delete(item.id);
          if (!file) return; // đã huỷ
          const size = file.size ?? 0;
          const done: DownloadItem = { ...item, status: 'done', received: size, total: size };
          patch(item.id, { status: 'done', received: size, total: size });
          log.info('download', `Tải xong ${item.name} (${(size / 1048576).toFixed(1)} MB, ${((Date.now() - started) / 1000).toFixed(0)} s)`, item.url);
          onFinished.current?.(done);
        })
        .catch((e: unknown) => {
          clearTimeout(stall);
          if (!tasks.current.has(item.id)) return; // đã huỷ vì treo
          tasks.current.delete(item.id);
          patch(item.id, { status: 'error', error: String(e instanceof Error ? e.message : e).slice(0, 200) });
          log.error('download', `Tải ${item.name} thất bại`, `${item.url}\n${String(e)}`);
        });
    },
    [patch],
  );

  const start = useCallback(
    (url: string, opts?: { referer?: string; ext?: string }) => {
      const dir = downloadsDir();
      const file = uniqueFile(dir, fileNameFromUrl(url, opts?.ext));
      const item: DownloadItem = {
        id: newId(),
        url,
        name: file.name,
        uri: file.uri,
        status: 'downloading',
        received: 0,
        total: 0,
        t: Date.now(),
        referer: opts?.referer,
      };
      setItems((list) => [item, ...list]);
      log.info('download', `Bắt đầu tải ${item.name}`, url);
      run(item);
      return item.id;
    },
    [run],
  );

  const cancel = useCallback(
    (id: string) => {
      tasks.current.get(id)?.cancel();
      tasks.current.delete(id);
      patch(id, { status: 'canceled' });
    },
    [patch],
  );

  const remove = useCallback((id: string) => {
    tasks.current.get(id)?.cancel();
    tasks.current.delete(id);
    setItems((list) => {
      const d = list.find((x) => x.id === id);
      if (d) deleteFile(d.uri);
      return list.filter((x) => x.id !== id);
    });
  }, []);

  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const retry = useCallback(
    (id: string) => {
      const d = itemsRef.current.find((x) => x.id === id);
      if (!d) return;
      deleteFile(d.uri);
      const again: DownloadItem = { ...d, status: 'downloading', received: 0, total: 0, error: undefined, t: Date.now() };
      setItems((list) => list.map((x) => (x.id === id ? again : x)));
      run(again);
    },
    [run],
  );

  const clearFinished = useCallback(() => {
    setItems((list) => list.filter((d) => d.status === 'downloading' || d.status === 'done'));
  }, []);

  const value = useMemo(
    () => ({ items, start, cancel, remove, retry, clearFinished, onFinished }),
    [items, start, cancel, remove, retry, clearFinished],
  );
  return <DownloadsCtx.Provider value={value}>{children}</DownloadsCtx.Provider>;
}

export function useDownloads() {
  const ctx = useContext(DownloadsCtx);
  if (!ctx) throw new Error('useDownloads must be used inside DownloadsProvider');
  return ctx;
}
