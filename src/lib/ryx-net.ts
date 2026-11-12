import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule, type EventSubscription } from 'expo';

import { log } from './logger';

/**
 * DNS riêng của Ryx: proxy nội bộ (module native modules/ryx-net) tự hỏi DNS qua HTTPS.
 * Chỉ có từ bản build 1.0.1; trên bản cũ module không tồn tại → mọi hàm trả về "không hỗ trợ".
 */
export type DnsProvider = 'cloudflare' | 'google';

export interface RyxNetStatus {
  /** Có module native và iOS ≥ 17 */
  supported: boolean;
  enabled: boolean;
  provider: DnsProvider;
  /** Proxy đang chạy */
  running: boolean;
  /** Đã gắn proxy vào trình duyệt */
  applied: boolean;
  port: number;
  resolved: number;
  cacheHits: number;
  dohFailures: number;
  fallbacks: number;
  tunnels: number;
  tunnelFailures: number;
}

interface NativeRyxNet {
  isSupported(): boolean;
  getStatus(): RyxNetStatus;
  setEnabled(enabled: boolean, provider: DnsProvider): void;
  drainLogs(): { level: string; message: string }[];
  clearCache(): void;
  addListener(event: 'onLog', cb: (e: { level: string; message: string }) => void): EventSubscription;
}

const Native = requireOptionalNativeModule<NativeRyxNet>('RyxNet');

const UNSUPPORTED: RyxNetStatus = {
  supported: false,
  enabled: false,
  provider: 'cloudflare',
  running: false,
  applied: false,
  port: 0,
  resolved: 0,
  cacheHits: 0,
  dohFailures: 0,
  fallbacks: 0,
  tunnels: 0,
  tunnelFailures: 0,
};

/** Module native có trong bản build đang cài không. */
export const hasRyxNet = !!Native;

function forward(e: { level: string; message: string }) {
  const level = e.level === 'error' ? 'error' : e.level === 'warn' ? 'warn' : 'info';
  log[level]('dns', e.message);
}

let initialized = false;
/** Gọi khi khởi động: đưa log của proxy (kể cả lúc JS chưa sẵn sàng) vào Nhật ký. */
export function initRyxNet() {
  if (initialized || !Native) return;
  initialized = true;
  try {
    Native.drainLogs().forEach(forward);
    Native.addListener('onLog', (e) => {
      forward(e);
      Native.drainLogs(); // đã nhận qua sự kiện, bỏ bản lưu tạm
    });
  } catch (e) {
    log.error('dns', 'Không kết nối được với module DNS riêng', e);
  }
  void enableByDefaultOnce();
}

const DEFAULT_KEY = 'ryx:dns-default-on:v1';
/** Bản cũ mặc định tắt DNS riêng: bật sẵn (Google) đúng một lần cho máy chưa từng bật. */
async function enableByDefaultOnce() {
  try {
    if (await AsyncStorage.getItem(DEFAULT_KEY)) return;
    await AsyncStorage.setItem(DEFAULT_KEY, '1');
    const st = getRyxNetStatus();
    if (st.supported && !st.enabled) {
      setRyxNetEnabled(true, 'google');
      log.info('dns', 'Bật sẵn DNS riêng (Google) để tránh trang bị nhà mạng chặn');
    }
  } catch {}
}

export function getRyxNetStatus(): RyxNetStatus {
  if (!Native) return UNSUPPORTED;
  try {
    return { ...UNSUPPORTED, ...Native.getStatus() };
  } catch (e) {
    log.error('dns', 'Không đọc được trạng thái DNS riêng', e);
    return UNSUPPORTED;
  }
}

export function setRyxNetEnabled(enabled: boolean, provider: DnsProvider) {
  if (!Native) return;
  try {
    Native.setEnabled(enabled, provider);
    log.info('dns', `${enabled ? 'Bật' : 'Tắt'} DNS riêng (${provider === 'google' ? 'Google' : 'Cloudflare'})`);
  } catch (e) {
    log.error('dns', 'Không đổi được cài đặt DNS riêng', e);
  }
}
