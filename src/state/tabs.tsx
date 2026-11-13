import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { WebViewHandle } from '@/components/browser-tab';

import { EMPTY_COUNTS, type Counts } from './stats';

export interface Tab {
  id: string;
  /** URL lần đầu nạp vào WebView (null = chưa từng mở trang nào). */
  sourceUrl: string | null;
  /** URL hiện tại của trang. */
  url: string | null;
  title: string;
  /** Đang hiển thị trang Thẻ mới thay vì WebView. */
  home: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  progress: number;
  /** Chặn do điều hướng (onShouldStartLoadWithRequest). */
  navCounts: Counts;
  /** Chặn do script trong trang (phần tử bị ẩn, pop-up). */
  pageCounts: Counts;
  /** Ảnh chụp thu nhỏ của trang (file tạm) cho màn quản lý thẻ. */
  thumb?: string;
  /** Ảnh chụp ứng với trạng thái nào của thẻ (`home|url`); lệch thì không dùng ảnh nữa */
  thumbKey?: string;
}

let seq = 0;
const newId = () => `tab-${Date.now().toString(36)}-${seq++}`;

export function makeTab(url: string | null = null): Tab {
  return {
    id: newId(),
    sourceUrl: url,
    url,
    title: url ? '' : 'Thẻ mới',
    home: !url,
    canGoBack: false,
    canGoForward: false,
    loading: !!url,
    progress: 0,
    navCounts: { ...EMPTY_COUNTS },
    pageCounts: { ...EMPTY_COUNTS },
  };
}

export function totalBlocked(tab: Tab): Counts & { total: number } {
  const c = {
    ads: tab.navCounts.ads + tab.pageCounts.ads,
    gambling: tab.navCounts.gambling + tab.pageCounts.gambling,
    popups: tab.navCounts.popups + tab.pageCounts.popups,
  };
  return { ...c, total: c.ads + c.gambling + c.popups };
}

interface TabsCtx {
  tabs: Tab[];
  activeId: string;
  active: Tab;
  setActive: (id: string) => void;
  /** background: mở thẻ nhưng vẫn ở lại thẻ hiện tại */
  newTab: (url?: string | null, opts?: { background?: boolean }) => string;
  closeTab: (id: string) => void;
  closeAll: () => void;
  patchTab: (id: string, patch: Partial<Tab> | ((t: Tab) => Partial<Tab>)) => void;
  open: (id: string, url: string) => void;
  refs: React.MutableRefObject<Map<string, WebViewHandle | null>>;
}

const Ctx = createContext<TabsCtx | null>(null);

export function TabsProvider({ children }: { children: React.ReactNode }) {
  const [tabs, setTabs] = useState<Tab[]>(() => [makeTab()]);
  const [activeId, setActiveId] = useState<string>(() => tabs[0].id);
  const refs = useRef(new Map<string, WebViewHandle | null>());
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const patchTab = useCallback<TabsCtx['patchTab']>((id, patch) => {
    setTabs((list) =>
      list.map((t) => (t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)),
    );
  }, []);

  const newTab = useCallback((url: string | null = null, opts?: { background?: boolean }) => {
    const tab = makeTab(url);
    setTabs((list) => [...list, tab]);
    if (!opts?.background) setActiveId(tab.id);
    return tab.id;
  }, []);

  const closeTab = useCallback((id: string) => {
    refs.current.delete(id);
    setTabs((list) => {
      const idx = list.findIndex((t) => t.id === id);
      const next = list.filter((t) => t.id !== id);
      if (next.length === 0) {
        const fresh = makeTab();
        setActiveId(fresh.id);
        return [fresh];
      }
      setActiveId((cur) => (cur === id ? next[Math.max(0, idx - 1)].id : cur));
      return next;
    });
  }, []);

  const closeAll = useCallback(() => {
    refs.current.clear();
    const fresh = makeTab();
    setTabs([fresh]);
    setActiveId(fresh.id);
  }, []);

  /** Mở URL trong một thẻ (giữ lịch sử nếu WebView đã tồn tại). */
  const open = useCallback(
    (id: string, url: string) => {
      const ref = refs.current.get(id);
      const tab = tabsRef.current.find((t) => t.id === id);
      if (tab?.sourceUrl && ref) {
        ref.injectJavaScript(`window.location.href = ${JSON.stringify(url)}; true;`);
        patchTab(id, { home: false, url, loading: true, progress: 0.05 });
      } else {
        patchTab(id, { home: false, sourceUrl: url, url, loading: true, progress: 0.05 });
      }
    },
    [patchTab],
  );

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  const value = useMemo(
    () => ({
      tabs,
      activeId: active.id,
      active,
      setActive: setActiveId,
      newTab,
      closeTab,
      closeAll,
      patchTab,
      open,
      refs,
    }),
    [tabs, active, newTab, closeTab, closeAll, patchTab, open],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTabs() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTabs must be used inside TabsProvider');
  return ctx;
}
