import { router, useLocalSearchParams } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  Alert,
  Linking,
  Pressable,
  Share,
  StyleSheet,
  useWindowDimensions,
  View,
  type HostInstance,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useDerivedValue,
  useAnimatedKeyboard,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useFrameCallback,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ADDRESS_BAR_HEIGHT, AddressBar, CARD_ADDR_BOTTOM } from '@/components/address-bar';
import {
  BrowserTab,
  type ChapterInfo,
  type LinkPress,
  type MediaPress,
  type PickedElement,
} from '@/components/browser-tab';
import { NoticeBanner, type Notice } from '@/components/notice-banner';
import { PopupBanner, type BlockedPopup } from '@/components/popup-banner';
import { configureContentBlocker, refreshContentBlocker } from '@/lib/content-blocker';
import { applyBackgroundPlay } from '@/lib/background-play';
import { buildCookieScript } from '@/lib/cookie-consent';
import { log } from '@/lib/logger';
import { MOTION } from '@/lib/motion';
import { getRyxNetStatus, setRyxNetEnabled } from '@/lib/ryx-net';
import { saveMediaToPhotos, SaveMediaError } from '@/lib/save-media';
import { ContextMenu, type ContextMenuState, type MenuItem } from '@/components/context-menu';
import { Dock, dockMetrics, ZOOM_SPRING } from '@/components/dock';
import { TabOverview, thumbKeyOf, type FullPhase, type Rect } from '@/components/tab-overview';
import { EdgeSwipeBack } from '@/components/edge-swipe';
import { Glass } from '@/components/glass';
import { Txt } from '@/components/txt';
import { MenuSheet, type MenuAction } from '@/components/menu-sheet';
import { NewTabPage } from '@/components/new-tab-page';
import { ShieldSheet } from '@/components/shield-sheet';
import { buildInjectedScript, type InjectConfig } from '@/lib/inject';
import { captureRef } from 'react-native-view-shot';
import { useSiteThemes } from '@/state/site-themes';
import { getHost, resolveInput, siteKey } from '@/lib/url';
import { useKeyboardHeight } from '@/lib/use-keyboard-height';
import { useSettings, type DockButtonId, type ShieldPrefs } from '@/state/settings';
import { useBookmarks } from '@/state/bookmarks';
import { useDownloads } from '@/state/downloads';
import { useReading } from '@/state/reading';
import { useStats } from '@/state/stats';
import { totalBlocked, useTabs } from '@/state/tabs';
import { useStyles, useTheme, type Palette } from '@/theme';

const GAP = 10;
/** Đợi bảng trước đóng xong rồi mới mở bảng/màn hình khác (iOS không trình bày 2 modal cùng lúc). */
const SHEET_HANDOFF_MS = 280;

export default function BrowserScreen() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();

  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  const { settings, prefsFor, setSitePref, update } = useSettings();
  const { record } = useStats();
  const { tabs, active, newTab, closeTab, closeAll, patchTab, open, refs, setActive } = useTabs();
  const { width: W, height: H } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  // ---- Thu nhỏ trang thành thẻ (giữ dock kéo lên / nút Các thẻ) ----
  // zoom 0 = đang xem trang, 1 = trang đã thu vào khung của nó trong màn các thẻ.
  // Khung đích (fx, fy, fw, fh) đo từ thẻ trong màn các thẻ, toạ độ trên màn hình.
  const zoom = useSharedValue(0);
  const fx = useSharedValue(W * 0.1);
  const fy = useSharedValue(H * 0.15);
  const fw = useSharedValue(W * 0.8);
  const fh = useSharedValue(H * 0.6);
  const fr = useSharedValue(20);
  const dockX = useSharedValue(0);
  const dockY = useSharedValue(0);
  /** off: xem trang · drag: đang kéo · open: đang ở màn các thẻ · closing: thẻ đang phóng to ra · fly: thẻ mới bay ra */
  const [phase, setPhase] = useState<FullPhase>('off');
  const [hideId, setHideId] = useState<string | null>(null);

  // ---- Nhật ký giao diện: đo độ mượt của hiệu ứng thu nhỏ/phóng to (khung hình > 25 ms = bị giật) ----
  const tracking = useSharedValue(false);
  const jank = useSharedValue({ frames: 0, slow: 0, max: 0 });
  useFrameCallback((f) => {
    if (!tracking.value) return;
    const dt = f.timeSincePreviousFrame ?? 0;
    if (dt <= 0) return;
    const j = jank.value;
    jank.value = { frames: j.frames + 1, slow: j.slow + (dt > 25 ? 1 : 0), max: Math.max(j.max, dt) };
  });
  const uiTrack = useRef({ what: '', t: 0, measured: false });
  const beginTrack = (what: string) => {
    uiTrack.current = { what, t: Date.now(), measured: false };
    jank.set({ frames: 0, slow: 0, max: 0 });
    tracking.set(true);
  };
  const endTrack = (result: string) => {
    tracking.set(false);
    const { what, t, measured } = uiTrack.current;
    if (!what) return;
    const j = jank.get();
    const detail =
      `${result} sau ${Date.now() - t} ms · ${j.frames} khung hình, ${j.slow} khung bị giật (chậm nhất ${Math.round(j.max)} ms)` +
      `\nKiểu thẻ: ${settings.tabLayout} · Đo được vị trí thẻ: ${measured ? 'có' : 'không'} · Số thẻ: ${tabs.length}`;
    if (j.slow > 2) log.perf('ui', `${what}: hiệu ứng bị giật`, detail);
    else log.info('ui', what, detail);
    if (what.startsWith('Mở màn các thẻ') && result === 'Mở' && !measured)
      log.warn('ui', 'Không đo được vị trí thẻ đang mở, trang bay vào vị trí mặc định', settings.tabLayout);
    uiTrack.current.what = '';
  };

  const [ovToken, setOvToken] = useState(0);
  const pageShotRef = useRef<HostInstance>(null);
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  const activeMeasure = useRef<((cb: (r: Rect | null) => void) => void) | null>(null);
  const onActiveMeasurer = useCallback((fn: (cb: (r: Rect | null) => void) => void) => {
    activeMeasure.current = fn;
  }, []);
  /** Vị trí thẻ đang mở vừa đo được: trang đang thu nhỏ bay dần về đó */
  const onActiveFrame = useCallback(
    (r: Rect) => {
      if (phaseRef.current !== 'drag') return;
      uiTrack.current.measured = true;
      const cfg = { duration: 140 };
      fx.set(withTiming(r.x, cfg));
      fy.set(withTiming(r.y, cfg));
      fw.set(withTiming(r.w, cfg));
      fh.set(withTiming(r.h, cfg));
      if (r.radius !== undefined) fr.set(r.radius);
    },
    [fx, fy, fw, fh, fr],
  );

  const setFrame = (r: Rect, animate: boolean) => {
    const cfg = { duration: 140 };
    fx.set(animate ? withTiming(r.x, cfg) : r.x);
    fy.set(animate ? withTiming(r.y, cfg) : r.y);
    fw.set(animate ? withTiming(r.w, cfg) : r.w);
    fh.set(animate ? withTiming(r.h, cfg) : r.h);
    fr.set(r.radius ?? 20);
  };
  const zoomTo = (to: 0 | 1, done: (open: boolean) => void) => {
    const open = to === 1;
    zoom.value = reduceMotion
      ? withTiming(to, { duration: 200 }, (f) => {
          if (f) runOnJS(done)(open);
        })
      : withSpring(to, ZOOM_SPRING, (f) => {
          if (f) runOnJS(done)(open);
        });
  };
  const awaitingShot = useRef<string | null>(null);
  /** Đổi trang thật (đang nằm trong khung thẻ) sang thẻ trong màn các thẻ */
  const revealOverview = (uri: string | null) => {
    if (uri !== null && awaitingShot.current !== uri) return;
    awaitingShot.current = null;
    setHideId(null);
    setPhase((p) => (p === 'drag' ? 'open' : p));
  };
  const zoomSettled = (open: boolean) => {
    endTrack(open ? 'Mở' : 'Về trang');
    if (open) {
      // Hiệu ứng dừng rồi mới chụp cả trang (chụp giữa chừng làm rớt khung hình). Ảnh chụp giống hệt trang thật
      // đang nằm trong khung, nên chỉ đổi sang ảnh khi ảnh ĐÃ HIỆN trên thẻ → không nháy.
      const tab = active;
      const t0 = Date.now();
      captureRef(pageShotRef, { format: 'jpg', quality: 0.75, width: Math.round(W * 1.5), result: 'tmpfile' })
        .then((uri) => {
          awaitingShot.current = uri;
          patchTab(tab.id, { thumb: uri, thumbKey: thumbKeyOf(tab) });
          log.debug('ui', `Chụp thẻ xong sau ${Date.now() - t0} ms`);
          // Phòng khi ảnh không báo đã hiện
          setTimeout(() => revealOverview(uri), 600);
        })
        .catch((e: unknown) => {
          log.warn('ui', 'Không chụp được trang cho thẻ', e);
          revealOverview(null);
        });
      return;
    }
    setHideId(null);
    setPhase('off');
    dockX.value = 0;
  };
  /** Bắt đầu thu nhỏ: dựng màn các thẻ bên dưới, chụp ảnh trang hiện tại cho thẻ của nó */
  const startZoom = (how: 'kéo dock' | 'nút' = 'kéo dock') => {
    beginTrack(`Mở màn các thẻ (${how})`);
    setFrame({ x: W * 0.1, y: H * 0.18, w: W * 0.8, h: H * 0.6 }, false);
    dockX.value = 0;
    setHideId(active.id);
    setPhase('drag');
    setOvToken((n) => n + 1);
  };
  const openOverview = () => {
    if (phase !== 'off') return;
    startZoom('nút');
    setTimeout(() => zoomTo(1, zoomSettled), 60);
  };
  /** Chạm một thẻ: trang của thẻ đó phóng từ khung thẻ ra toàn màn hình; đổi thẻ thì dock nảy từ dưới lên */
  const pickTab = (id: string, r: Rect | null) => {
    beginTrack(id === active.id ? 'Quay lại thẻ đang mở' : 'Chuyển sang thẻ khác');
    uiTrack.current.measured = !!r;
    if (r) setFrame(r, false);
    zoom.value = 1;
    setHideId(id);
    setPhase('closing');
    if (id !== active.id) {
      dockY.value = 160;
      setActive(id);
    }
    requestAnimationFrame(() => {
      zoomTo(0, zoomSettled);
      dockY.value = withSpring(0, MOTION.settle);
    });
  };
  /** Thẻ mới bay ra từ nút + */
  const newTabFrom = (r: Rect | null, url?: string) => {
    newTab(url ?? null);
    if (!r || reduceMotion) {
      if (phase !== 'off') {
        zoom.value = 0;
        zoomSettled(false);
      }
      return;
    }
    beginTrack('Thẻ mới bay ra từ nút +');
    uiTrack.current.measured = true;
    setFrame(r, false);
    zoom.value = 1;
    setHideId(null);
    setPhase('fly');
    dockY.value = phase === 'open' ? 160 : 0;
    requestAnimationFrame(() => {
      zoomTo(0, zoomSettled);
      dockY.value = withSpring(0, MOTION.settle);
    });
  };

  const pageStyle = useAnimatedStyle(() => {
    const p = zoom.value;
    const s = Math.max(0.05, fw.value / W);
    const scale = 1 + (s - 1) * p;
    return {
      height: H + (fh.value / s - H) * p,
      borderRadius: (fr.value * p) / scale,
      transform: [{ translateX: fx.value * p }, { translateY: fy.value * p }, { scale }],
    };
  });

  // Viền màu nhấn của thẻ đang mở: hiện dần theo mức thu nhỏ, đúng 2pt khi trang nằm gọn trong khung thẻ
  const pageBorder = useAnimatedStyle(() => {
    const p = zoom.value;
    const s = Math.max(0.05, fw.value / W);
    const scale = 1 + (s - 1) * p;
    return { borderWidth: (2 * p) / scale, borderRadius: (fr.value * p) / scale };
  });

  const [addrFocused, setAddrFocused] = useState(false);
  const [shieldOpen, setShieldOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { isBookmarked, toggle: toggleBookmark } = useBookmarks();
  const { start: startDownload, onFinished: downloadFinishedRef } = useDownloads();

  // ---- Đọc truyện: chương trước/sau của từng thẻ ----
  const { recordChapter } = useReading();
  const [chapters, setChapters] = useState<Record<string, ChapterInfo | null>>({});
  const onChapter = useCallback(
    (tabId: string, c: ChapterInfo | null) => {
      setChapters((m) => (m[tabId] === c || (!m[tabId] && !c) ? m : { ...m, [tabId]: c }));
      if (c) recordChapter({ series: c.series, title: c.title, url: c.url, chapter: c.chapter });
    },
    [recordChapter],
  );
  const [blockedPopup, setBlockedPopup] = useState<BlockedPopup | null>(null);

  // Bộ lọc tầng mạng: áp theo tuỳ chọn Shield (đợi một chút để gộp nhiều lần bật/tắt liên tiếp)
  const allowSitesKey = Object.entries(settings.siteOverrides)
    .filter(([, o]) => o.ads === false)
    .map(([s]) => s)
    .sort()
    .join(',');
  useEffect(() => {
    const t = setTimeout(() => {
      void configureContentBlocker({
        ads: settings.shield.ads,
        gambling: settings.shield.gambling,
        allowSites: allowSitesKey ? allowSitesKey.split(',') : [],
      });
    }, 800);
    return () => clearTimeout(t);
  }, [settings.shield.ads, settings.shield.gambling, allowSitesKey]);
  useEffect(() => {
    void applyBackgroundPlay(settings.backgroundPlay);
  }, [settings.backgroundPlay]);
  useEffect(() => {
    // Tải bộ lọc mới (3 ngày/lần) sau khi app mở xong, không chặn lúc khởi động
    const t = setTimeout(() => void refreshContentBlocker(), 4000);
    return () => clearTimeout(t);
  }, []);

  const onPopupBlocked = useCallback((url: string) => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setBlockedPopup({ key: Date.now(), url, host: getHost(url) || url });
  }, []);
  const closePopupBanner = useCallback(() => setBlockedPopup(null), []);

  const activeIdRef = useRef(active.id);
  useEffect(() => {
    activeIdRef.current = active.id;
  }, [active.id]);

  // Thông báo chung (trang tải lâu, tải về xong…)
  const [notice, setNotice] = useState<Notice | null>(null);
  const closeNotice = useCallback(() => setNotice(null), []);
  // ---- Tải về ----
  // ---- Video HLS: link playlist trang đã tải (theo từng thẻ, xoá khi thẻ sang trang khác) ----
  const hlsRef = useRef(new Map<string, { tabUrl: string | null; list: { url: string; page: string }[] }>());
  const onHls = (tabId: string, url: string, page: string) => {
    const tabUrl = tabs.find((t) => t.id === tabId)?.url ?? null;
    const cur = hlsRef.current.get(tabId);
    const entry = cur && cur.tabUrl === tabUrl ? cur : { tabUrl, list: [] };
    if (!entry.list.some((x) => x.url === url)) entry.list.push({ url, page });
    hlsRef.current.set(tabId, entry);
    log.debug('download', 'Bắt được playlist HLS', `${url}\nTrang: ${page}`);
  };
  /** Playlist đầu tiên của trang hiện tại (thường là playlist gốc có đủ các mức chất lượng) */
  const hlsFor = (tabId: string) => {
    const e = hlsRef.current.get(tabId);
    const tabUrl = tabs.find((t) => t.id === tabId)?.url ?? null;
    return e && e.tabUrl === tabUrl ? (e.list[0] ?? null) : null;
  };
  const downloadHlsVideo = (url: string, referer: string, title: string) => {
    startDownload(url, { referer, hls: true, ext: 'mp4', name: title || getHost(referer) || 'video' });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setNotice({
      key: Date.now(),
      icon: 'download-outline',
      title: 'Đang tải video (HLS)',
      subtitle: 'Tải từng đoạn rồi ghép thành mp4',
      action: { label: 'Xem', run: () => router.push('/downloads') },
      autoHide: 4000,
    });
  };

  const download = (url: string, referer: string | null, ext?: string) => {
    startDownload(url, { referer: referer ?? undefined, ext });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setNotice({
      key: Date.now(),
      icon: 'download-outline',
      title: 'Đang tải về',
      subtitle: getHost(url) || url,
      action: { label: 'Xem', run: () => router.push('/downloads') },
      autoHide: 4000,
    });
  };
  useEffect(() => {
    downloadFinishedRef.current = (d) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNotice({
        key: Date.now(),
        icon: 'checkmark-circle-outline',
        title: 'Đã tải xong',
        subtitle: d.name,
        action: { label: 'Mở', run: () => router.push('/downloads') },
        autoHide: 6000,
      });
    };
    return () => {
      downloadFinishedRef.current = null;
    };
  }, [downloadFinishedRef]);

  // Không bọc useCallback: React Compiler tự ghi nhớ
  const onSlowLoad = () => {
    const st = getRyxNetStatus();
    if (!st.supported || st.enabled) return;
    setNotice({
      key: Date.now(),
      icon: 'lock-closed-outline',
      title: 'Trang tải lâu bất thường',
      subtitle: 'Có thể nhà mạng đang chặn. Bật DNS riêng của Ryx rồi tải lại?',
      action: {
        label: 'Bật DNS',
        run: () => {
          setRyxNetEnabled(true, 'google');
          // Proxy chỉ áp cho kết nối mở sau khi bật: đợi chút rồi tải lại
          setTimeout(() => refs.current.get(activeIdRef.current)?.reload(), 600);
        },
      },
      autoHide: 12000,
    });
  };

  // ---- "Chạm để ẩn quảng cáo" ----
  const [picking, setPicking] = useState(false);
  // Không bọc useCallback: React Compiler tự ghi nhớ
  const runInActive = (js: string) => refs.current.get(active.id)?.injectJavaScript(`${js}; true;`);
  const [pickCount, setPickCount] = useState(0);
  const setPick = (on: boolean) => {
    setPicking(on);
    setPickCount(0);
    runInActive(`window.__ryx && window.__ryx.pick(${on})`);
  };
  const onPick = (p: PickedElement) => {
    if (p.kind === 'count') {
      void Haptics.selectionAsync();
      setPickCount(p.count);
      return;
    }
    if (p.kind === 'menu') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      showMenu(p.x, p.y, `Đã chọn ${p.count} mục`, `Đang giữ <${p.tag}> ${p.w}×${p.h}`, [
        {
          label: p.count > 1 ? `Ẩn ${p.count} mục đã chọn` : 'Ẩn mục này',
          icon: 'eye-off-outline',
          destructive: true,
          run: () => runInActive('window.__ryx && window.__ryx.pickHide()'),
        },
        {
          label: 'Chọn khung lớn hơn',
          icon: 'expand-outline',
          run: () => runInActive('window.__ryx && window.__ryx.pickParent()'),
        },
        {
          label: 'Bỏ chọn tất cả',
          icon: 'close-circle-outline',
          run: () => runInActive('window.__ryx && window.__ryx.pickClear()'),
        },
      ]);
      return;
    }
    // done: lưu các bộ chọn cho trang này
    const pageSite = siteKey(active.url);
    if (!pageSite || p.selectors.length === 0) return setPick(false);
    const list = settings.customHides[pageSite] ?? [];
    const add = p.selectors.filter((x) => !list.includes(x));
    update({ customHides: { ...settings.customHides, [pageSite]: [...list, ...add] } });
    log.info('block', `Tự ẩn ${p.selectors.length} phần tử trên ${pageSite}`, p.selectors.join('\n'));
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPick(false);
  };

  const hasPage = !active.home && !!active.url;
  const site = hasPage ? siteKey(active.url) : '';
  const prefs = prefsFor(site);
  const blocked = totalBlocked(active);
  const shieldOn = prefs.ads || prefs.gambling || prefs.popups;

  // Script chặn quảng cáo/chế độ tối dùng chung cho mọi thẻ
  const injectConfig = useMemo<InjectConfig>(
    () => ({
      defaults: settings.shield,
      sites: settings.siteOverrides,
      hides: settings.customHides,
      bgPlay: settings.backgroundPlay,
    }),
    [settings.shield, settings.siteOverrides, settings.customHides, settings.backgroundPlay],
  );
  const siteThemes = useSiteThemes();
  // Tự từ chối bảng hỏi cookie: gắn thêm autoconsent (~790 KB) vào script trang chính nếu đang bật
  const cookieOn = settings.shield.cookies;
  const cookieOff = Object.entries(settings.siteOverrides)
    .filter(([, o]) => o.cookies === false)
    .map(([site]) => site)
    .join(',');
  const cookieScript = useMemo(
    () => (cookieOn ? buildCookieScript(cookieOff ? cookieOff.split(',') : []) : ''),
    [cookieOn, cookieOff],
  );
  const pageScheme = useTheme().scheme;
  const script = useMemo(
    () => buildInjectedScript(injectConfig, siteThemes) + cookieScript,
    // pageScheme: đổi giao diện sáng/tối thì trang tải sau dùng đúng chế độ tối/sáng cho trang
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [injectConfig, siteThemes, cookieScript, pageScheme],
  );

  // ---- Bố cục ----
  const dock = dockMetrics(settings.dockStyle, insets.bottom);
  const addrTop = settings.addressBarPosition === 'top';
  // Thanh địa chỉ: chạm để gõ thì đi lên cùng bàn phím theo từng khung hình (không nhảy cái rụp);
  // thu nhỏ thành thẻ thì trôi xuống sát đáy thẻ (dock đã ẩn)
  const kbAnim = useAnimatedKeyboard();
  const dockTop = dock.top;
  // Bàn phím đang mở là do thanh địa chỉ (không phải ô nhập trong trang web): giữ tới khi bàn phím đóng hẳn,
  // để lúc bỏ gõ thanh trôi xuống cùng bàn phím thay vì nhảy xuống trước
  const addrKb = useSharedValue(0);
  useEffect(() => {
    if (addrFocused) addrKb.set(1);
  }, [addrFocused, addrKb]);
  useAnimatedReaction(
    () => kbAnim.height.value,
    (h) => {
      if (h <= 0 && !addrFocused) addrKb.set(0);
    },
    [addrFocused],
  );
  // ---- Cuộn trang xuống: thanh địa chỉ thu thành nút kính lúp bên trái dock (kiểu Apple Music), cuộn lên thì bung lại ----
  const canCollapse = !addrTop && settings.dockStyle !== 'attached';
  // Đổi thẻ / đổi trang / về trang chủ / gõ địa chỉ / thu nhỏ thành thẻ: thanh bung lại (trạng thái thu gọn gắn với
  // đúng "khoá" lúc thu gọn, khoá đổi là tự hết thu gọn)
  const expandKey = `${active.id}|${active.url ?? ''}|${active.home}|${addrFocused}|${phase}|${canCollapse}`;
  const [collapsedFor, setCollapsedFor] = useState<string | null>(null);
  const addrCollapsed = collapsedFor === expandKey;
  const collapse = useSharedValue(0);
  const keyRef = useRef(expandKey);
  const collapsedRef = useRef(false);
  const setCollapsed = useCallback(
    (v: boolean) => {
      if (collapsedRef.current === v) return;
      collapsedRef.current = v;
      setCollapsedFor(v ? keyRef.current : null);
      collapse.set(withTiming(v ? 1 : 0, { duration: 340, easing: Easing.out(Easing.cubic) }));
    },
    [collapse],
  );
  // Dock dịch sang phải cùng lúc để nhường chỗ cho nút kính lúp (không đè lên nhau)
  const dockShift = useDerivedValue(() => collapse.get() * 28);
  const scrollRef = useRef({ last: 0, acc: 0 });
  const onScrollY = useCallback(
    (y: number) => {
      const st = scrollRef.current;
      const d = y - st.last;
      st.last = y;
      // Gần đầu trang: luôn hiện thanh
      if (y < 40) {
        st.acc = 0;
        setCollapsed(false);
        return;
      }
      // Cộng dồn theo một hướng; đổi hướng thì đếm lại (tránh bật/tắt liên tục khi tay rung)
      st.acc = Math.sign(d) === Math.sign(st.acc) ? st.acc + d : d;
      if (st.acc > 28) setCollapsed(true);
      else if (st.acc < -28) setCollapsed(false);
    },
    [setCollapsed],
  );
  useEffect(() => {
    keyRef.current = expandKey;
    scrollRef.current = { last: 0, acc: 0 };
    if (collapsedRef.current) {
      collapsedRef.current = false;
      collapse.set(withTiming(0, { duration: 340, easing: Easing.out(Easing.cubic) }));
    }
  }, [expandKey, collapse]);
  const lensBottom = dock.bottom + (dock.height - ADDRESS_BAR_HEIGHT) / 2;

  const addrAnim = useAnimatedStyle(() => {
    if (addrTop) return { top: insets.top + 4 };
    const base = addrKb.get() ? Math.max(dockTop, kbAnim.height.value) + GAP : dockTop + GAP;
    const c = collapse.get();
    const p = zoom.value;
    return { bottom: (base + (lensBottom - base) * c) * (1 - p) + CARD_ADDR_BOTTOM * p };
  });
  const chromeBottom = addrTop ? dock.top : dock.top + GAP + ADDRESS_BAR_HEIGHT;
  const contentTop = insets.top + (addrTop ? ADDRESS_BAR_HEIGHT + GAP * 1.2 : 0);
  const webBottomInset = settings.dockStyle === 'attached' && addrTop ? 0 : chromeBottom + GAP;
  const webContainerBottom = settings.dockStyle === 'attached' && addrTop ? dock.height : 0;

  // ---- Hành động ----
  const go = useCallback(
    (text: string) => {
      const url = resolveInput(text);
      if (url) open(active.id, url);
    },
    [open, active.id],
  );

  const webRef = () => refs.current.get(active.id);

  const goBack = () => {
    if (active.home) {
      if (active.sourceUrl) patchTab(active.id, { home: false });
    } else if (active.canGoBack) webRef()?.goBack();
    // Hết lịch sử trong trang: lùi về trang Thẻ mới (giống Safari quay về trang bắt đầu)
    else patchTab(active.id, { home: true });
  };

  const goHome = () => patchTab(active.id, { home: true });
  const reload = () => webRef()?.reload();

  const openInNewTab = useCallback((url: string) => newTab(url), [newTab]);

  // ---- Link từ app khác: bảng Chia sẻ → "Mở bằng Ryx" (expo-share-intent) hoặc ryx://open?url=… (Phím tắt) ----
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const { open: openParam } = useLocalSearchParams<{ open?: string }>();
  const external = hasShareIntent
    ? (shareIntent.webUrl ?? shareIntent.text?.match(/https?:\/\/\S+/)?.[0] ?? shareIntent.text ?? null)
    : (openParam ?? null);
  useEffect(() => {
    if (!external) return;
    if (hasShareIntent) resetShareIntent();
    else router.setParams({ open: undefined });
    const url = resolveInput(external.trim());
    log.info('nav', 'Mở link từ app khác', url);
    // Mở ở khung hình sau (không đặt state ngay trong effect); không huỷ: reset ở trên làm effect chạy lại với link rỗng
    requestAnimationFrame(() => newTabFrom(null, url));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy khi có link mới
  }, [external]);

  // ---- Nhấn giữ trong trang: menu nhỏ bật ra ngay chỗ ngón tay ----
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);
  const showMenu = (x: number, y: number, title: string, subtitle: string, items: MenuItem[]) => {
    if (!items.length) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Trang web giờ bắt đầu từ mép trên màn hình → toạ độ trong trang cũng là toạ độ màn hình
    setCtxMenu({ key: Date.now(), x, y, title, subtitle, items });
  };

  // Nhấn giữ ảnh/video
  const onMediaLongPress = (m: MediaPress) => {
    const isVideo = m.kind === 'video';
    const save = (url: string, kind: 'image' | 'video') => {
      void saveMediaToPhotos(url, kind, m.pageUrl)
        .then(() => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert(kind === 'video' ? 'Đã lưu video vào Ảnh' : 'Đã lưu ảnh vào Ảnh');
        })
        .catch((e: unknown) => {
          Alert.alert('Không lưu được', e instanceof SaveMediaError ? e.message : String(e));
        });
    };
    const canFetch = /^https?:/.test(m.src);
    const items: MenuItem[] = [];
    if (isVideo) {
      // "Tải video" luôn đứng đầu
      items.push({
        label: 'Tải video',
        icon: 'download-outline',
        run: () => {
          if (/\.m3u8(\?|#|$)/i.test(m.src)) return downloadHlsVideo(m.src, m.pageUrl, m.pageTitle);
          if (canFetch) return download(m.src, m.pageUrl, 'mp4');
          const h = hlsFor(active.id);
          if (h) return downloadHlsVideo(h.url, h.page, m.pageTitle);
          Alert.alert(
            'Chưa tìm thấy luồng video',
            'Video này phát dạng luồng nhưng Ryx chưa bắt được link playlist (.m3u8). Cho video phát vài giây rồi nhấn giữ lại.',
          );
        },
      });
      if (canFetch && !/\.m3u8/i.test(m.src))
        items.push({ label: 'Lưu vào Ảnh', icon: 'images-outline', run: () => save(m.src, 'video') });
      if (m.pip)
        items.push({
          label: 'Hình trong hình',
          icon: 'browsers-outline',
          run: () => webRef()?.injectJavaScript('window.__ryx && window.__ryx.pip(); true;'),
        });
      if (m.poster) items.push({ label: 'Lưu ảnh bìa', icon: 'image-outline', run: () => save(m.poster, 'image') });
    } else if (m.src) {
      items.push({ label: 'Lưu vào Ảnh', icon: 'images-outline', run: () => save(m.src, 'image') });
      if (canFetch)
        items.push({ label: 'Tải về', icon: 'download-outline', run: () => download(m.src, m.pageUrl, 'jpg') });
    }
    if (m.link)
      items.push({
        label: 'Mở link trong thẻ mới',
        icon: 'duplicate-outline',
        run: () => newTab(m.link, { background: true }),
      });
    if (canFetch)
      items.push({ label: 'Sao chép link', icon: 'copy-outline', run: () => void Clipboard.setStringAsync(m.src) });
    showMenu(
      // Trong khung nhúng không biết vị trí thật của ngón tay → đặt menu giữa màn hình
      m.inFrame ? W / 2 : m.x,
      m.inFrame ? H * 0.32 : m.y,
      isVideo ? (m.playing ? 'Video đang phát' : 'Video') : 'Ảnh',
      (isVideo && m.pageTitle) || getHost(m.src) || '',
      items.slice(0, 5),
    );
  };

  // Nhấn giữ link
  const onLinkLongPress = (l: LinkPress) => {
    showMenu(l.x, l.y, l.text || getHost(l.href) || 'Link', l.href.replace(/^https?:\/\//, ''), [
      {
        label: 'Mở trong thẻ mới',
        icon: 'duplicate-outline',
        run: () => {
          newTab(l.href, { background: true });
          setNotice({
            key: Date.now(),
            icon: 'duplicate-outline',
            title: 'Đã mở trong thẻ mới',
            subtitle: getHost(l.href),
            autoHide: 2000,
          });
        },
      },
      { label: 'Mở và chuyển tới', icon: 'open-outline', run: () => newTab(l.href) },
      { label: 'Sao chép link', icon: 'copy-outline', run: () => void Clipboard.setStringAsync(l.href) },
      {
        label: 'Chia sẻ…',
        icon: 'share-outline',
        run: () => void Share.share({ url: l.href, message: l.href }).catch(() => {}),
      },
    ]);
  };

  const share = () => {
    if (active.url) Share.share({ url: active.url, message: active.url }).catch(() => {});
  };

  const onDockPress = (id: DockButtonId) => {
    switch (id) {
      case 'back':
        log.debug('nav', `Bấm lùi (trang có lịch sử lùi: ${active.canGoBack ? 'có' : 'không'})`, active.url ?? '');
        return goBack();
      case 'forward':
        log.debug('nav', `Bấm tiến (trang có lịch sử tiến: ${active.canGoForward ? 'có' : 'không'})`, active.url ?? '');
        return webRef()?.goForward();
      case 'tabs':
        if (phase === 'open') {
          const m = activeMeasure.current;
          return m ? m((r) => pickTab(active.id, r)) : pickTab(active.id, null);
        }
        return openOverview();
      case 'menu':
        return setMenuOpen(true);
      case 'shield':
        return setShieldOpen(true);
      case 'reload':
        return reload();
      case 'home':
        return goHome();
      case 'share':
        return share();
    }
  };

  const onMenuAction = (a: MenuAction) => {
    switch (a) {
      case 'reload':
        return reload();
      case 'share':
        return setTimeout(share, SHEET_HANDOFF_MS);
      case 'home':
        return goHome();
      case 'safari':
        return active.url && Linking.openURL(active.url);
      case 'shield':
        return setTimeout(() => setShieldOpen(true), SHEET_HANDOFF_MS);
      case 'pick':
        return setPick(true);
      case 'bookmark': {
        if (!active.url) return;
        const added = toggleBookmark(active.url, active.title || siteKey(active.url));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return setNotice({
          key: Date.now(),
          icon: added ? 'star' : 'star-outline',
          title: added ? 'Đã thêm vào Truy cập nhanh' : 'Đã bỏ khỏi Truy cập nhanh',
          subtitle: active.title || siteKey(active.url),
          autoHide: 2500,
        });
      }
      case 'downloads':
        return setTimeout(() => router.push('/downloads'), SHEET_HANDOFF_MS);
      case 'customize':
        return setTimeout(() => router.push('/customize'), SHEET_HANDOFF_MS);
      case 'newTab':
        return newTab();
      case 'closeTab':
        return closeTab(active.id);
      case 'logs':
        return setTimeout(() => router.push('/logs'), SHEET_HANDOFF_MS);
      case 'history':
        return setTimeout(() => router.push('/history'), SHEET_HANDOFF_MS);
      case 'dns':
        return setTimeout(() => router.push('/dns'), SHEET_HANDOFF_MS);
    }
  };

  const toggle = (key: keyof ShieldPrefs, value: boolean) => setSitePref(site, key, value);

  const chapter = !active.home ? chapters[active.id] : null;
  const canGoBack = active.home ? !!active.sourceUrl : true;
  const canGoForward = !active.home && active.canGoForward;

  const pageOn = phase === 'off';
  return (
    <View style={styles.root}>
      <TabOverview
        phase={phase}
        token={ovToken}
        onActiveMeasurer={onActiveMeasurer}
        onActiveThumbShown={(uri) => revealOverview(uri)}
        zoom={zoom}
        dockShift={dockX}
        tabs={tabs}
        activeId={active.id}
        hideId={hideId}
        layout={settings.tabLayout}
        bottomPad={dock.top + 14}
        onLayoutChange={(l) => {
          log.info('ui', 'Đổi kiểu thẻ', `${settings.tabLayout} → ${l}`);
          update({ tabLayout: l });
        }}
        onActiveFrame={onActiveFrame}
        onPick={pickTab}
        onClose={closeTab}
        onDuplicate={(id) => {
          const t = tabs.find((x) => x.id === id);
          if (t?.url) newTab(t.url, { background: true });
        }}
        onCloseAll={() => {
          closeAll();
          setHideId(null);
          zoomTo(0, zoomSettled);
          setPhase('closing');
        }}
        onNewTab={(r) => newTabFrom(r)}
      />

      {/* Toàn bộ trang (web + thanh địa chỉ) nằm trong một lớp để thu nhỏ thành thẻ */}
      <Animated.View
        pointerEvents={pageOn ? 'box-none' : 'none'}
        style={[styles.page, { width: W, opacity: phase === 'open' ? 0 : 1 }, pageStyle]}
      >
        <View
          ref={pageShotRef}
          collapsable={false}
          style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, backgroundColor: colors.bg }}
        >
          {/* Trang chạy tràn lên tận mép trên; iOS làm mờ dần phần dưới giờ/pin (xem lib/edge) */}
          <View style={[styles.webArea, { top: 0, bottom: webContainerBottom }]}>
            {tabs.map((t) => (
              <BrowserTab
                key={t.id}
                tab={t}
                visible={t.id === active.id && !t.home}
                script={script}
                injectConfig={injectConfig}
                prefsFor={prefsFor}
                record={record}
                onOpenInNewTab={openInNewTab}
                onPopupBlocked={onPopupBlocked}
                onMediaLongPress={onMediaLongPress}
                onLinkLongPress={onLinkLongPress}
                onSelectStart={closeCtxMenu}
                onScrollY={canCollapse && t.id === active.id ? onScrollY : undefined}
                onHls={onHls}
                onPick={onPick}
                onSlowLoad={onSlowLoad}
                onChapter={onChapter}
                onDownload={(url, referer) => download(url, referer)}
                diag={settings.diagVideo}
                insetTop={contentTop}
                insetBottom={webBottomInset}
              />
            ))}
            {active.home && (
              <NewTabPage
                onSubmit={go}
                onOpen={(url) => open(active.id, url)}
                onOpenNewTab={(url) => newTab(url)}
                paddingTop={contentTop}
                paddingBottom={chromeBottom}
              />
            )}
          </View>

          {/* Vuốt từ mép trái để lùi: trang đầu của thẻ thì về trang Thẻ mới; đang ở Thẻ mới thì không làm gì */}
          {!active.home && !picking && pageOn && (
            <EdgeSwipeBack
              top={addrTop ? insets.top + ADDRESS_BAR_HEIGHT + 12 : insets.top}
              bottom={chromeBottom}
              onBack={() => {
                log.debug(
                  'nav',
                  `Vuốt lùi (trang có lịch sử lùi: ${active.canGoBack ? 'có' : 'không'})`,
                  active.url ?? '',
                );
                goBack();
              }}
            />
          )}

          {picking && (
            <View pointerEvents="box-none" style={[styles.pickWrap, { top: insets.top + 8 }]}>
              <Glass radius={24} contentStyle={styles.pickRow}>
                <Ionicons name="hand-left-outline" size={18} color={colors.text} />
                <Txt weight="medium" size={14} style={{ flex: 1 }} accessibilityRole="alert">
                  {pickCount === 0
                    ? 'Chạm để chọn quảng cáo (chọn được nhiều mục)'
                    : `Đã chọn ${pickCount} mục · giữ một mục để ẩn`}
                </Txt>
                <Pressable
                  onPress={() => setPick(false)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.pickDone, pressed && { opacity: 0.7 }]}
                >
                  <Txt weight="semibold" size={14}>
                    Xong
                  </Txt>
                </Pressable>
              </Glass>
            </View>
          )}

          {chapter && !addrFocused && !picking && !notice && (
            <View pointerEvents="box-none" style={[styles.chapWrap, { bottom: chromeBottom + GAP }]}>
              {chapter.prev ? (
                <Glass radius={22} contentStyle={styles.chapBtn}>
                  <Pressable
                    onPress={() => chapter.prev && open(active.id, chapter.prev)}
                    accessibilityRole="button"
                    accessibilityLabel="Chương trước"
                    hitSlop={6}
                    style={({ pressed }) => [styles.chapInner, pressed && { opacity: 0.6 }]}
                  >
                    <Ionicons name="chevron-back" size={18} color={colors.text} />
                    <Txt weight="semibold" size={14}>
                      Chương trước
                    </Txt>
                  </Pressable>
                </Glass>
              ) : (
                <View />
              )}
              {chapter.next ? (
                <Glass radius={22} contentStyle={styles.chapBtn}>
                  <Pressable
                    onPress={() => chapter.next && open(active.id, chapter.next)}
                    accessibilityRole="button"
                    accessibilityLabel="Chương sau"
                    hitSlop={6}
                    style={({ pressed }) => [styles.chapInner, pressed && { opacity: 0.6 }]}
                  >
                    <Txt weight="semibold" size={14}>
                      Chương sau
                    </Txt>
                    <Ionicons name="chevron-forward" size={18} color={colors.text} />
                  </Pressable>
                </Glass>
              ) : null}
            </View>
          )}
        </View>
        {/* Thanh địa chỉ nằm ngoài vùng chụp ảnh thẻ (ảnh thẻ tự vẽ thanh tĩnh ở đúng chỗ, xem tab-overview), nhưng vẫn
          trong lớp thu nhỏ: zoom out thì thanh co lại cùng trang và trôi xuống sát đáy thẻ, dock ẩn đi */}
        <Animated.View pointerEvents="box-none" style={[styles.addrWrap, addrAnim]}>
          <AddressBar
            tab={active}
            blocked={blocked.total}
            shieldOn={shieldOn}
            onSubmit={go}
            onShieldPress={() => setShieldOpen(true)}
            onReload={reload}
            onStop={() => webRef()?.stopLoading()}
            onFocusChange={setAddrFocused}
            position={addrTop ? 'top' : 'bottom'}
            collapse={collapse}
            collapsed={addrCollapsed}
            onExpand={() => setCollapsed(false)}
          />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { borderColor: settings.accent }, pageBorder]}
        />
      </Animated.View>

      <Dock
        dockStyle={settings.dockStyle}
        buttons={settings.dockButtons}
        tabCount={tabs.length}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        blocked={blocked.total}
        onPress={onDockPress}
        onNewTab={(r) => newTabFrom(r)}
        zoom={zoom}
        zoomEnabled={phase === 'off'}
        onZoomStart={() => startZoom()}
        onZoomEnd={zoomSettled}
        extraX={dockX}
        extraY={dockY}
        shiftX={dockShift}
        hidden={addrFocused && kb > 0}
        onSwipeSide={(dir) => {
          const i = tabs.findIndex((t) => t.id === active.id);
          const next = tabs[dir === 'next' ? i + 1 : i - 1];
          if (next) {
            void Haptics.selectionAsync();
            setActive(next.id);
          } else void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        }}
      />
      <ContextMenu menu={ctxMenu} onClose={closeCtxMenu} />

      <NoticeBanner notice={notice} bottom={chromeBottom + GAP} onClose={closeNotice} />

      <PopupBanner
        popup={blockedPopup}
        bottom={chromeBottom + GAP}
        onOpen={(url) => {
          setBlockedPopup(null);
          newTab(url);
        }}
        onClose={closePopupBanner}
      />

      <ShieldSheet
        visible={shieldOpen}
        onClose={() => setShieldOpen(false)}
        site={site}
        counts={blocked}
        prefs={prefs}
        onToggle={toggle}
        onReload={reload}
        customHidden={settings.customHides[site]?.length ?? 0}
        onStartPick={() => setTimeout(() => setPick(true), SHEET_HANDOFF_MS)}
        onClearCustom={() => {
          const next = { ...settings.customHides };
          delete next[site];
          update({ customHides: next });
        }}
      />
      <MenuSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        hasPage={hasPage}
        dark={prefs.dark}
        bookmarked={isBookmarked(active.url)}
        onToggleDark={(v) => toggle('dark', v)}
        onAction={onMenuAction}
      />
    </View>
  );
}

const makeStyles = (colors: Palette, fg: (alpha: number) => string) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    webArea: { position: 'absolute', left: 0, right: 0 },
    page: {
      position: 'absolute',
      left: 0,
      top: 0,
      overflow: 'hidden',
      transformOrigin: 'left top',
      backgroundColor: colors.bg,
    },
    addrWrap: { position: 'absolute', left: 16, right: 16 },
    pickWrap: { position: 'absolute', left: 16, right: 16 },
    chapWrap: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
    chapBtn: { minHeight: 44, justifyContent: 'center' },
    chapInner: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, minHeight: 44 },
    pickRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingLeft: 16,
      paddingRight: 6,
      minHeight: 52,
    },
    pickDone: {
      minHeight: 40,
      paddingHorizontal: 16,
      borderRadius: 20,
      justifyContent: 'center',
      backgroundColor: fg(0.12),
    },
  });
