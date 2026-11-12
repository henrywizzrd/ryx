import { memo, useCallback, useEffect, useRef } from 'react';
import { Linking, StyleSheet, View, type HostInstance } from 'react-native';
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
import { describeDiag, FRAME_DIAG_SCRIPT } from '@/lib/frame-diag';
import { log } from '@/lib/logger';
import { captureTab, registerShotTarget } from '@/lib/tab-shots';
import { getHost, registrableDomain, siteKey } from '@/lib/url';
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
const ALL_ORIGINS = ['*'];
/** Chuyển trang "tự động" xảy ra trong khoảng này sau cú bấm được coi là quảng cáo mở kèm (đo được ~50 ms). */
const POPUNDER_WINDOW_MS = 250;
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
  /** Đã chặn một cửa sổ bật lên (để app hiện thông báo kèm nút "Vẫn mở"). */
  onPopupBlocked: (url: string) => void;
  /** Nhấn giữ ảnh/video trong trang. */
  onMediaLongPress: (m: MediaPress) => void;
  /** Bật script chẩn đoán video (Tuỳ chỉnh → Nâng cao). */
  diag: boolean;
  insetBottom: number;
}

export interface MediaPress {
  kind: 'image' | 'video';
  src: string;
  poster: string;
  link: string;
  pageUrl: string;
}


function BrowserTabImpl({
  tab,
  visible,
  script,
  injectConfig,
  prefsFor,
  record,
  onOpenInNewTab,
  onPopupBlocked,
  onMediaLongPress,
  diag,
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
  /** URL do chính Ryx yêu cầu mở (gõ địa chỉ, lịch sử…) → luôn cho qua. */
  const sourceRef = useRef(tab.sourceUrl);
  /** Trang đã hiện xong: từ lúc này trang tự chuyển sang site khác mà không phải bấm link là đáng ngờ. */
  const pageReady = useRef(false);
  /** Lần bấm link gần nhất (quảng cáo popunder hay chuyển tab sang trang khác cùng lúc với cú bấm). */
  const lastClick = useRef({ at: 0, url: '' });
  const loadFailed = useRef(false);
  const lastProgress = useRef(0);
  const shotRef = useRef<HostInstance>(null);
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);
  const shotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Hẹn giờ phát hiện trang "treo": đã cho mở mà mãi không thấy tiến triển. */
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navStartedAt = useRef(0);
  const halfLogged = useRef(false);
  const stopWatch = useCallback(() => {
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = null;
  }, []);
  const startWatch = useCallback((stage: string, url: string, ms: number) => {
    stopWatch();
    watchdog.current = setTimeout(() => {
      const host = getHost(url) || url;
      log.warn(
        'nav',
        `${host}: ${stage} sau ${Math.round(ms / 1000)} giây vẫn chưa xong`,
        `${url}\nThường do nhà mạng chặn (kết nối bị treo) hoặc máy chủ trang quá chậm. Tiến độ hiện tại: ${Math.round(lastProgress.current * 100)}%`,
      );
    }, ms);
  }, [stopWatch]);
  useEffect(() => stopWatch, [stopWatch]);

  useEffect(
    () =>
      registerShotTarget(tab.id, {
        ref: shotRef,
        isVisible: () => visibleRef.current,
        onShot: (uri) => patchTab(tab.id, { thumb: uri }),
      }),
    [tab.id, patchTab],
  );
  useEffect(
    () => () => {
      if (shotTimer.current) clearTimeout(shotTimer.current);
    },
    [],
  );

  useEffect(() => {
    urlRef.current = tab.url;
  }, [tab.url]);
  useEffect(() => {
    sourceRef.current = tab.sourceUrl;
  }, [tab.sourceUrl]);

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
        navStartedAt.current = Date.now();
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
      // Quảng cáo popunder: cùng lúc cậu bấm link, script mở thêm một trang khác site để cướp tab
      if (isTopFrame && req.navigationType === 'click') lastClick.current = { at: Date.now(), url };
      if (
        isTopFrame &&
        prefs.popups &&
        req.navigationType === 'other' &&
        url !== sourceRef.current &&
        Date.now() - lastClick.current.at < POPUNDER_WINDOW_MS
      ) {
        const to = registrableDomain(getHost(url));
        const clicked = registrableDomain(getHost(lastClick.current.url));
        const here = registrableDomain(getHost(urlRef.current));
        if (to && to !== clicked && to !== here) {
          log.info('block', `Chặn quảng cáo mở kèm khi bấm: ${getHost(url)}`, `${url}\nĐã bấm: ${lastClick.current.url}`);
          countBlocked('popups');
          return false;
        }
      }
      // Quảng cáo cướp tab: trang đã hiện xong rồi tự chuyển (không phải bấm link) sang một site khác
      if (
        isTopFrame &&
        prefs.popups &&
        pageReady.current &&
        req.navigationType === 'other' &&
        url !== sourceRef.current
      ) {
        const from = registrableDomain(getHost(urlRef.current));
        const to = registrableDomain(getHost(url));
        if (from && to && from !== to) {
          log.info('block', `Chặn trang tự chuyển sang ${getHost(url)}`, `${url}\nĐang ở: ${urlRef.current ?? ''}`);
          countBlocked('popups');
          return false;
        }
      }
      const cat = shouldBlock(url, isTopFrame, prefs);
      if (cat) {
        log.debug('block', `Chặn ${cat}: ${getHost(url)}`, url);
        countBlocked(cat);
        return false;
      }
      if (isTopFrame) startWatch('chưa bắt đầu kết nối', url, 10000);
      return true;
    },
    [prefsFor, countBlocked, startWatch],
  );

  const onOpenWindow = useCallback(
    (e: WebViewOpenWindowEvent) => {
      const url = e.nativeEvent.targetUrl;
      const prefs = prefsFor(siteKey(urlRef.current));
      const cat = shouldBlock(url, true, prefs);
      if (cat) {
        log.debug('block', `Chặn cửa sổ bật lên (${cat}): ${getHost(url)}`, url);
        countBlocked(cat === 'ads' ? 'popups' : cat);
        return;
      }
      if (prefs.popups) {
        // Mánh "tab-under": mở lại chính trang đang xem/vừa bấm sang thẻ mới, rồi đổi thẻ cũ thành quảng cáo
        const clicked = lastClick.current;
        if (url === urlRef.current || (Date.now() - clicked.at < 1500 && url === clicked.url)) {
          log.info('block', `Chặn mở trùng trang sang thẻ mới: ${getHost(url)}`, url);
          countBlocked('popups');
          return;
        }
        // Cửa sổ sang site khác: chặn, hỏi lại cậu bằng thông báo "Vẫn mở"
        const here = registrableDomain(getHost(urlRef.current));
        const to = registrableDomain(getHost(url));
        if (!to || to !== here) {
          log.info('block', `Chặn cửa sổ bật lên sang ${getHost(url) || url}`, `${url}\nĐang ở: ${urlRef.current ?? ''}`);
          countBlocked('popups');
          onPopupBlocked(url);
          return;
        }
      }
      onOpenInNewTab(url);
    },
    [prefsFor, countBlocked, onOpenInNewTab, onPopupBlocked],
  );

  const onLoadStart = useCallback(
    (e: { nativeEvent: WebViewNavigation }) => {
      // Mỗi lần trang chính bắt đầu tải là một trang mới → đếm lại từ đầu
      lastPageCounts.current = { ...EMPTY_COUNTS };
      pageReady.current = false;
      loadStartedAt.current = Date.now();
      loadFailed.current = false;
      lastProgress.current = 0.05;
      halfLogged.current = false;
      const since = navStartedAt.current ? ` (${((Date.now() - navStartedAt.current) / 1000).toFixed(1)} s sau khi bấm)` : '';
      log.debug('web', `Bắt đầu tải ${getHost(e.nativeEvent.url) || e.nativeEvent.url}${since}`);
      startWatch('đang kết nối / tải', e.nativeEvent.url, 15000);
      patchTab(tab.id, {
        url: e.nativeEvent.url,
        loading: true,
        progress: 0.05,
        navCounts: { ...EMPTY_COUNTS },
        pageCounts: { ...EMPTY_COUNTS },
      });
    },
    [patchTab, tab.id, startWatch],
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
      if (p >= 0.5 && !halfLogged.current && loadStartedAt.current) {
        halfLogged.current = true;
        log.debug('web', `Tải được ${Math.round(p * 100)}% sau ${((Date.now() - loadStartedAt.current) / 1000).toFixed(1)} s`);
      }
      patchTab(tab.id, { progress: p });
    },
    [patchTab, tab.id],
  );

  const onLoadEnd = useCallback((e: { nativeEvent: { canGoBack?: boolean; canGoForward?: boolean } }) => {
    stopWatch();
    const n = e?.nativeEvent;
    patchTab(tab.id, {
      loading: false,
      progress: 1,
      ...(typeof n?.canGoBack === 'boolean' ? { canGoBack: n.canGoBack, canGoForward: !!n.canGoForward } : null),
    });
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
  }, [patchTab, tab.id, stopWatch]);

  const onError = useCallback((e: WebViewErrorEvent) => {
    stopWatch();
    const { code, description, url } = e.nativeEvent;
    // -999 = điều hướng bị huỷ (người dùng bấm link khác/bị chặn): không phải lỗi thật
    if (code === -999) return;
    loadFailed.current = true;
    const target = lastTarget.current ?? url;
    log.error('web', `Không tải được ${getHost(target) || 'trang'}: ${description}`, `${target}\nMã lỗi: ${code}\nTrang trước: ${url}`);
  }, [stopWatch]);

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
      if (msg.type === 'ryx:media') {
        const m = msg as unknown as { kind?: string; src?: string; poster?: string; link?: string; url?: string };
        onMediaLongPress({
          kind: m.kind === 'video' ? 'video' : 'image',
          src: m.src ?? '',
          poster: m.poster ?? '',
          link: m.link ?? '',
          pageUrl: m.url ?? urlRef.current ?? '',
        });
        return;
      }
      if (msg.type === 'ryx:diag') {
        const d = describeDiag(msg as Record<string, unknown>);
        log[d.level]('video', d.text, d.detail);
        return;
      }
      if (msg.type === 'ryx:ready') {
        pageReady.current = true;
        // Nội dung trang đã hiện & dùng được: cho thanh tiến trình xong luôn, không đợi quảng cáo/ảnh tải hết
        stopWatch();
        // Chụp ảnh thu nhỏ một lúc sau khi trang hiện (cho màn quản lý thẻ)
        if (shotTimer.current) clearTimeout(shotTimer.current);
        shotTimer.current = setTimeout(() => void captureTab(tab.id), 1500);
        if (loadStartedAt.current) {
          log.debug('web', `Nội dung ${getHost(msg.url) || 'trang'} sẵn sàng sau ${((Date.now() - loadStartedAt.current) / 1000).toFixed(1)} s`);
        }
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
    [patchTab, record, tab.id, stopWatch, onMediaLongPress],
  );

  if (!tab.sourceUrl) return null;

  return (
    <View
      ref={shotRef}
      collapsable={false}
      // Không dùng display:none: thẻ ẩn có thể bị dựng lại từ đầu và quay về trang đầu tiên, mất lịch sử lùi/tiến
      pointerEvents={visible ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, visible ? styles.shown : styles.hidden]}
    >
    <WebView
      ref={setRef}
      source={{ uri: tab.sourceUrl }}
      // Mặc định thư viện chỉ cho http/https/about:blank, còn lại (vd about:srcdoc của khung trình phát video)
      // bị chặn và bị mở ra ngoài app → video không chạy. Ryx tự lọc lược đồ trong onShouldStart.
      originWhitelist={ALL_ORIGINS}
      style={styles.web}
      containerStyle={StyleSheet.absoluteFill}
      // Chẩn đoán chạy từ đầu trang chính (bắt được cả script lỗi lúc tải), rồi tới script chính của Ryx
      injectedJavaScriptBeforeContentLoaded={diag ? FRAME_DIAG_SCRIPT + '\n' + script : script}
      // Script chẩn đoán video chạy cả trong iframe (trình phát thường nằm trong iframe)
      injectedJavaScript={diag ? FRAME_DIAG_SCRIPT : undefined}
      injectedJavaScriptForMainFrameOnly={!diag}
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
      // Mặc định (true) có thể làm video trên iOS quay vòng mãi không phát (theo tài liệu react-native-webview)
      mediaPlaybackRequiresUserAction={false}
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
    </View>
  );
}

export const BrowserTab = memo(BrowserTabImpl);

const styles = StyleSheet.create({
  web: { backgroundColor: colors.bg },
  shown: { opacity: 1, zIndex: 1 },
  hidden: { opacity: 0, zIndex: 0 },
});
