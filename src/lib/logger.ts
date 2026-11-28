import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * Nhật ký trong app: lỗi JS, lỗi WebView, cảnh báo hiệu năng, dấu hiệu crash.
 * - Giữ tối đa MAX_ENTRIES dòng trong bộ nhớ, lưu PERSISTED dòng gần nhất vào AsyncStorage
 *   để xem lại sau khi app bị crash/khởi động lại.
 * - Không phụ thuộc React: gọi được từ bất cứ đâu (`log.error('web', '...')`).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'perf' | 'crash';

export interface LogEntry {
  id: number;
  /** Thời điểm (ms epoch). */
  t: number;
  level: LogLevel;
  /** Nguồn: app, js, react, web, perf, net… */
  tag: string;
  msg: string;
  /** Chi tiết thêm: stack, url, số đo… (chuỗi để hiển thị/xuất nguyên văn). */
  detail?: string;
  /** Mã phiên chạy app, để phân biệt log của lần mở trước. */
  session: string;
}

const STORAGE_KEY = 'ryx:logs:v1';
const SESSION_KEY = 'ryx:session:v1';
const MAX_ENTRIES = 1500;
const PERSISTED = 600;
const MAX_DETAIL = 4000;

export const SESSION_ID = Date.now().toString(36);

/* ------------------------------------------------------------------ */
/* Quyền riêng tư: nhật ký chỉ giữ vấn đề (cảnh báo, lỗi, crash, giật), */
/* không giữ hoạt động (mở trang, bấm nút…). Mọi đường link và tên miền */
/* bị thay bằng mã "trang-xxxx" ngay lúc ghi → không lộ lịch sử duyệt   */
/* web, nhưng vẫn biết các lỗi có cùng một trang hay không.             */
/* ------------------------------------------------------------------ */

const KEEP_LEVELS: ReadonlySet<LogLevel> = new Set<LogLevel>(['warn', 'error', 'crash', 'perf']);

/** Mã ngắn ổn định cho một tên miền (FNV-1a) — cùng trang thì cùng mã, không đoán ngược ra tên. */
function siteCode(host: string): string {
  let h = 0x811c9dc5;
  const s = host.toLowerCase().replace(/^www\./, '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `trang-${h.toString(36).slice(-4)}`;
}

// Link có lược đồ (https://…, blob:…, data:…, file:…)
const URL_RE = /\b(?:https?|wss?|ftp|blob|file|data|about|intent|itms[\w-]*):(?:\/\/)?([^\s"'`<>()[\]{}]*)/gi;
// Tên miền trần (vd "ads.abc.com") — chỉ các đuôi tên miền phổ biến để không xoá nhầm tên hàm trong stack
const HOST_RE =
  /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|info|io|co|tv|me|vn|xyz|top|site|online|club|live|app|dev|cc|to|ru|jp|kr|cn|uk|us|de|fr|br|biz|pro|vip|fun|link|win|bet|casino|asia|world|today|space|website|stream|video|watch|porn|xxx|sex|ws|su|ph|th|id|my|sg|hk|tw|la|kh|in|eu|ai|gg|so|ly|pw|lol|wtf|cam|tube|movie|shop|store|best|cloud|host|icu|cfd|sbs|bond|click|buzz|rest))\b/gi;
const IP_RE = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g;

const JS_OBJ = /^(?:window|document|self|globalThis|this|location|navigator|history)\./i;

function hostOf(rest: string): string {
  // blob:https://… → lấy tên miền bên trong
  const inner = rest.replace(/^[a-z][\w+.-]*:\/\//i, '');
  const h = inner.split(/[/?#]/)[0].split('@').pop() ?? '';
  return h.split(':')[0];
}

/** Bỏ mọi link / tên miền / IP khỏi một chuỗi log. */
export function redact(text: string): string {
  return text
    .replace(URL_RE, (_m, rest: string) => {
      const host = hostOf(rest);
      return host ? `[link ${siteCode(host)}]` : '[link]';
    })
    .replace(HOST_RE, (m: string) => (JS_OBJ.test(m) ? m : siteCode(m)))
    .replace(IP_RE, '[ip]');
}

let entries: LogEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let notifyScheduled = false;
let initialized = false;
let sessionChecked = false;

function stringify(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`.trim();
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function notify() {
  // Gộp nhiều log liên tiếp thành 1 lần cập nhật giao diện
  if (notifyScheduled) return;
  notifyScheduled = true;
  setTimeout(() => {
    notifyScheduled = false;
    listeners.forEach((l) => l());
  }, 0);
}

function schedulePersist(immediate = false) {
  if (immediate) {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = null;
    void persistNow();
    return;
  }
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistNow();
  }, 1500);
}

async function persistNow() {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-PERSISTED)));
  } catch {
    // Không ghi log ở đây để tránh vòng lặp
  }
}

export function addLog(level: LogLevel, tag: string, msg: string, detail?: unknown) {
  if (!KEEP_LEVELS.has(level)) return;
  let d = stringify(detail);
  if (d && d.length > MAX_DETAIL) d = d.slice(0, MAX_DETAIL) + '…';
  if (d) d = redact(d);
  const entry: LogEntry = { id: nextId++, t: Date.now(), level, tag, msg: redact(msg), detail: d, session: SESSION_ID };
  entries = entries.length >= MAX_ENTRIES ? [...entries.slice(-(MAX_ENTRIES - 1)), entry] : [...entries, entry];
  notify();
  schedulePersist(level === 'crash' || level === 'error');
}

export const log = {
  debug: (tag: string, msg: string, detail?: unknown) => addLog('debug', tag, msg, detail),
  info: (tag: string, msg: string, detail?: unknown) => addLog('info', tag, msg, detail),
  warn: (tag: string, msg: string, detail?: unknown) => addLog('warn', tag, msg, detail),
  error: (tag: string, msg: string, detail?: unknown) => addLog('error', tag, msg, detail),
  perf: (tag: string, msg: string, detail?: unknown) => addLog('perf', tag, msg, detail),
  crash: (tag: string, msg: string, detail?: unknown) => addLog('crash', tag, msg, detail),
};

export function getLogs(): LogEntry[] {
  return entries;
}

export function subscribeLogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearLogs() {
  entries = [];
  notify();
  schedulePersist(true);
}

/* ------------------------------------------------------------------ */
/* Phát hiện crash: đánh dấu "đang chạy" khi app ở foreground,          */
/* "đã thoát sạch" khi vào background. Lần mở sau mà cờ vẫn là đang chạy */
/* → lần trước app đã bị tắt đột ngột khi đang dùng.                     */
/* ------------------------------------------------------------------ */

interface SessionMark {
  id: string;
  start: number;
  running: boolean;
  lastActive: number;
  /** Bản JS đang chạy (updateId), để phân biệt "khởi động lại do cập nhật" với crash. */
  version?: string;
}

let runningVersion = 'embedded';
/** Gọi khi khởi động (từ app-updates) để ghi bản đang chạy vào dấu phiên. */
export function setRunningVersion(v: string) {
  runningVersion = v;
}

function markSession(running: boolean) {
  // Chưa đọc xong phiên trước thì không ghi đè, kẻo mất dấu hiệu crash
  if (!sessionChecked) return;
  const mark: SessionMark = { id: SESSION_ID, start: startTime, running, lastActive: Date.now(), version: runningVersion };
  AsyncStorage.setItem(SESSION_KEY, JSON.stringify(mark)).catch(() => {});
}

const startTime = Date.now();

async function checkPreviousSession() {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const prev = JSON.parse(raw) as SessionMark;
    if (prev.running && prev.version && prev.version !== runningVersion) {
      // Bản JS đổi giữa 2 lần mở → app tự khởi động lại để chạy bản cập nhật, không phải crash
      log.info('app', 'App đã khởi động lại để chạy bản cập nhật mới');
    } else if (prev.running) {
      const mins = Math.round((prev.lastActive - prev.start) / 60000);
      log.crash(
        'app',
        'Lần mở trước app bị tắt đột ngột khi đang dùng (crash, treo, hoặc iOS tắt vì hết RAM)',
        `Phiên ${prev.id}, đã chạy khoảng ${mins} phút. Xem các log ngay trước dòng này để tìm nguyên nhân.`,
      );
    }
  } catch {
    // bỏ qua
  }
}

/* ------------------------------------------------------------------ */
/* Bắt lỗi toàn cục                                                    */
/* ------------------------------------------------------------------ */

function hookConsole() {
  const origError = console.error;
  const origWarn = console.warn;
  console.error = (...args: unknown[]) => {
    addLog('error', 'console', args.map((a) => (typeof a === 'string' ? a : stringify(a))).join(' ').slice(0, 500));
    origError(...args);
  };
  console.warn = (...args: unknown[]) => {
    addLog('warn', 'console', args.map((a) => (typeof a === 'string' ? a : stringify(a))).join(' ').slice(0, 500));
    origWarn(...args);
  };
}

function hookGlobalErrors() {
  const prev = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    const e = error instanceof Error ? error : new Error(String(error));
    addLog(isFatal ? 'crash' : 'error', 'js', `${isFatal ? 'Lỗi nghiêm trọng' : 'Lỗi JS'}: ${e.message}`, e.stack);
    void persistNow();
    prev(error, isFatal);
  });

  // Promise bị reject mà không ai bắt (Hermes)
  const hermes = (globalThis as { HermesInternal?: { enablePromiseRejectionTracker?: (o: object) => void } })
    .HermesInternal;
  hermes?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_id: number, rejection: unknown) => {
      const e = rejection instanceof Error ? rejection : undefined;
      addLog('error', 'promise', `Promise lỗi không được xử lý: ${e?.message ?? stringify(rejection) ?? '?'}`, e?.stack);
    },
    onHandled: () => {},
  });
}

function hookAppState() {
  let current: AppStateStatus | null | undefined = AppState.currentState as AppStateStatus | null | undefined;
  AppState.addEventListener('change', (next) => {
    if (next === current) return;
    log.debug('app', `Trạng thái app: ${current} → ${next}`);
    current = next;
    if (next === 'active') markSession(true);
    else if (next === 'background') {
      markSession(false);
      schedulePersist(true);
    }
  });
  // iOS gửi khi máy sắp hết RAM: thường là dấu hiệu trước khi bị tắt app
  AppState.addEventListener('memoryWarning', () => {
    log.warn('mem', 'iOS báo sắp hết bộ nhớ (memory warning)', 'Hãy đóng bớt thẻ. Nếu lặp lại nhiều lần, trang đang mở có thể quá nặng.');
  });
}

/** Gọi 1 lần khi app khởi động (ở cấp module của _layout). */
export function initLogging() {
  if (initialized) return;
  initialized = true;

  // Nạp log của các lần mở trước, giữ thứ tự thời gian
  AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (!raw) return;
      // Log cũ (trước bản giữ riêng tư): bỏ dòng hoạt động, xoá link / tên miền
      const saved = (JSON.parse(raw) as LogEntry[])
        .filter((e) => KEEP_LEVELS.has(e.level))
        .map((e) => ({ ...e, msg: redact(e.msg), detail: e.detail ? redact(e.detail) : e.detail }));
      const maxId = saved.reduce((m, e) => Math.max(m, e.id), 0);
      // Đánh lại id cho log mới của phiên này để không trùng
      const fresh = entries.map((e, i) => ({ ...e, id: maxId + 1 + i }));
      entries = [...saved, ...fresh].slice(-MAX_ENTRIES);
      nextId = maxId + fresh.length + 1;
      notify();
    })
    .catch(() => {})
    .finally(() => {
      void checkPreviousSession().then(() => {
        sessionChecked = true;
        if (AppState.currentState === 'active') markSession(true);
      });
    });

  hookConsole();
  hookGlobalErrors();
  hookAppState();
  // Ghi đè ngay bản đã lưu bằng bản đã làm sạch (khỏi còn link cũ trong bộ nhớ máy)
  setTimeout(() => schedulePersist(true), 3000);
}
