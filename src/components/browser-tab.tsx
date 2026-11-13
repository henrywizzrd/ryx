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
import { buildUpdateCall, FRAME_MEDIA_SCRIPT, type InjectConfig } from '@/lib/inject';
import { PageError } from '@/components/page-error';
import { attachContentBlocker } from '@/lib/content-blocker';
import { applyEdgeEffects } from '@/lib/edge';
import { describeDiag, FRAME_DIAG_SCRIPT } from '@/lib/frame-diag';
import { log } from '@/lib/logger';
import { registerShotTarget } from '@/lib/tab-shots';
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
  /** Nhấn giữ một link. */
  onLinkLongPress: (l: LinkPress) => void;
  /** Đang giữ link rồi kéo ngón tay → bắt đầu tô chọn chữ (app đóng menu nhấn giữ) */
  onSelectStart?: () => void;
  /** Trang/khung nhúng tải một playlist HLS (.m3u8) */
  onHls?: (tabId: string, url: string, page: string) => void;
  /** Đang ở chế độ "Chạm để ẩn quảng cáo" và trang báo phần tử vừa chọn. */
  onPick: (p: PickedElement) => void;
  /** Trang chương truyện (có link chương trước/sau), null khi rời trang. */
  onChapter: (tabId: string, c: ChapterInfo | null) => void;
  /** Trang mở một file không xem được (zip, ipa, tệp đính kèm…) → tải về. */
  onDownload: (url: string, referer: string | null) => void;
  /** Trang tải quá lâu (gợi ý bật DNS riêng). */
  onSlowLoad: (url: string) => void;
  /** Bật script chẩn đoán video (Tuỳ chỉnh → Nâng cao). */
  diag: boolean;
  /** Khoảng trên cùng bị che (thanh trạng thái + thanh địa chỉ nếu đặt trên): trang bắt đầu dưới nó nhưng cuộn lên được bên dưới lớp mờ. */
  insetTop: number;
  insetBottom: number;
}

export interface ChapterInfo {
  series: string;
  title: string;
  chapter: string;
  url: string;
  next: string | null;
  prev: string | null;
}

/** Sự kiện từ chế độ "Chạm để ẩn quảng cáo" (chọn nhiều mục, giữ một mục để hiện menu) */
export type PickedElement =
  | { kind: 'count'; count: number }
  | { kind: 'menu'; count: number; tag: string; w: number; h: number; x: number; y: number }
  | { kind: 'done'; selectors: string[] };

export interface MediaPress {
  kind: 'image' | 'video';
  src: string;
  poster: string;
  link: string;
  pageUrl: string;
  /** Video đang phát lúc nhấn giữ */
  playing: boolean;
  /** Video hỗ trợ Hình trong hình */
  pip: boolean;
  /** Nhấn giữ trong khung nhúng: toạ độ tính theo khung đó, không dùng được để đặt menu */
  inFrame: boolean;
  pageTitle: string;
  /** Chỗ nhấn giữ, tính trong khung trang web */
  x: number;
  y: number;
}

export interface LinkPress {
  href: string;
  text: string;
  pageUrl: string;
  x: number;
  y: number;
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
  onLinkLongPress,
  onSelectStart,
  onHls,
  onPick,
  onSlowLoad,
  onChapter,
  onDownload,
  diag,
  insetTop,
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
  const startWatch = useCallback(
    (stage: string, url: string, ms: number) => {
      stopWatch();
      watchdog.current = setTimeout(() => {
        const host = getHost(url) || url;
        log.warn(
          'nav',
          `${host}: ${stage} sau ${Math.round(ms / 1000)} giây vẫn chưa xong`,
          `${url}\nThường do nhà mạng chặn (kết nối bị treo) hoặc máy chủ trang quá chậm. Tiến độ hiện tại: ${Math.round(lastProgress.current * 100)}%`,
        );
        // Hỏi trang xem đang chờ tệp nào (script đồng bộ bị treo sẽ làm trang đứng)
        ref.current?.injectJavaScript('window.__ryx && window.__ryx.pending && window.__ryx.pending(); true;');
        if (visibleRef.current) onSlowLoad(url);
      }, ms);
    },
    [stopWatch, onSlowLoad],
  );
  useEffect(() => stopWatch, [stopWatch]);

  useEffect(
    () =>
      registerShotTarget(tab.id, {
        ref: shotRef,
        isVisible: () => visibleRef.current,
        // Ảnh thẻ giờ do màn trình duyệt chụp cả trang (kèm thanh địa chỉ) lúc mở màn các thẻ
        onShot: () => {},
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

  // Gắn bộ lọc tầng mạng vào WebView của thẻ này (WebView có thể vào màn hình trễ một chút)
  useEffect(() => {
    attachContentBlocker();
    applyEdgeEffects();
    const t = setTimeout(() => {
      attachContentBlocker();
      applyEdgeEffects(0);
    }, 600);
    return () => clearTimeout(t);
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
          log.info(
            'block',
            `Chặn quảng cáo mở kèm khi bấm: ${getHost(url)}`,
            `${url}\nĐã bấm: ${lastClick.current.url}`,
          );
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
          log.info(
            'block',
            `Chặn cửa sổ bật lên sang ${getHost(url) || url}`,
            `${url}\nĐang ở: ${urlRef.current ?? ''}`,
          );
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
      onChapter(tab.id, null);
      loadStartedAt.current = Date.now();
      loadFailed.current = false;
      lastProgress.current = 0.05;
      halfLogged.current = false;
      const since = navStartedAt.current
        ? ` (${((Date.now() - navStartedAt.current) / 1000).toFixed(1)} s sau khi bấm)`
        : '';
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
    [patchTab, tab.id, startWatch, onChapter],
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
        log.debug(
          'web',
          `Tải được ${Math.round(p * 100)}% sau ${((Date.now() - loadStartedAt.current) / 1000).toFixed(1)} s`,
        );
      }
      patchTab(tab.id, { progress: p });
    },
    [patchTab, tab.id],
  );

  const onLoadEnd = useCallback(
    (e: { nativeEvent: { canGoBack?: boolean; canGoForward?: boolean } }) => {
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
    },
    [patchTab, tab.id, stopWatch],
  );

  const onError = useCallback(
    (e: WebViewErrorEvent) => {
      stopWatch();
      const { code, description, url } = e.nativeEvent;
      // -999 = điều hướng bị huỷ (người dùng bấm link khác/bị chặn): không phải lỗi thật
      if (code === -999) return;
      loadFailed.current = true;
      const target = lastTarget.current ?? url;
      log.error(
        'web',
        `Không tải được ${getHost(target) || 'trang'}: ${description}`,
        `${target}\nMã lỗi: ${code}\nTrang trước: ${url}`,
      );
    },
    [stopWatch],
  );

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
        level?: string;
      };
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'ryx:chapter') {
        const c = msg as unknown as ChapterInfo;
        if (c.series && c.url) onChapter(tab.id, { ...c, next: c.next ?? null, prev: c.prev ?? null });
        return;
      }
      if (msg.type === 'ryx:pending') {
        const p = msg as unknown as { state?: string; total?: number; list?: string[] };
        const list = p.list ?? [];
        log.warn(
          'web',
          `Trang đang chờ ${list.length}/${p.total ?? 0} tệp (trạng thái: ${p.state ?? '?'})`,
          list.join('\n') || 'Không còn script/CSS nào đang chờ',
        );
        return;
      }
      if (msg.type === 'ryx:pick') {
        const p = msg as unknown as PickedElement;
        if (p.kind === 'count' || p.kind === 'menu' || p.kind === 'done') onPick(p);
        return;
      }
      if (msg.type === 'ryx:media') {
        const m = msg as unknown as {
          kind?: string;
          src?: string;
          poster?: string;
          link?: string;
          url?: string;
          playing?: boolean;
          pip?: boolean;
          inFrame?: boolean;
          title?: string;
          x?: number;
          y?: number;
        };
        onMediaLongPress({
          kind: m.kind === 'video' ? 'video' : 'image',
          src: m.src ?? '',
          poster: m.poster ?? '',
          link: m.link ?? '',
          pageUrl: m.url ?? urlRef.current ?? '',
          playing: !!m.playing,
          pip: !!m.pip,
          inFrame: !!m.inFrame,
          pageTitle: m.title ?? '',
          x: m.x ?? 0,
          y: m.y ?? 0,
        });
        return;
      }
      if (msg.type === 'ryx:link') {
        const l = msg as unknown as { href?: string; text?: string; url?: string; x?: number; y?: number };
        if (l.href)
          onLinkLongPress({
            href: l.href,
            text: l.text ?? '',
            pageUrl: l.url ?? urlRef.current ?? '',
            x: l.x ?? 0,
            y: l.y ?? 0,
          });
        return;
      }
      if (msg.type === 'ryx:cookie') {
        const c = msg as unknown as { cmp?: string; clicks?: number };
        log.info(
          'block',
          `Đã tự từ chối bảng hỏi cookie trên ${siteKey(urlRef.current) ?? 'trang'}`,
          `Nền tảng: ${c.cmp || 'không rõ'} · ${c.clicks ?? 0} lần bấm`,
        );
        return;
      }
      if (msg.type === 'ryx:hls') {
        const h = msg as unknown as { url?: string; page?: string };
        if (h.url) onHls?.(tab.id, h.url, h.page ?? urlRef.current ?? '');
        return;
      }
      if (msg.type === 'ryx:select') {
        onSelectStart?.();
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
        if (loadStartedAt.current) {
          log.debug(
            'web',
            `Nội dung ${getHost(msg.url) || 'trang'} sẵn sàng sau ${((Date.now() - loadStartedAt.current) / 1000).toFixed(1)} s`,
          );
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
        const lvl = msg.level === 'info' || msg.level === 'warn' ? msg.level : 'error';
        log[lvl]('inject', msg.msg ?? 'Lỗi trong script của trang', `${msg.url ?? ''}\n${msg.detail ?? ''}`.trim());
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
    [patchTab, record, tab.id, stopWatch, onMediaLongPress, onLinkLongPress, onSelectStart, onHls, onPick, onChapter],
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
        // Chạy trong cả khung nhúng: nhấn giữ video trong iframe (trình phát của trang khác) cũng hiện menu của Ryx
        injectedJavaScript={diag ? FRAME_MEDIA_SCRIPT + '\n' + FRAME_DIAG_SCRIPT : FRAME_MEDIA_SCRIPT}
        injectedJavaScriptForMainFrameOnly={false}
        onShouldStartLoadWithRequest={onShouldStart}
        onOpenWindow={onOpenWindow}
        onFileDownload={(e) => onDownload(e.nativeEvent.downloadUrl, urlRef.current ?? null)}
        onLoadStart={onLoadStart}
        onNavigationStateChange={onNavChange}
        onLoadProgress={onLoadProgress}
        onLoadEnd={onLoadEnd}
        onError={onError}
        renderError={renderError}
        onHttpError={onHttpError}
        onMessage={onMessage}
        onContentProcessDidTerminate={onProcessTerminated}
        // Vuốt lùi do Ryx tự làm (components/edge-swipe): cử chỉ có sẵn không chạy trong app và sẽ chồng lên nhau
        allowsBackForwardNavigationGestures={false}
        allowsInlineMediaPlayback
        // Tắt xem trước link/ảnh của iOS khi nhấn giữ: Ryx tự hiện menu riêng
        allowsLinkPreview={false}
        // Mặc định (true) có thể làm video trên iOS quay vòng mãi không phát (theo tài liệu react-native-webview)
        mediaPlaybackRequiresUserAction={false}
        pullToRefreshEnabled
        refreshControlLightMode={colors.scheme === 'dark'}
        sharedCookiesEnabled
        setSupportMultipleWindows
        decelerationRate="normal"
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        contentInset={{ top: insetTop, bottom: insetBottom }}
        contentMode="mobile"
        keyboardDisplayRequiresUserAction={false}
      />
    </View>
  );
}

export const BrowserTab = memo(BrowserTabImpl);

const styles = StyleSheet.create({
  web: { backgroundColor: colors.bg },
  // Không đặt zIndex: khung bọc thẻ có thể bị gộp (view flattening) lên cùng cấp với dock/thanh địa chỉ,
  // zIndex khi đó đẩy trang web đè lên che mất dock. Thẻ ẩn đã trong suốt và không nhận chạm nên thứ tự không quan trọng.
  shown: { opacity: 1 },
  hidden: { opacity: 0 },
});
