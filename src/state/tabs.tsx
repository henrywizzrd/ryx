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
  /** Mép trên của trang (dưới giờ/pin) đang tối? Script trong trang đo rồi báo; chưa biết thì theo giao diện app */
  topDark?: boolean;
  /** Lần cuối được mở/chuyển tới (ms): màn các thẻ xếp theo cái này, gần nhất đứng đầu */
  lastUsed: number;
  /** Nằm trong khung nào (Khung thẻ kiểu Cốc Cốc); null = thẻ lẻ */
  folderId: string | null;
}

/** Khung thẻ kiểu Cốc Cốc: kéo thẻ đè lên thẻ khác thì gộp thành khung (như thư mục ở màn hình chính iPhone) */
export interface TabFolder {
  id: string;
  name: string;
}

let seq = 0;
const newId = () => `tab-${Date.now().toString(36)}-${seq++}`;

/** Thẻ chưa nạp trang: chờ hiệu ứng chuyển thẻ (thu nhỏ/phóng to, nảy dock) chạy xong rồi mới dựng WebView */
const LOAD_AFTER_SWITCH_MS = 520;

export function makeTab(url: string | null = null, folderId: string | null = null): Tab {
  return {
    lastUsed: Date.now(),
    folderId,
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
  folderId?: string | null;
}
/** Thẻ vừa đóng (để mở lại). Các thẻ đóng cùng lúc ("Đóng tất cả") chung một `batch`. */
export interface ClosedTab {
  id: string;
  batch: string;
  url: string;
  title: string;
  folderId: string | null;
  folderName: string | null;
  closedAt: number;
}
const MAX_CLOSED = 20;

interface Session {
  tabs: Tab[];
  active: string;
  folders: TabFolder[];
  folderMode: string | null;
  closed: ClosedTab[];
}
const sessionFile = () => new File(Paths.document, 'ryx-session.json');
function loadSession(): Session | null {
  try {
    const f = sessionFile();
    if (!f.exists) return null;
    const data = JSON.parse(f.textSync()) as {
      active?: string;
      tabs?: SavedTab[];
      folders?: TabFolder[];
      folderMode?: string | null;
      closed?: ClosedTab[];
    };
    const closed = (data.closed ?? []).filter((c) => c && c.url && c.batch).slice(0, MAX_CLOSED);
    const saved = (data.tabs ?? []).filter((t) => t && typeof t.id === 'string').slice(0, 100);
    if (!saved.length)
      return closed.length ? { tabs: [makeTab()], active: '', folders: [], folderMode: null, closed } : null;
    const active = saved.some((t) => t.id === data.active) ? data.active! : saved[saved.length - 1].id;
    const now = Date.now();
    let tabs: Tab[] = saved.map((t, i) => {
      const base = makeTab(null);
      return {
        ...base,
        id: t.id,
        url: t.url,
        title: t.title || (t.url ? '' : 'Thẻ mới'),
        home: t.home || !t.url,
        // Phiên cũ chưa có lastUsed: giữ thứ tự mở (thẻ mở sau coi như dùng gần hơn)
        lastUsed: t.lastUsed ?? now - (saved.length - i) * 1000,
        folderId: t.folderId ?? null,
        // Chỉ thẻ đang mở nạp trang ngay
        sourceUrl: t.id === active && !t.home ? t.url : null,
        loading: t.id === active && !t.home && !!t.url,
      };
    });
    // Khung chỉ hợp lệ khi còn từ 2 thẻ (bản cũ có "nhóm thẻ" thì bỏ, thẻ thành thẻ lẻ)
    let folders = (data.folders ?? []).filter((g) => g && g.id && g.name);
    folders = folders.filter((g) => tabs.filter((t) => t.folderId === g.id).length >= 2);
    const ok = new Set(folders.map((g) => g.id));
    tabs = tabs.map((t) => (t.folderId && !ok.has(t.folderId) ? { ...t, folderId: null } : t));
    const folderMode = data.folderMode && ok.has(data.folderMode) ? data.folderMode : null;
    return { tabs, active, folders, folderMode, closed };
  } catch {
    return null;
  }
}
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveSession(
  tabs: Tab[],
  active: string,
  folders: TabFolder[],
  folderMode: string | null,
  closed: ClosedTab[],
) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const f = sessionFile();
      if (!f.exists) f.create();
      const data = {
        active,
        folders,
        folderMode,
        closed,
        tabs: tabs.map((t) => ({
          id: t.id,
          url: t.url,
          title: t.title,
          home: t.home,
          lastUsed: t.lastUsed,
          folderId: t.folderId,
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

/** Tên khung tự đặt: cùng một trang thì lấy tên trang (vd "xnhau"), khác trang thì "Nhóm N" */
function autoFolderName(list: Tab[], n: number): string {
  const hosts = list.map((t) => {
    if (!t.url) return 'Thẻ mới';
    try {
      const h = new URL(t.url).hostname.replace(/^www\./, '');
      return h.split('.').slice(0, -1).join('.') || h;
    } catch {
      return '';
    }
  });
  return hosts[0] && hosts.every((h) => h === hosts[0]) ? hosts[0] : `Nhóm ${n}`;
}

interface TabsCtx {
  /** Tất cả thẻ (WebView vẫn giữ sống) */
  tabs: Tab[];
  /** Thẻ đang hiện ở màn các thẻ: chế độ khung thì chỉ thẻ của khung, không thì tất cả */
  visibleTabs: Tab[];
  activeId: string;
  active: Tab;
  setActive: (id: string) => void;
  /** background: mở thẻ nhưng vẫn ở lại thẻ hiện tại */
  newTab: (url?: string | null, opts?: { background?: boolean }) => string;
  closeTab: (id: string) => string | null;
  /** Đóng mọi thẻ (chế độ khung: mọi thẻ của khung) */
  closeAll: () => string | null;
  patchTab: (id: string, patch: Partial<Tab> | ((t: Tab) => Partial<Tab>)) => void;
  open: (id: string, url: string) => void;
  refs: React.MutableRefObject<Map<string, WebViewHandle | null>>;
  // ---- Khung thẻ ----
  folders: TabFolder[];
  /** Đang ở chế độ khung (vào trang từ trong khung): id khung, null = bình thường */
  folderMode: string | null;
  setFolderMode: (id: string | null) => void;
  /** Kéo thẻ `dragId` thả lên thẻ hoặc khung `targetId` */
  merge: (dragId: string, targetId: string) => void;
  /** Bỏ thẻ ra khỏi khung (khung còn 1 thẻ thì tự tan) */
  unfold: (tabId: string) => void;
  renameFolder: (id: string, name: string) => void;
  // ---- Thẻ vừa đóng ----
  /** Mới đóng trước, tối đa 20 thẻ */
  closed: ClosedTab[];
  /** Mở lại cả lượt đóng (một thẻ, hoặc mọi thẻ của một lần "Đóng tất cả") */
  reopenBatch: (batch: string) => void;
  /** Mở lại một thẻ trong danh sách */
  reopenOne: (id: string) => void;
}

const Ctx = createContext<TabsCtx | null>(null);

export function TabsProvider({ children }: { children: React.ReactNode }) {
  const [restored] = useState(loadSession);
  const [tabs, setTabs] = useState<Tab[]>(() => restored?.tabs ?? [makeTab()]);
  const [folders, setFolders] = useState<TabFolder[]>(() => restored?.folders ?? []);
  const [folderMode, setFolderModeRaw] = useState<string | null>(() => restored?.folderMode ?? null);
  const [activeId, setActiveIdRaw] = useState<string>(() => restored?.active || tabs[0].id);
  const [closed, setClosed] = useState<ClosedTab[]>(() => restored?.closed ?? []);
  const closedRef = useRef(closed);
  useEffect(() => {
    closedRef.current = closed;
  }, [closed]);
  const refs = useRef(new Map<string, WebViewHandle | null>());
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  const foldersRef = useRef(folders);
  const folderModeRef = useRef(folderMode);
  useEffect(() => {
    foldersRef.current = folders;
    folderModeRef.current = folderMode;
  }, [folders, folderMode]);

  /** Chuyển thẻ: ghi lần dùng (thứ tự gần nhất); thẻ chưa nạp trang (khôi phục từ phiên cũ / mở nền) thì nạp sau
   *  khi hiệu ứng chuyển thẻ chạy xong — dựng WebView ngay lúc trang đang bay ra làm giao diện đứng hình 1–2 giây */
  const pendingLoad = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setActiveId = useCallback((next: string | ((cur: string) => string)) => {
    setActiveIdRaw((cur) => {
      const id = typeof next === 'function' ? next(cur) : next;
      const now = Date.now();
      setTabs((list) =>
        list.map((x) => {
          if (x.id !== id) return x;
          // Thẻ chưa nạp: hiện thanh tiến trình ngay, còn WebView dựng sau
          const cold = !x.sourceUrl && !x.home && x.url ? { loading: true, progress: 0.05 } : null;
          return { ...x, lastUsed: now, ...cold };
        }),
      );
      // Lướt nhanh qua nhiều thẻ thì chỉ nạp thẻ dừng lại cuối cùng
      if (pendingLoad.current) clearTimeout(pendingLoad.current);
      pendingLoad.current = setTimeout(() => {
        pendingLoad.current = null;
        setTabs((list) =>
          list.map((x) =>
            x.id === id && !x.sourceUrl && !x.home && x.url ? { ...x, sourceUrl: x.url, loading: true } : x,
          ),
        );
      }, LOAD_AFTER_SWITCH_MS);
      return id;
    });
  }, []);

  const patchTab = useCallback<TabsCtx['patchTab']>((id, patch) => {
    setTabs((list) =>
      list.map((t) => (t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)),
    );
  }, []);

  /** Khung còn dưới 2 thẻ thì tan (thẻ còn lại thành thẻ lẻ); đang ở chế độ khung đó thì thoát */
  const tidy = useCallback((list: Tab[]): Tab[] => {
    const count = new Map<string, number>();
    list.forEach((t) => t.folderId && count.set(t.folderId, (count.get(t.folderId) ?? 0) + 1));
    const dead = foldersRef.current.filter((f) => (count.get(f.id) ?? 0) < 2).map((f) => f.id);
    if (!dead.length) return list;
    setFolders((fs) => fs.filter((f) => !dead.includes(f.id)));
    if (folderModeRef.current && dead.includes(folderModeRef.current)) setFolderModeRaw(null);
    return list.map((t) => (t.folderId && dead.includes(t.folderId) ? { ...t, folderId: null } : t));
  }, []);

  const newTab = useCallback(
    (url: string | null = null, opts?: { background?: boolean }) => {
      // Chế độ khung: thẻ mới vào luôn khung đó
      const tab = makeTab(url, folderModeRef.current);
      // Mở nền: đứng ngay sau thẻ đang mở trong thứ tự gần nhất (không chen lên đầu)
      if (opts?.background) {
        tab.lastUsed = Date.now() - 1;
        // Mở nền: chưa dựng WebView ngay (dựng WebView + nạp script + tải trang làm giao diện khựng 1–2 giây ngay
        // lúc menu đang đóng). Nạp khi người dùng mở tới thẻ, giống thẻ khôi phục từ phiên cũ (xem setActiveId).
        if (url) {
          tab.sourceUrl = null;
          tab.loading = false;
        }
      }
      setTabs((list) => [...list, tab]);
      if (!opts?.background) setActiveId(tab.id);
      return tab.id;
    },
    [setActiveId],
  );

  /** Ghi các thẻ sắp đóng vào danh sách "vừa đóng"; trả về mã lượt đóng (null nếu toàn thẻ trống) */
  const remember = useCallback((list: Tab[]): string | null => {
    const real = list.filter((t) => !t.home && t.url);
    if (!real.length) return null;
    const batch = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const now = Date.now();
    const items: ClosedTab[] = [...real].sort(byRecent).map((t, i) => ({
      id: `${batch}-${i}`,
      batch,
      url: t.url!,
      title: t.title || t.url!,
      folderId: t.folderId,
      folderName: foldersRef.current.find((f) => f.id === t.folderId)?.name ?? null,
      closedAt: now,
    }));
    setClosed((cs) => [...items, ...cs].slice(0, MAX_CLOSED));
    return batch;
  }, []);

  /** Mở lại các thẻ đã đóng: vào lại khung cũ (khung đã tan mà mở lại từ 2 thẻ trở lên thì dựng lại khung) */
  const reopenItems = useCallback(
    (items: ClosedTab[]) => {
      if (!items.length) return;
      const ids = new Set(items.map((c) => c.id));
      setClosed((cs) => cs.filter((c) => !ids.has(c.id)));
      const have = new Set(foldersRef.current.map((f) => f.id));
      const count = new Map<string, number>();
      items.forEach((c) => c.folderId && count.set(c.folderId, (count.get(c.folderId) ?? 0) + 1));
      const revive: TabFolder[] = [];
      count.forEach((n, fid) => {
        if (!have.has(fid) && n >= 2)
          revive.push({ id: fid, name: items.find((c) => c.folderId === fid)?.folderName ?? 'Nhóm' });
      });
      if (revive.length) {
        foldersRef.current = [...foldersRef.current, ...revive];
        setFolders((fs) => [...fs, ...revive]);
      }
      const ok = new Set(foldersRef.current.map((f) => f.id));
      const now = Date.now();
      // Chỉ thẻ đầu (mới đóng nhất) nạp trang ngay, các thẻ khác nạp khi được mở tới
      const back: Tab[] = items.map((c, i) => ({
        ...makeTab(c.url, c.folderId && ok.has(c.folderId) ? c.folderId : null),
        sourceUrl: null,
        loading: false,
        title: c.title,
        lastUsed: now - i,
      }));
      const fm = folderModeRef.current;
      if (fm && back[0].folderId !== fm) setFolderModeRaw(null);
      // Bỏ thẻ trống do "Đóng tất cả" tạo ra (nếu chỉ còn mình nó)
      setTabs((l) => (l.length === 1 && l[0].home && !l[0].url ? [...back] : [...l, ...back]));
      setActiveId(back[0].id);
    },
    [setActiveId],
  );
  const reopenBatch = useCallback(
    (batch: string) => reopenItems(closedRef.current.filter((c) => c.batch === batch)),
    [reopenItems],
  );
  const reopenOne = useCallback(
    (id: string) => reopenItems(closedRef.current.filter((c) => c.id === id)),
    [reopenItems],
  );

  const closeTab = useCallback(
    (id: string) => {
      const gone = tabsRef.current.find((t) => t.id === id);
      const batch = remember(gone ? [gone] : []);
      refs.current.delete(id);
      setTabs((list) => {
        const gone = list.find((t) => t.id === id);
        const next = tidy(list.filter((t) => t.id !== id));
        if (next.length === 0) {
          const fresh = makeTab();
          setActiveId(fresh.id);
          return [fresh];
        }
        // Đóng thẻ đang mở: sang thẻ dùng gần nhất (ở chế độ khung thì ưu tiên thẻ cùng khung)
        const same = gone?.folderId ? next.filter((t) => t.folderId === gone.folderId).sort(byRecent) : [];
        const pick = same[0] ?? [...next].sort(byRecent)[0];
        setActiveId((cur) => (cur === id ? pick.id : cur));
        return next;
      });
      return batch;
    },
    [setActiveId, tidy, remember],
  );

  const closeAll = useCallback((): string | null => {
    const fm = folderModeRef.current;
    const batch = remember(fm ? tabsRef.current.filter((t) => t.folderId === fm) : tabsRef.current);
    if (fm) {
      // Chế độ khung: đóng các thẻ của khung, ra lại màn tất cả thẻ
      setTabs((list) => {
        list.filter((t) => t.folderId === fm).forEach((t) => refs.current.delete(t.id));
        const rest = list.filter((t) => t.folderId !== fm);
        if (rest.length) {
          setActiveId([...rest].sort(byRecent)[0].id);
          return rest;
        }
        const fresh = makeTab();
        setActiveId(fresh.id);
        return [fresh];
      });
      setFolders((fs) => fs.filter((f) => f.id !== fm));
      setFolderModeRaw(null);
      return batch;
    }
    refs.current.clear();
    const fresh = makeTab();
    setTabs([fresh]);
    setFolders([]);
    setActiveId(fresh.id);
    return batch;
  }, [setActiveId, remember]);

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

  // ---- Khung thẻ ----
  const setFolderMode = useCallback((id: string | null) => setFolderModeRaw(id), []);

  const merge = useCallback(
    (dragId: string, targetId: string) => {
      if (dragId === targetId) return;
      const list = tabsRef.current;
      const drag = list.find((t) => t.id === dragId);
      if (!drag) return; // kéo cả khung thả lên thứ khác: không làm gì
      const folder = foldersRef.current.find((f) => f.id === targetId);
      const target = list.find((t) => t.id === targetId);
      // Thả lên khung, hoặc lên thẻ đang nằm trong khung (thẻ lớn ở Chia đôi): vào khung đó
      const fid = folder?.id ?? target?.folderId ?? null;
      if (fid) {
        if (drag.folderId === fid) return;
        setTabs((l) => tidy(l.map((t) => (t.id === dragId ? { ...t, folderId: fid } : t))));
        return;
      }
      if (!target) return;
      const f: TabFolder = {
        id: `fold-${Date.now().toString(36)}`,
        name: autoFolderName([target, drag], foldersRef.current.length + 1),
      };
      setFolders((fs) => [...fs, f]);
      foldersRef.current = [...foldersRef.current, f];
      setTabs((l) => tidy(l.map((t) => (t.id === dragId || t.id === targetId ? { ...t, folderId: f.id } : t))));
    },
    [tidy],
  );

  const unfold = useCallback(
    (tabId: string) => {
      setTabs((l) => tidy(l.map((t) => (t.id === tabId ? { ...t, folderId: null } : t))));
    },
    [tidy],
  );

  const renameFolder = useCallback((id: string, name: string) => {
    const n = name.trim();
    if (!n) return;
    setFolders((fs) => fs.map((f) => (f.id === id ? { ...f, name: n } : f)));
  }, []);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const visibleTabs = useMemo(
    () => (folderMode ? tabs.filter((t) => t.folderId === folderMode) : tabs),
    [tabs, folderMode],
  );

  // Lưu phiên mỗi khi thẻ/địa chỉ/thẻ đang mở/khung đổi (gộp các lần đổi sát nhau)
  const sessionKey =
    tabs.map((t) => `${t.id}|${t.url ?? ''}|${t.home ? 1 : 0}|${t.title}|${t.folderId}|${t.lastUsed}`).join('\n') +
    '#' +
    active.id +
    '#' +
    folders.map((g) => `${g.id}:${g.name}`).join(',') +
    '#' +
    folderMode +
    '#' +
    closed.map((c) => c.id).join(',');
  useEffect(() => {
    saveSession(tabsRef.current, active.id, foldersRef.current, folderModeRef.current, closedRef.current);
  }, [sessionKey, active.id]);

  const value = useMemo(
    () => ({
      tabs,
      visibleTabs,
      activeId: active.id,
      active,
      setActive: setActiveId,
      newTab,
      closeTab,
      closeAll,
      patchTab,
      open,
      refs,
      folders,
      folderMode,
      setFolderMode,
      merge,
      unfold,
      renameFolder,
      closed,
      reopenBatch,
      reopenOne,
    }),
    [
      tabs,
      visibleTabs,
      active,
      setActiveId,
      newTab,
      closeTab,
      closeAll,
      patchTab,
      open,
      folders,
      folderMode,
      setFolderMode,
      merge,
      unfold,
      renameFolder,
      closed,
      reopenBatch,
      reopenOne,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTabs() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTabs must be used inside TabsProvider');
  return ctx;
}
