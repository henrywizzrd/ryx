import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Linking, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ADDRESS_BAR_HEIGHT, AddressBar } from '@/components/address-bar';
import { BrowserTab } from '@/components/browser-tab';
import { Dock, dockMetrics } from '@/components/dock';
import { MenuSheet, type MenuAction } from '@/components/menu-sheet';
import { NewTabPage } from '@/components/new-tab-page';
import { ShieldSheet } from '@/components/shield-sheet';
import { buildInjectedScript, type InjectConfig } from '@/lib/inject';
import { useSiteThemes } from '@/state/site-themes';
import { resolveInput, siteKey } from '@/lib/url';
import { useKeyboardHeight } from '@/lib/use-keyboard-height';
import { useSettings, type DockButtonId, type ShieldPrefs } from '@/state/settings';
import { useStats } from '@/state/stats';
import { totalBlocked, useTabs } from '@/state/tabs';
import { colors } from '@/theme';

const GAP = 10;
/** Đợi bảng trước đóng xong rồi mới mở bảng/màn hình khác (iOS không trình bày 2 modal cùng lúc). */
const SHEET_HANDOFF_MS = 280;

export default function BrowserScreen() {
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  const { settings, prefsFor, setSitePref } = useSettings();
  const { record } = useStats();
  const { tabs, active, newTab, closeTab, patchTab, open, refs } = useTabs();

  const [addrFocused, setAddrFocused] = useState(false);
  const [shieldOpen, setShieldOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const hasPage = !active.home && !!active.url;
  const site = hasPage ? siteKey(active.url) : '';
  const prefs = prefsFor(site);
  const blocked = totalBlocked(active);
  const shieldOn = prefs.ads || prefs.gambling || prefs.popups;

  // Script chặn quảng cáo/chế độ tối dùng chung cho mọi thẻ
  const injectConfig = useMemo<InjectConfig>(
    () => ({ defaults: settings.shield, sites: settings.siteOverrides }),
    [settings.shield, settings.siteOverrides],
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
    if (active.home && active.sourceUrl) patchTab(active.id, { home: false });
    else webRef()?.goBack();
  };

  const goHome = () => patchTab(active.id, { home: true });
  const reload = () => webRef()?.reload();

  const openInNewTab = useCallback((url: string) => newTab(url), [newTab]);

  const share = () => {
    if (active.url) Share.share({ url: active.url, message: active.url }).catch(() => {});
  };

  const onDockPress = (id: DockButtonId) => {
    switch (id) {
      case 'back':
        return goBack();
      case 'forward':
        return webRef()?.goForward();
      case 'tabs':
        return router.push('/tabs');
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

  const canGoBack = active.home ? !!active.sourceUrl : active.canGoBack;
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
            insetBottom={webBottomInset}
          />
        ))}
        {active.home && (
          <NewTabPage
            onSubmit={go}
            onOpen={(url) => open(active.id, url)}
            paddingTop={0}
            paddingBottom={chromeBottom}
          />
        )}
      </View>

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
        />
      </View>

      <ShieldSheet
        visible={shieldOpen}
        onClose={() => setShieldOpen(false)}
        site={site}
        counts={blocked}
        prefs={prefs}
        onToggle={toggle}
        onReload={reload}
      />
      <MenuSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        hasPage={hasPage}
        dark={prefs.dark}
        onToggleDark={(v) => toggle('dark', v)}
        onAction={onMenuAction}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  webArea: { position: 'absolute', left: 0, right: 0 },
  statusCover: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.bg },
  addrWrap: { position: 'absolute', left: 16, right: 16 },
});
