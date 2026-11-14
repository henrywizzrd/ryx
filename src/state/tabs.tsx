import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { File, Paths } from 'expo-file-system';

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

// ---- Ghi nhớ phiên: các thẻ đang mở được lưu lại, tắt hẳn app mở lại vẫn còn ----
// Đọc ĐỒNG BỘ lúc mở app (không chớp "Thẻ mới" rồi mới hiện thẻ cũ). Chỉ thẻ đang mở được nạp ngay;
// các thẻ khác nạp khi chuyển sang (đỡ tải cả chục trang một lúc).
interface SavedTab {
  id: string;
  url: string | null;
  title: string;
  home: boolean;
}
const sessionFile = () => new File(Paths.document, 'ryx-session.json');
function loadSession(): { tabs: Tab[]; active: string } | null {
  try {
    const f = sessionFile();
    if (!f.exists) return null;
    const data = JSON.parse(f.textSync()) as { active?: string; tabs?: SavedTab[] };
    const saved = (data.tabs ?? []).filter((t) => t && typeof t.id === 'string').slice(0, 50);
    if (!saved.length) return null;
    const active = saved.some((t) => t.id === data.active) ? data.active! : saved[saved.length - 1].id;
    const tabs = saved.map((t) => {
      const base = makeTab(null);
      return {
        ...base,
        id: t.id,
        url: t.url,
        title: t.title || (t.url ? '' : 'Thẻ mới'),
        home: t.home || !t.url,
        // Chỉ thẻ đang mở nạp trang ngay
        sourceUrl: t.id === active && !t.home ? t.url : null,
        loading: t.id === active && !t.home && !!t.url,
      };
    });
    return { tabs, active };
  } catch {
    return null;
  }
}
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveSession(tabs: Tab[], active: string) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const f = sessionFile();
      if (!f.exists) f.create();
      const data = { active, tabs: tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, home: t.home })) };
      f.writeSync(JSON.stringify(data));
    } catch {
      // Ghi không được thì lần sau mở app chỉ mất phiên, không ảnh hưởng gì khác
    }
  }, 400);
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
  const [restored] = useState(loadSession);
  const [tabs, setTabs] = useState<Tab[]>(() => restored?.tabs ?? [makeTab()]);
  const [activeId, setActiveIdRaw] = useState<string>(() => restored?.active ?? tabs[0].id);
  const refs = useRef(new Map<string, WebViewHandle | null>());
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  /** Chuyển thẻ; thẻ khôi phục từ phiên cũ chưa nạp trang thì nạp lúc này */
  const setActiveId = useCallback((next: string | ((cur: string) => string)) => {
    setActiveIdRaw((cur) => {
      const id = typeof next === 'function' ? next(cur) : next;
      const t = tabsRef.current.find((x) => x.id === id);
      if (t && !t.sourceUrl && !t.home && t.url) {
        const url = t.url;
        setTabs((list) => list.map((x) => (x.id === id ? { ...x, sourceUrl: url, loading: true } : x)));
      }
      return id;
    });
  }, []);

  const patchTab = useCallback<TabsCtx['patchTab']>((id, patch) => {
    setTabs((list) =>
      list.map((t) => (t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)),
    );
  }, []);

  const newTab = useCallback(
    (url: string | null = null, opts?: { background?: boolean }) => {
      const tab = makeTab(url);
      setTabs((list) => [...list, tab]);
      if (!opts?.background) setActiveId(tab.id);
      return tab.id;
    },
    [setActiveId],
  );

  const closeTab = useCallback(
    (id: string) => {
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
    },
    [setActiveId],
  );

  const closeAll = useCallback(() => {
    refs.current.clear();
    const fresh = makeTab();
    setTabs([fresh]);
    setActiveId(fresh.id);
  }, [setActiveId]);

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

  // Lưu phiên mỗi khi thẻ/địa chỉ/thẻ đang mở đổi (gộp các lần đổi sát nhau)
  const sessionKey =
    tabs.map((t) => `${t.id}|${t.url ?? ''}|${t.home ? 1 : 0}|${t.title}`).join('\n') + '#' + active.id;
  useEffect(() => {
    saveSession(tabsRef.current, active.id);
  }, [sessionKey, active.id]);

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
    [tabs, active, setActiveId, newTab, closeTab, closeAll, patchTab, open],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTabs() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTabs must be used inside TabsProvider');
  return ctx;
}
