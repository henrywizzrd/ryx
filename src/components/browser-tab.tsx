import { memo, useCallback, useEffect, useRef } from 'react';
import { Linking, StyleSheet } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewMessageEvent,
  WebViewNavigation,
  WebViewOpenWindowEvent,
} from 'react-native-webview/lib/WebViewTypes';

import { shouldBlock, type BlockCategory } from '@/lib/blocker';
import { buildUpdateCall, type InjectConfig } from '@/lib/inject';
import { PageError } from '@/components/page-error';
import { log } from '@/lib/logger';
import { getHost, siteKey } from '@/lib/url';
import { useHistoryActions } from '@/state/history';
import { setSiteTheme } from '@/state/site-themes';
import type { ShieldPrefs } from '@/state/settings';
import { EMPTY_COUNTS, type Counts } from '@/state/stats';
import { useTabs, type Tab } from '@/state/tabs';
import { colors } from '@/theme';

/** Kiểu của react-native-webview mặc định P=undefined → props thành never; cố định P=object. */
const WebView = RNWebView<object>;
export type WebViewHandle = RNWebView<object>;

const EXTERNAL_SCHEMES = /^(tel|mailto|sms|facetime|maps):/i;
const INTERNAL_SCHEMES = /^(https?|about|data|blob|file):/i;
/** Trang tải lâu hơn ngưỡng này thì ghi log hiệu năng. */
const SLOW_LOAD_MS = 8000;

interface Props {
  tab: Tab;
  visible: boolean;
  script: string;
  injectConfig: InjectConfig;
  prefsFor: (site: string) => ShieldPrefs;
  record: (delta: Partial<Counts>) => void;
  onOpenInNewTab: (url: string) => void;
  insetBottom: number;
}


function BrowserTabImpl({
  tab,
  visible,
  script,
  injectConfig,
  prefsFor,
  record,
  onOpenInNewTab,
  insetBottom,
}: Props) {
  const { patchTab, refs } = useTabs();
  const { record: recordHistory } = useHistoryActions();
  const ref = useRef<WebViewHandle>(null);
  const lastPageCounts = useRef<Counts>({ ...EMPTY_COUNTS });
  const urlRef = useRef(tab.url);
  const loadStartedAt = useRef(0);
  /** Link trang chính đang được mở (để log và trang lỗi hiện đúng địa chỉ bị lỗi). */
  const lastTarget = useRef<string | null>(tab.sourceUrl ?? null);
  const loadFailed = useRef(false);
  const lastProgress = useRef(0);

  useEffect(() => {
    urlRef.current = tab.url;
  }, [tab.url]);

  // Không bọc useCallback: React Compiler tự ghi nhớ hàm này
  const setRef = (r: WebViewHandle | null) => {
    ref.current = r;
    if (r) refs.current.set(tab.id, r);
    else refs.current.delete(tab.id);
  };

  // Áp dụng ngay thay đổi tuỳ chọn Shield / chế độ tối cho trang đang mở
  useEffect(() => {
    ref.current?.injectJavaScript(buildUpdateCall(injectConfig));
  }, [injectConfig]);

  const countBlocked = useCallback(
    (cat: BlockCategory) => {
      patchTab(tab.id, (t) => ({ navCounts: { ...t.navCounts, [cat]: t.navCounts[cat] + 1 } }));
      record({ [cat]: 1 });
    },
    [patchTab, record, tab.id],
  );

  const onShouldStart = useCallback(
    (req: ShouldStartLoadRequest) => {
      const { url, isTopFrame } = req;
      if (isTopFrame) {
        lastTarget.current = url;
        log.debug('nav', `Mở ${getHost(url) || url}`, `${url}\nKiểu: ${req.navigationType ?? '?'}`);
      }
      if (EXTERNAL_SCHEMES.test(url)) {
        Linking.openURL(url).catch(() => {});
        return false;
      }
      const prefs = prefsFor(siteKey(urlRef.current ?? url));
      if (!INTERNAL_SCHEMES.test(url)) {
        // Lược đồ lạ (thường là chuyển hướng mở ứng dụng từ quảng cáo)
        if (prefs.popups && isTopFrame) {
          countBlocked('popups');
          return false;
        }
        return true;
      }
      const cat = shouldBlock(url, isTopFrame, prefs);
      if (cat) {
        log.debug('block', `Chặn ${cat}: ${getHost(url)}`, url);
        countBlocked(cat);
        return false;
      }
      return true;
    },
    [prefsFor, countBlocked],
  );

  const onOpenWindow = useCallback(
    (e: WebViewOpenWindowEvent) => {
      const url = e.nativeEvent.targetUrl;
      const cat = shouldBlock(url, true, prefsFor(siteKey(urlRef.current)));
      if (cat) {
        countBlocked(cat === 'ads' ? 'popups' : cat);
        return;
      }
      onOpenInNewTab(url);
    },
    [prefsFor, countBlocked, onOpenInNewTab],
  );

  const onLoadStart = useCallback(
    (e: { nativeEvent: WebViewNavigation }) => {
      // Mỗi lần trang chính bắt đầu tải là một trang mới → đếm lại từ đầu
      lastPageCounts.current = { ...EMPTY_COUNTS };
      loadStartedAt.current = Date.now();
      loadFailed.current = false;
      lastProgress.current = 0.05;
      patchTab(tab.id, {
        url: e.nativeEvent.url,
        loading: true,
        progress: 0.05,
        navCounts: { ...EMPTY_COUNTS },
        pageCounts: { ...EMPTY_COUNTS },
      });
    },
    [patchTab, tab.id],
  );

  const onNavChange = useCallback(
    (nav: WebViewNavigation) => {
      patchTab(tab.id, {
        url: nav.url,
        title: nav.title || '',
        canGoBack: nav.canGoBack,
        canGoForward: nav.canGoForward,
        loading: nav.loading,
      });
      // Ghi lịch sử khi trang tải xong (kể cả đổi URL trong trang kiểu SPA)
      if (!nav.loading && nav.url) recordHistory(nav.url, nav.title || '');
    },
    [patchTab, recordHistory, tab.id],
  );

  // Chỉ cập nhật thanh tiến trình khi tăng ≥ 10% (mỗi lần cập nhật làm cả giao diện tính toán lại)
  const onLoadProgress = useCallback(
    (e: { nativeEvent: { progress: number } }) => {
      const p = e.nativeEvent.progress;
      if (lastProgress.current >= 1) return;
      if (p - lastProgress.current < 0.1 && p < 1) return;
      lastProgress.current = p;
      patchTab(tab.id, { progress: p });
    },
    [patchTab, tab.id],
  );

  const onLoadEnd = useCallback(() => {
    patchTab(tab.id, { loading: false, progress: 1 });
    if (!loadStartedAt.current) return;
    if (loadFailed.current) {
      loadStartedAt.current = 0;
      return;
    }
    const ms = Date.now() - loadStartedAt.current;
    loadStartedAt.current = 0;
    const host = getHost(urlRef.current ?? '');
    if (ms >= SLOW_LOAD_MS) log.perf('web', `Trang ${host} tải chậm: ${(ms / 1000).toFixed(1)} s`, urlRef.current);
    else log.debug('web', `Tải xong ${host} trong ${(ms / 1000).toFixed(1)} s`);
  }, [patchTab, tab.id]);

  const onError = useCallback((e: WebViewErrorEvent) => {
    const { code, description, url } = e.nativeEvent;
    // -999 = điều hướng bị huỷ (người dùng bấm link khác/bị chặn): không phải lỗi thật
    if (code === -999) return;
    loadFailed.current = true;
    const target = lastTarget.current ?? url;
    log.error('web', `Không tải được ${getHost(target) || 'trang'}: ${description}`, `${target}\nMã lỗi: ${code}\nTrang trước: ${url}`);
  }, []);

  const renderError = useCallback(
    (_domain: string | undefined, code: number, desc: string) => (
      <PageError
        url={lastTarget.current}
        code={code}
        description={desc}
        onRetry={() => {
          const target = lastTarget.current;
          if (target) ref.current?.injectJavaScript(`window.location.href = ${JSON.stringify(target)}; true;`);
          else ref.current?.reload();
        }}
      />
    ),
    [],
  );

  const onHttpError = useCallback((e: WebViewHttpErrorEvent) => {
    const { statusCode, url } = e.nativeEvent;
    log.warn('net', `HTTP ${statusCode} từ ${getHost(url)}`, url);
  }, []);

  const onProcessTerminated = useCallback(() => {
    log.crash(
      'web',
      'iOS đã tắt tiến trình WebKit của thẻ (thường do trang tốn quá nhiều RAM). Đã tự tải lại.',
      urlRef.current,
    );
    ref.current?.reload();
  }, []);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let msg: {
        type?: string;
        counts?: Counts;
        msg?: string;
        detail?: string;
        url?: string;
        host?: string;
        dark?: boolean;
        ms?: number;
        kind?: string;
        src?: string;
      };
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'ryx:ready') {
        // Nội dung trang đã hiện & dùng được: cho thanh tiến trình xong luôn, không đợi quảng cáo/ảnh tải hết
        lastProgress.current = 1;
        patchTab(tab.id, { loading: false, progress: 1 });
        return;
      }
      if (msg.type === 'ryx:video') {
        const s = ((msg.ms ?? 0) / 1000).toFixed(1);
        const what = msg.kind === 'waiting' ? 'bị khựng' : 'chờ tải';
        log.perf('video', `Video ở ${msg.host || 'trang'} ${what} ${s} s mới phát`, msg.src || undefined);
        return;
      }
      if (msg.type === 'ryx:theme') {
        if (msg.host) setSiteTheme(msg.host, !!msg.dark);
        return;
      }
      if (msg.type === 'ryx:log') {
        log.error('inject', msg.msg ?? 'Lỗi trong script của trang', `${msg.url ?? ''}\n${msg.detail ?? ''}`.trim());
        return;
      }
      if (msg.type !== 'ryx:counts' || !msg.counts) return;
      const prev = lastPageCounts.current;
      const next = msg.counts;
      const delta = {
        ads: Math.max(0, next.ads - prev.ads),
        gambling: Math.max(0, next.gambling - prev.gambling),
        popups: Math.max(0, next.popups - prev.popups),
      };
      lastPageCounts.current = next;
      if (delta.ads || delta.gambling || delta.popups) record(delta);
      patchTab(tab.id, { pageCounts: next });
    },
    [patchTab, record, tab.id],
  );

  if (!tab.sourceUrl) return null;

  return (
    <WebView
      ref={setRef}
      source={{ uri: tab.sourceUrl }}
      style={styles.web}
      containerStyle={[StyleSheet.absoluteFill, { display: visible ? 'flex' : 'none' }]}
      injectedJavaScriptBeforeContentLoaded={script}
      onShouldStartLoadWithRequest={onShouldStart}
      onOpenWindow={onOpenWindow}
      onLoadStart={onLoadStart}
      onNavigationStateChange={onNavChange}
      onLoadProgress={onLoadProgress}
      onLoadEnd={onLoadEnd}
      onError={onError}
      renderError={renderError}
      onHttpError={onHttpError}
      onMessage={onMessage}
      onContentProcessDidTerminate={onProcessTerminated}
      allowsBackForwardNavigationGestures
      allowsInlineMediaPlayback
      pullToRefreshEnabled
      sharedCookiesEnabled
      setSupportMultipleWindows
      decelerationRate="normal"
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      contentInset={{ top: 0, bottom: insetBottom }}
      contentMode="mobile"
      keyboardDisplayRequiresUserAction={false}
    />
  );
}

export const BrowserTab = memo(BrowserTabImpl);

const styles = StyleSheet.create({
  web: { backgroundColor: colors.bg },
});
