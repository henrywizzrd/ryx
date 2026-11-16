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
  /** Lần cuối được mở/chuyển tới (ms): màn các thẻ xếp theo cái này, gần nhất đứng đầu */
  lastUsed: number;
  /** Thuộc nhóm thẻ nào (Nhóm thẻ kiểu Safari) */
  groupId: string;
}

/** Nhóm thẻ kiểu Safari: mỗi nhóm có tên và các thẻ riêng; màn các thẻ chỉ hiện nhóm đang chọn */
export interface TabGroup {
  id: string;
  name: string;
}
export const MAIN_GROUP: TabGroup = { id: 'main', name: 'Thẻ' };

let seq = 0;
const newId = () => `tab-${Date.now().toString(36)}-${seq++}`;

export function makeTab(url: string | null = null, groupId = MAIN_GROUP.id): Tab {
  return {
    lastUsed: Date.now(),
    groupId,
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
  lastUsed?: number;
  groupId?: string;
}
interface Session {
  tabs: Tab[];
  active: string;
  groups: TabGroup[];
}
const sessionFile = () => new File(Paths.document, 'ryx-session.json');
function loadSession(): Session | null {
  try {
    const f = sessionFile();
    if (!f.exists) return null;
    const data = JSON.parse(f.textSync()) as { active?: string; tabs?: SavedTab[]; groups?: TabGroup[] };
    const saved = (data.tabs ?? []).filter((t) => t && typeof t.id === 'string').slice(0, 100);
    if (!saved.length) return null;
    const groups = [MAIN_GROUP, ...(data.groups ?? []).filter((g) => g && g.id && g.id !== MAIN_GROUP.id)];
    const gids = new Set(groups.map((g) => g.id));
    const active = saved.some((t) => t.id === data.active) ? data.active! : saved[saved.length - 1].id;
    const now = Date.now();
    const tabs = saved.map((t, i) => {
      const base = makeTab(null);
      return {
        ...base,
        id: t.id,
        url: t.url,
        title: t.title || (t.url ? '' : 'Thẻ mới'),
        home: t.home || !t.url,
        // Phiên cũ chưa có lastUsed: giữ thứ tự mở (thẻ mở sau coi như dùng gần hơn)
        lastUsed: t.lastUsed ?? now - (saved.length - i) * 1000,
        groupId: t.groupId && gids.has(t.groupId) ? t.groupId : MAIN_GROUP.id,
        // Chỉ thẻ đang mở nạp trang ngay
        sourceUrl: t.id === active && !t.home ? t.url : null,
        loading: t.id === active && !t.home && !!t.url,
      };
    });
    return { tabs, active, groups };
  } catch {
    return null;
  }
}
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveSession(tabs: Tab[], active: string, groups: TabGroup[]) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const f = sessionFile();
      if (!f.exists) f.create();
      const data = {
        active,
        groups: groups.filter((g) => g.id !== MAIN_GROUP.id),
        tabs: tabs.map((t) => ({
          id: t.id,
          url: t.url,
          title: t.title,
          home: t.home,
          lastUsed: t.lastUsed,
          groupId: t.groupId,
        })),
      };
      f.writeSync(JSON.stringify(data));
    } catch {
      // Ghi không được thì lần sau mở app chỉ mất phiên, không ảnh hưởng gì khác
    }
  }, 400);
}

/** Thẻ dùng gần nhất trước (màn các thẻ, chọn thẻ thay thế khi đóng) */
export const byRecent = (a: Tab, b: Tab) => b.lastUsed - a.lastUsed;

interface TabsCtx {
  /** Tất cả thẻ của mọi nhóm (WebView vẫn giữ sống khi đổi nhóm) */
  tabs: Tab[];
  /** Thẻ của nhóm đang chọn */
  groupTabs: Tab[];
  activeId: string;
  active: Tab;
  setActive: (id: string) => void;
  /** background: mở thẻ nhưng vẫn ở lại thẻ hiện tại */
  newTab: (url?: string | null, opts?: { background?: boolean }) => string;
  closeTab: (id: string) => void;
  /** Đóng mọi thẻ của nhóm đang chọn */
  closeAll: () => void;
  patchTab: (id: string, patch: Partial<Tab> | ((t: Tab) => Partial<Tab>)) => void;
  open: (id: string, url: string) => void;
  refs: React.MutableRefObject<Map<string, WebViewHandle | null>>;
  // ---- Nhóm thẻ ----
  groups: TabGroup[];
  group: TabGroup;
  /** Sang nhóm khác: mở lại thẻ dùng gần nhất của nhóm đó (nhóm trống thì tạo thẻ mới) */
  switchGroup: (id: string) => void;
  /** Tạo nhóm mới (kèm 1 thẻ mới) rồi chuyển sang; có moveTabId thì chuyển thẻ đó vào nhóm mới (ở lại nhóm cũ) */
  createGroup: (name: string, moveTabId?: string) => void;
  renameGroup: (id: string, name: string) => void;
  /** Xoá nhóm và đóng các thẻ của nó (không xoá được nhóm chính) */
  deleteGroup: (id: string) => void;
  /** Chuyển thẻ sang nhóm khác */
  moveTab: (tabId: string, groupId: string) => void;
}

const Ctx = createContext<TabsCtx | null>(null);

export function TabsProvider({ children }: { children: React.ReactNode }) {
  const [restored] = useState(loadSession);
  const [tabs, setTabs] = useState<Tab[]>(() => restored?.tabs ?? [makeTab()]);
  const [groups, setGroups] = useState<TabGroup[]>(() => restored?.groups ?? [MAIN_GROUP]);
  const [activeId, setActiveIdRaw] = useState<string>(() => restored?.active ?? tabs[0].id);
  const refs = useRef(new Map<string, WebViewHandle | null>());
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  /** Chuyển thẻ: ghi lần dùng (thứ tự gần nhất); thẻ khôi phục từ phiên cũ chưa nạp trang thì nạp lúc này */
  const setActiveId = useCallback((next: string | ((cur: string) => string)) => {
    setActiveIdRaw((cur) => {
      const id = typeof next === 'function' ? next(cur) : next;
      const now = Date.now();
      setTabs((list) =>
        list.map((x) => {
          if (x.id !== id) return x;
          const load = !x.sourceUrl && !x.home && x.url ? { sourceUrl: x.url, loading: true } : null;
          return { ...x, lastUsed: now, ...load };
        }),
      );
      return id;
    });
  }, []);

  const patchTab = useCallback<TabsCtx['patchTab']>((id, patch) => {
    setTabs((list) =>
      list.map((t) => (t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)),
    );
  }, []);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const groupId = active.groupId;
  const groupIdRef = useRef(groupId);
  useEffect(() => {
    groupIdRef.current = groupId;
  }, [groupId]);

  const newTab = useCallback(
    (url: string | null = null, opts?: { background?: boolean }) => {
      const tab = makeTab(url, groupIdRef.current);
      // Mở nền: đứng ngay sau thẻ đang mở trong thứ tự gần nhất (không chen lên đầu)
      if (opts?.background) tab.lastUsed = Date.now() - 1;
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
        const gone = list.find((t) => t.id === id);
        const next = list.filter((t) => t.id !== id);
        const gid = gone?.groupId ?? MAIN_GROUP.id;
        const sameGroup = next.filter((t) => t.groupId === gid).sort(byRecent);
        if (sameGroup.length === 0) {
          // Nhóm hết thẻ: tạo thẻ mới trong nhóm đó
          const fresh = makeTab(null, gid);
          setActiveId((cur) => (cur === id ? fresh.id : cur));
          return [...next, fresh];
        }
        // Đóng thẻ đang mở: sang thẻ dùng gần nhất của cùng nhóm
        setActiveId((cur) => (cur === id ? sameGroup[0].id : cur));
        return next;
      });
    },
    [setActiveId],
  );

  const closeAll = useCallback(() => {
    const gid = groupIdRef.current;
    const fresh = makeTab(null, gid);
    setTabs((list) => {
      list.filter((t) => t.groupId === gid).forEach((t) => refs.current.delete(t.id));
      return [...list.filter((t) => t.groupId !== gid), fresh];
    });
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

  // ---- Nhóm thẻ ----
  const switchGroup = useCallback(
    (gid: string) => {
      if (gid === groupIdRef.current) return;
      const recent = tabsRef.current.filter((t) => t.groupId === gid).sort(byRecent)[0];
      if (recent) {
        setActiveId(recent.id);
        return;
      }
      const fresh = makeTab(null, gid);
      setTabs((list) => [...list, fresh]);
      setActiveId(fresh.id);
    },
    [setActiveId],
  );

  const renameGroup = useCallback((gid: string, name: string) => {
    const n = name.trim();
    if (!n) return;
    setGroups((list) => list.map((g) => (g.id === gid ? { ...g, name: n } : g)));
  }, []);

  const deleteGroup = useCallback(
    (gid: string) => {
      if (gid === MAIN_GROUP.id) return;
      setGroups((list) => list.filter((g) => g.id !== gid));
      const rest = tabsRef.current.filter((t) => t.groupId !== gid);
      tabsRef.current.filter((t) => t.groupId === gid).forEach((t) => refs.current.delete(t.id));
      const main = rest.filter((t) => t.groupId === MAIN_GROUP.id).sort(byRecent)[0];
      if (main) {
        setTabs(rest);
        if (groupIdRef.current === gid) setActiveId(main.id);
      } else {
        const fresh = makeTab(null, MAIN_GROUP.id);
        setTabs([...rest, fresh]);
        if (groupIdRef.current === gid) setActiveId(fresh.id);
      }
    },
    [setActiveId],
  );

  const moveTab = useCallback(
    (tabId: string, gid: string) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab || tab.groupId === gid) return;
      const others = tabsRef.current.filter((t) => t.groupId === tab.groupId && t.id !== tabId).sort(byRecent);
      setTabs((list) => {
        const moved = list.map((t) => (t.id === tabId ? { ...t, groupId: gid } : t));
        // Nhóm cũ hết thẻ thì để lại 1 thẻ mới
        return others.length ? moved : [...moved, makeTab(null, tab.groupId)];
      });
      // Chuyển đi thẻ đang mở: ở lại nhóm cũ với thẻ gần nhất còn lại
      setActiveId((cur) => {
        if (cur !== tabId) return cur;
        if (others.length) return others[0].id;
        const fresh = tabsRef.current.find((t) => t.groupId === tab.groupId && t.id !== tabId);
        return fresh ? fresh.id : cur;
      });
    },
    [setActiveId],
  );

  const createGroup = useCallback(
    (name: string, moveTabId?: string) => {
      const g: TabGroup = { id: `grp-${Date.now().toString(36)}`, name: name.trim() || 'Nhóm mới' };
      setGroups((list) => [...list, g]);
      if (moveTabId) {
        moveTab(moveTabId, g.id);
        return;
      }
      const fresh = makeTab(null, g.id);
      setTabs((list) => [...list, fresh]);
      setActiveId(fresh.id);
    },
    [setActiveId, moveTab],
  );

  const groupTabs = useMemo(() => tabs.filter((t) => t.groupId === groupId), [tabs, groupId]);
  const group = groups.find((g) => g.id === groupId) ?? MAIN_GROUP;

  // Lưu phiên mỗi khi thẻ/địa chỉ/thẻ đang mở/nhóm đổi (gộp các lần đổi sát nhau)
  const sessionKey =
    tabs.map((t) => `${t.id}|${t.url ?? ''}|${t.home ? 1 : 0}|${t.title}|${t.groupId}|${t.lastUsed}`).join('\n') +
    '#' +
    active.id +
    '#' +
    groups.map((g) => `${g.id}:${g.name}`).join(',');
  const groupsRef = useRef(groups);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);
  useEffect(() => {
    saveSession(tabsRef.current, active.id, groupsRef.current);
  }, [sessionKey, active.id]);

  const value = useMemo(
    () => ({
      tabs,
      groupTabs,
      activeId: active.id,
      active,
      setActive: setActiveId,
      newTab,
      closeTab,
      closeAll,
      patchTab,
      open,
      refs,
      groups,
      group,
      switchGroup,
      createGroup,
      renameGroup,
      deleteGroup,
      moveTab,
    }),
    [
      tabs,
      groupTabs,
      active,
      setActiveId,
      newTab,
      closeTab,
      closeAll,
      patchTab,
      open,
      groups,
      group,
      switchGroup,
      createGroup,
      renameGroup,
      deleteGroup,
      moveTab,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTabs() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTabs must be used inside TabsProvider');
  return ctx;
}
