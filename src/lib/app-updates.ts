import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { AppState } from 'react-native';

import { log } from './logger';

/**
 * Cập nhật qua mạng (EAS Update).
 * - Khi mở app: expo-updates tự kiểm tra (checkAutomatically = ON_LOAD trong app.json).
 * - Khi quay lại app từ nền (cách lần kiểm tra trước ≥ 30 phút): kiểm tra & tải bản mới.
 * - Bản mới tải xong sẽ chạy ở lần mở app sau, hoặc ngay khi người dùng bấm "Khởi động lại".
 * - Ghi trạng thái/lỗi cập nhật vào Nhật ký.
 */

const RECHECK_MS = 30 * 60 * 1000;
const NATIVE_LOG_KEY = 'ryx:updates-log-imported:v1';

let lastCheck = Date.now();
let initialized = false;

export function shortId(id: string | null | undefined) {
  return id ? id.slice(0, 8) : 'bản gốc';
}

/** Dòng mô tả bản đang chạy, dùng cho Nhật ký và khi xuất log. */
export function runningVersionLabel(): string {
  if (!Updates.isEnabled) return 'Cập nhật qua mạng: tắt (bản dev)';
  const src = Updates.isEmbeddedLaunch ? 'bản gốc trong app' : `bản cập nhật ${shortId(Updates.updateId)}`;
  return `Đang chạy ${src} · kênh ${Updates.channel ?? '?'} · runtime ${Updates.runtimeVersion ?? '?'}`;
}

async function importNativeErrors() {
  try {
    const since = Number((await AsyncStorage.getItem(NATIVE_LOG_KEY)) ?? 0);
    const entries = await Updates.readLogEntriesAsync(24 * 60 * 60 * 1000);
    let newest = since;
    for (const e of entries) {
      if (e.timestamp <= since) continue;
      newest = Math.max(newest, e.timestamp);
      if (e.level === 'error' || e.level === 'fatal') {
        log.error('update', `expo-updates: ${e.message}`, e.stacktrace?.join('\n'));
      } else if (e.level === 'warn') {
        log.warn('update', `expo-updates: ${e.message}`);
      }
    }
    if (newest > since) await AsyncStorage.setItem(NATIVE_LOG_KEY, String(newest));
  } catch {
    // bỏ qua: không đọc được log native thì thôi
  }
}

export async function checkAndFetch(reason: string) {
  if (!Updates.isEnabled) return;
  lastCheck = Date.now();
  try {
    const res = await Updates.checkForUpdateAsync();
    if (!res.isAvailable) {
      log.debug('update', `Không có bản mới (${reason})`);
      return;
    }
    log.info('update', 'Có bản mới, đang tải…');
    const fetched = await Updates.fetchUpdateAsync();
    if (fetched.isNew) log.info('update', 'Đã tải xong bản mới. Sẽ chạy ở lần mở app sau, hoặc bấm "Khởi động lại".');
  } catch (e) {
    log.warn('update', 'Không kiểm tra được bản cập nhật (mất mạng?)', e);
  }
}

export function initUpdates() {
  if (initialized) return;
  initialized = true;

  if (!Updates.isEnabled) {
    log.debug('update', runningVersionLabel());
    return;
  }
  log.info('update', runningVersionLabel());
  if (Updates.isEmergencyLaunch) {
    log.crash(
      'update',
      'Bản cập nhật mới bị lỗi khi khởi động nên app đã tự quay về bản trước',
      Updates.emergencyLaunchReason ?? undefined,
    );
  }
  void importNativeErrors();

  AppState.addEventListener('change', (s) => {
    if (s === 'active' && Date.now() - lastCheck >= RECHECK_MS) void checkAndFetch('quay lại app');
  });
}

export async function restartToApply() {
  log.info('update', 'Khởi động lại để chạy bản mới');
  try {
    await Updates.reloadAsync();
  } catch (e) {
    log.error('update', 'Không khởi động lại được', e);
  }
}
