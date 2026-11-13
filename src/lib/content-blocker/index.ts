import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import { File, Paths } from 'expo-file-system';

import { AD_DOMAINS, GAMBLING_DOMAINS, SITE_AD_SELECTORS } from '@/filters';
import { log } from '@/lib/logger';
import { convertFilters, domainBlockRules, siteAllowRules, type WkRule } from './convert';

/**
 * Bộ lọc quảng cáo tầng mạng (Content Blocking của WebKit), giống cách Brave chặn trên iOS.
 * - Bộ lọc gốc: EasyList (kể cả phần trang người lớn) + ABPVN (trang Việt), tải từ GitHub, 3 ngày cập nhật 1 lần.
 * - Bộ lọc riêng của Ryx: tên miền quảng cáo/cờ bạc + luật theo trang (src/filters).
 * - Trang nào tắt "Quảng cáo thường" trong Shield thì thêm luật cho phép ở cuối danh sách.
 * Cần bản build có module native mới (1.0.2+); bản cũ thì mọi hàm không làm gì.
 */

interface NativeBlocker {
  compileRules(id: string, json: string): Promise<string | null>;
  setActiveRules(ids: string[]): Promise<number>;
  attachRules(): Promise<number>;
  removeRules(ids: string[]): Promise<void>;
  listRules(): Promise<string[]>;
}

const Native = requireOptionalNativeModule<Partial<NativeBlocker>>('RyxNet');
export const hasContentBlocker = !!Native && typeof Native.compileRules === 'function';
const N = Native as NativeBlocker;

const RAW = 'https://raw.githubusercontent.com';
const EL = `${RAW}/easylist/easylist/master`;
/** Nguồn bộ lọc. `required` lỗi thì không cập nhật (giữ bộ cũ). */
const SOURCES: { name: string; url: string; required?: boolean }[] = [
  { name: 'EasyList: máy chủ quảng cáo', url: `${EL}/easylist/easylist_adservers.txt`, required: true },
  { name: 'EasyList: pop-up', url: `${EL}/easylist/easylist_adservers_popup.txt` },
  { name: 'EasyList: mẫu chung', url: `${EL}/easylist/easylist_general_block.txt` },
  { name: 'EasyList: kích thước', url: `${EL}/easylist/easylist_general_block_dimensions.txt` },
  { name: 'EasyList: theo trang', url: `${EL}/easylist/easylist_specific_block.txt` },
  { name: 'EasyList: pop-up theo trang', url: `${EL}/easylist/easylist_specific_block_popup.txt` },
  { name: 'EasyList: bên thứ ba', url: `${EL}/easylist/easylist_thirdparty.txt` },
  { name: 'EasyList: ẩn chung', url: `${EL}/easylist/easylist_general_hide.txt` },
  { name: 'EasyList: ẩn theo trang', url: `${EL}/easylist/easylist_specific_hide.txt` },
  { name: 'EasyList: ngoại lệ', url: `${EL}/easylist/easylist_allowlist.txt` },
  { name: 'EasyList 18+: máy chủ', url: `${EL}/easylist_adult/adult_adservers.txt` },
  { name: 'EasyList 18+: pop-up', url: `${EL}/easylist_adult/adult_adservers_popup.txt` },
  { name: 'EasyList 18+: theo trang', url: `${EL}/easylist_adult/adult_specific_block.txt` },
  { name: 'EasyList 18+: pop-up theo trang', url: `${EL}/easylist_adult/adult_specific_block_popup.txt` },
  { name: 'EasyList 18+: bên thứ ba', url: `${EL}/easylist_adult/adult_thirdparty.txt` },
  { name: 'EasyList 18+: pop-up bên thứ ba', url: `${EL}/easylist_adult/adult_thirdparty_popup.txt` },
  { name: 'EasyList 18+: ẩn theo trang', url: `${EL}/easylist_adult/adult_specific_hide.txt` },
  { name: 'EasyList 18+: ngoại lệ', url: `${EL}/easylist_adult/adult_allowlist.txt` },
  // Bảng hỏi cookie (EasyList Cookie List, CC BY 3.0): che/chặn những bảng mà autoconsent chưa tự từ chối được
  { name: 'Cookie: chặn chung', url: `${EL}/easylist_cookie/easylist_cookie_general_block.txt` },
  { name: 'Cookie: ẩn chung', url: `${EL}/easylist_cookie/easylist_cookie_general_hide.txt` },
  { name: 'Cookie: chặn theo trang', url: `${EL}/easylist_cookie/easylist_cookie_specific_block.txt` },
  { name: 'Cookie: ẩn theo trang', url: `${EL}/easylist_cookie/easylist_cookie_specific_hide.txt` },
  { name: 'Cookie: quốc tế (chặn)', url: `${EL}/easylist_cookie/easylist_cookie_international_specific_block.txt` },
  { name: 'Cookie: quốc tế (ẩn)', url: `${EL}/easylist_cookie/easylist_cookie_international_specific_hide.txt` },
  { name: 'Cookie: bên thứ ba', url: `${EL}/easylist_cookie/easylist_cookie_thirdparty.txt` },
  { name: 'Cookie: ngoại lệ', url: `${EL}/easylist_cookie/easylist_cookie_allowlist.txt` },
  { name: 'Cookie: ngoại lệ ẩn', url: `${EL}/easylist_cookie/easylist_cookie_allowlist_general_hide.txt` },
  { name: 'ABPVN (trang Việt)', url: `${RAW}/abpvn/abpvn/master/filter/abpvn.txt` },
];

const STATE_KEY = 'ryx:content-blocker:v1';
const CACHE_FILE = 'ryx-filters-v1.json';
const REFRESH_EVERY_MS = 3 * 24 * 3600 * 1000;
/** Bộ lọc gốc lỗi biên dịch thì chia nhỏ tới cỡ này; nhỏ hơn mà vẫn lỗi thì bỏ phần đó. */
const MIN_CHUNK = 200;

interface State {
  /** Lần tải bộ lọc gần nhất (ms) */
  updatedAt: number;
  /** Tăng mỗi lần tải bộ lọc mới */
  version: number;
  ruleCount: number;
  /** Các danh sách đang biên dịch sẵn trong WebKit */
  activeIds: string[];
  /** Khoá của cấu hình đã biên dịch (để khỏi biên dịch lại khi không đổi gì) */
  compiledKey: string;
}

export interface BlockerConfig {
  ads: boolean;
  gambling: boolean;
  /** Trang tắt chặn quảng cáo trong Shield */
  allowSites: string[];
}

export interface BlockerStatus {
  supported: boolean;
  updatedAt: number;
  ruleCount: number;
  active: number;
  busy: boolean;
}

let state: State = { updatedAt: 0, version: 0, ruleCount: 0, activeIds: [], compiledKey: '' };
let loaded = false;
let busy = false;
let lastConfig: BlockerConfig | null = null;
let chain: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

function snapshot(): BlockerStatus {
  return {
    supported: hasContentBlocker,
    updatedAt: state.updatedAt,
    ruleCount: state.ruleCount,
    active: state.activeIds.length,
    busy,
  };
}
let current: BlockerStatus = snapshot();
function emit() {
  current = snapshot();
  listeners.forEach((l) => l());
}
export function subscribeContentBlocker(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
/** Ảnh chụp trạng thái (giữ nguyên object giữa các lần đổi, dùng được với useSyncExternalStore). */
export function getContentBlockerStatus(): BlockerStatus {
  return current;
}

/** Chạy lần lượt từng việc (biên dịch WebKit không nên chạy chồng lên nhau). */
function serial<T>(job: () => Promise<T>): Promise<T> {
  const next = chain.then(job, job);
  chain = next.catch(() => {});
  return next;
}

async function loadState() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    if (raw) state = { ...state, ...(JSON.parse(raw) as Partial<State>) };
  } catch {}
  emit();
}
async function saveState() {
  try {
    await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {}
}

interface Cached {
  main: WkRule[];
  allow: WkRule[];
}

async function readCache(): Promise<Cached | null> {
  try {
    const f = new File(Paths.document, CACHE_FILE);
    if (!f.exists) return null;
    return JSON.parse(await f.text()) as Cached;
  } catch (e) {
    log.warn('shield', 'Không đọc được bộ lọc đã lưu', e);
    return null;
  }
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Luật riêng của Ryx (luôn nhỏ, có sẵn ngay cả khi chưa tải được EasyList). */
function ryxRules(cfg: BlockerConfig): WkRule[] {
  const domains = [...(cfg.ads ? AD_DOMAINS : []), ...(cfg.gambling ? GAMBLING_DOMAINS : [])];
  const rules: WkRule[] = domainBlockRules(domains);
  if (cfg.ads) {
    for (const [site, sels] of Object.entries(SITE_AD_SELECTORS)) {
      rules.push({
        trigger: { 'url-filter': '.*', 'if-domain': [`*${site}`] },
        action: { type: 'css-display-none', selector: sels.join(', ') },
      });
    }
  }
  return rules;
}

/** Biên dịch; lỗi thì chia đôi dần để bỏ đúng phần luật hỏng. Trả các id biên dịch được. */
async function compileSplit(id: string, main: WkRule[], tail: WkRule[], dropped: { n: number }): Promise<string[]> {
  if (!main.length) return [];
  const err = await N.compileRules(id, JSON.stringify([...main, ...tail]));
  if (!err) return [id];
  if (main.length <= MIN_CHUNK) {
    dropped.n += main.length;
    log.warn('shield', `Bỏ ${main.length} luật lỗi trong bộ lọc`, err);
    return [];
  }
  const half = Math.ceil(main.length / 2);
  const a = await compileSplit(`${id}a`, main.slice(0, half), tail, dropped);
  const b = await compileSplit(`${id}b`, main.slice(half), tail, dropped);
  return [...a, ...b];
}

async function applyNow(cfg: BlockerConfig, force = false): Promise<void> {
  if (!hasContentBlocker) return;
  await loadState();
  const sites = [...cfg.allowSites].sort();
  let allow = siteAllowRules(sites);
  const key = `${state.version}|${cfg.ads}|${cfg.gambling}|${hash(JSON.stringify(sites))}|${hash(JSON.stringify(ryxRules(cfg)))}`;
  if (!force && key === state.compiledKey && state.activeIds.length) {
    await N.setActiveRules(state.activeIds);
    return;
  }

  busy = true;
  emit();
  const started = Date.now();
  try {
    const ids: string[] = [];
    const dropped = { n: 0 };
    const tag = hash(key);
    // Luật cho phép theo trang lỗi thì mọi phần sau đều lỗi theo: thử riêng trước
    if (allow.length) {
      const err = await N.compileRules(`ryx-test-${tag}`, JSON.stringify(allow));
      await N.removeRules([`ryx-test-${tag}`]);
      if (err) {
        log.warn('shield', 'Bỏ luật cho phép theo trang vì lỗi', err);
        allow = [];
      }
    }
    const own = ryxRules(cfg);
    if (own.length) ids.push(...(await compileSplit(`ryx-own-${tag}`, own, allow, dropped)));

    if (cfg.ads) {
      const cached = await readCache();
      if (cached?.main.length) {
        ids.push(...(await compileSplit(`ryx-list-${tag}`, cached.main, [...cached.allow, ...allow], dropped)));
      } else log.info('shield', 'Chưa có bộ lọc EasyList/ABPVN trên máy, chỉ bật bộ lọc riêng của Ryx');
    } else log.info('shield', '"Quảng cáo thường" đang tắt nên không bật EasyList/ABPVN');

    const n = await N.setActiveRules(ids);
    const old = state.activeIds.filter((x) => !ids.includes(x));
    state = { ...state, activeIds: ids, compiledKey: key };
    await saveState();
    if (old.length) await N.removeRules(old);
    log.info(
      'shield',
      `Bộ lọc tầng mạng đã bật: ${n} danh sách, ${((Date.now() - started) / 1000).toFixed(1)} s` +
        (dropped.n ? ` (bỏ ${dropped.n} luật lỗi)` : ''),
    );
  } catch (e) {
    log.error('shield', 'Bật bộ lọc tầng mạng thất bại', e);
  } finally {
    busy = false;
    emit();
  }
}

async function download(): Promise<boolean> {
  const started = Date.now();
  const texts = await Promise.all(
    SOURCES.map(async (s) => {
      try {
        const res = await fetch(s.url, { headers: { 'Cache-Control': 'no-cache' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
      } catch (e) {
        log.warn('shield', `Không tải được bộ lọc ${s.name}`, `${s.url}\n${String(e)}`);
        return s.required ? null : '';
      }
    }),
  );
  if (texts.some((t) => t === null)) return false;
  const { rules, stats } = await convertFilters(texts.join('\n'));
  const main = rules.filter((r) => r.action.type !== 'ignore-previous-rules');
  const allow = rules.filter((r) => r.action.type === 'ignore-previous-rules');
  const f = new File(Paths.document, CACHE_FILE);
  await f.write(JSON.stringify({ main, allow } satisfies Cached));
  state = { ...state, updatedAt: Date.now(), version: state.version + 1, ruleCount: rules.length };
  await saveState();
  log.info(
    'shield',
    `Đã tải bộ lọc mới: ${rules.length} luật (chặn ${stats.block}, ẩn ${stats.hide}, ngoại lệ ${stats.allow}, bỏ qua ${stats.skipped}) trong ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
  return true;
}

/** Áp cấu hình Shield hiện tại (gọi khi khởi động và mỗi khi đổi tuỳ chọn). */
export function configureContentBlocker(cfg: BlockerConfig): Promise<void> {
  lastConfig = cfg;
  return serial(() => applyNow(cfg));
}

/** Tải bộ lọc mới nếu đã cũ (hoặc `force`), rồi biên dịch lại. */
export function refreshContentBlocker(force = false): Promise<void> {
  return serial(async () => {
    if (!hasContentBlocker) return;
    await loadState();
    if (!force && Date.now() - state.updatedAt < REFRESH_EVERY_MS) return;
    busy = true;
    emit();
    try {
      const ok = await download();
      if (ok && lastConfig) await applyNow(lastConfig, true);
    } catch (e) {
      log.error('shield', 'Cập nhật bộ lọc thất bại', e);
    } finally {
      busy = false;
      emit();
    }
  });
}

/** Gắn bộ lọc vào WebView vừa tạo (thẻ mới). */
export function attachContentBlocker(): void {
  if (!hasContentBlocker) return;
  N.attachRules().catch(() => {});
}
