import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActionSheetIOS, Alert, Linking, Pressable, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ADDRESS_BAR_HEIGHT, AddressBar } from '@/components/address-bar';
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
import { log } from '@/lib/logger';
import { getRyxNetStatus, setRyxNetEnabled } from '@/lib/ryx-net';
import { saveMediaToPhotos, SaveMediaError } from '@/lib/save-media';
import { ContextMenu, type ContextMenuState, type MenuItem } from '@/components/context-menu';
import { Dock, dockMetrics } from '@/components/dock';
import { EdgeSwipeBack } from '@/components/edge-swipe';
import { Glass } from '@/components/glass';
import { Txt } from '@/components/txt';
import { MenuSheet, type MenuAction } from '@/components/menu-sheet';
import { NewTabPage } from '@/components/new-tab-page';
import { ShieldSheet } from '@/components/shield-sheet';
import { buildInjectedScript, type InjectConfig } from '@/lib/inject';
import { captureTab } from '@/lib/tab-shots';
import { useSiteThemes } from '@/state/site-themes';
import { getHost, resolveInput, siteKey } from '@/lib/url';
import { useKeyboardHeight } from '@/lib/use-keyboard-height';
import { useSettings, type DockButtonId, type ShieldPrefs } from '@/state/settings';
import { useBookmarks } from '@/state/bookmarks';
import { useDownloads } from '@/state/downloads';
import { useReading } from '@/state/reading';
import { useStats } from '@/state/stats';
import { totalBlocked, useTabs } from '@/state/tabs';
import { colors } from '@/theme';

const GAP = 10;
/** Đợi bảng trước đóng xong rồi mới mở bảng/màn hình khác (iOS không trình bày 2 modal cùng lúc). */
const SHEET_HANDOFF_MS = 280;

export default function BrowserScreen() {
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  const { settings, prefsFor, setSitePref, update } = useSettings();
  const { record } = useStats();
  const { tabs, active, newTab, closeTab, patchTab, open, refs, setActive } = useTabs();

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
  const setPick = (on: boolean) => {
    setPicking(on);
    runInActive(`window.__ryx && window.__ryx.pick(${on})`);
  };
  const onPick = (p: PickedElement) => {
    void Haptics.selectionAsync();
    const pageSite = siteKey(active.url);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: `Đã chọn khối <${p.tag}> ${p.w}×${p.h}`,
        message: 'Khối được tô đỏ trên trang sẽ bị ẩn mỗi lần cậu vào trang này.',
        options: ['Ẩn khối này', 'Chọn khối lớn hơn', 'Chọn lại', 'Thoát'],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 3,
      },
      (i) => {
        if (i === 0 && pageSite) {
          const list = settings.customHides[pageSite] ?? [];
          if (!list.includes(p.selector)) {
            update({
              customHides: {
                ...settings.customHides,
                [pageSite]: [...list, p.selector],
              },
            });
          }
          log.info('block', `Tự ẩn phần tử trên ${pageSite}`, p.selector);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setPick(false);
        } else if (i === 1) runInActive('window.__ryx && window.__ryx.pickParent()');
        else if (i === 3) setPick(false);
      },
    );
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
  const script = useMemo(() => buildInjectedScript(injectConfig, siteThemes), [injectConfig, siteThemes]);

  // ---- Bố cục ----
  const dock = dockMetrics(settings.dockStyle, insets.bottom);
  const addrTop = settings.addressBarPosition === 'top';
  const addrBottom = addrFocused && kb > 0 ? kb + GAP : dock.top + GAP;
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

  // ---- Nhấn giữ trong trang: menu nhỏ bật ra ngay chỗ ngón tay ----
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);
  const showMenu = (x: number, y: number, title: string, subtitle: string, items: MenuItem[]) => {
    if (!items.length) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Toạ độ trong trang → toạ độ trên màn hình (trang web bắt đầu từ contentTop)
    setCtxMenu({ key: Date.now(), x, y: y + contentTop, title, subtitle, items });
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
        run: () =>
          canFetch
            ? download(m.src, m.pageUrl, 'mp4')
            : Alert.alert(
                'Chưa tải được video này',
                'Video phát theo dạng luồng (HLS) nên không có một file mp4 để tải. Ryx hiện chỉ tải được video mp4.',
              ),
      });
      if (canFetch) items.push({ label: 'Lưu vào Ảnh', icon: 'images-outline', run: () => save(m.src, 'video') });
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
      m.x,
      m.y,
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
        // Chụp thẻ đang mở trước để màn quản lý thẻ có ảnh mới nhất
        return void captureTab(active.id).finally(() => router.push('/tabs'));
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

  return (
    <View style={styles.root}>
      <View style={[styles.webArea, { top: contentTop, bottom: webContainerBottom }]}>
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
            onPick={onPick}
            onSlowLoad={onSlowLoad}
            onChapter={onChapter}
            onDownload={(url, referer) => download(url, referer)}
            diag={settings.diagVideo}
            insetBottom={webBottomInset}
          />
        ))}
        {active.home && (
          <NewTabPage
            onSubmit={go}
            onOpen={(url) => open(active.id, url)}
            onOpenNewTab={(url) => newTab(url)}
            paddingTop={0}
            paddingBottom={chromeBottom}
          />
        )}
      </View>

      {/* Vuốt từ mép trái để lùi: trang đầu của thẻ thì về trang Thẻ mới; đang ở Thẻ mới thì không làm gì */}
      {!active.home && !picking && (
        <EdgeSwipeBack
          top={addrTop ? insets.top + ADDRESS_BAR_HEIGHT + 12 : insets.top}
          bottom={chromeBottom}
          onBack={() => {
            log.debug('nav', `Vuốt lùi (trang có lịch sử lùi: ${active.canGoBack ? 'có' : 'không'})`, active.url ?? '');
            goBack();
          }}
        />
      )}

      {/* Che vùng thanh trạng thái để nội dung trang không chạy dưới đồng hồ/pin */}
      <View style={[styles.statusCover, { height: insets.top }]} pointerEvents="none" />

      {!(addrFocused && kb > 0) && (
        <Dock
          dockStyle={settings.dockStyle}
          buttons={settings.dockButtons}
          tabCount={tabs.length}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          blocked={blocked.total}
          onPress={onDockPress}
          onNewTab={() => newTab()}
          onSwipeUp={() => void captureTab(active.id).finally(() => router.push('/tabs'))}
          onSwipeSide={(dir) => {
            const i = tabs.findIndex((t) => t.id === active.id);
            const next = tabs[dir === 'next' ? i + 1 : i - 1];
            if (next) {
              void Haptics.selectionAsync();
              setActive(next.id);
            } else void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          }}
        />
      )}

      <View
        pointerEvents="box-none"
        style={[styles.addrWrap, addrTop ? { top: insets.top + 4 } : { bottom: addrBottom }]}
      >
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
        />
      </View>

      {picking && (
        <View pointerEvents="box-none" style={[styles.pickWrap, { top: insets.top + 8 }]}>
          <Glass radius={24} contentStyle={styles.pickRow}>
            <Ionicons name="hand-left-outline" size={18} color={colors.text} />
            <Txt weight="medium" size={14} style={{ flex: 1 }} accessibilityRole="alert">
              Chạm vào quảng cáo cần ẩn
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  webArea: { position: 'absolute', left: 0, right: 0 },
  statusCover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
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
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
});
