import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type DockStyle = 'floating' | 'compact' | 'attached';
export type AddressBarPosition = 'top' | 'bottom';
export type TabLayout = 'grid' | 'list' | 'stack' | 'carousel';
export type DockButtonId =
  | 'back'
  | 'forward'
  | 'tabs'
  | 'menu'
  | 'shield'
  | 'reload'
  | 'home'
  | 'share';

export interface ShieldPrefs {
  gambling: boolean;
  ads: boolean;
  popups: boolean;
  dark: boolean;
}

export interface Settings {
  dockStyle: DockStyle;
  addressBarPosition: AddressBarPosition;
  /** Kiểu hiển thị màn quản lý tab */
  tabLayout: TabLayout;
  accent: string;
  /** 0 = mờ đục nhất … 3 = trong nhất */
  glass: 0 | 1 | 2 | 3;
  dockButtons: DockButtonId[];
  shield: ShieldPrefs;
  siteOverrides: Record<string, Partial<ShieldPrefs>>;
  /** Ghi chi tiết trình phát video vào Nhật ký (chỉ bật khi cần dò lỗi) */
  diagVideo: boolean;
}

export const MAX_DOCK_BUTTONS = 5;

export const DEFAULT_SETTINGS: Settings = {
  dockStyle: 'floating',
  addressBarPosition: 'bottom',
  tabLayout: 'grid',
  accent: '#34D399',
  glass: 1,
  dockButtons: ['back', 'forward', 'tabs', 'menu'],
  shield: { gambling: true, ads: true, popups: true, dark: true },
  siteOverrides: {},
  diagVideo: false,
};

const STORAGE_KEY = 'ryx.settings.v1';

interface SettingsCtx {
  settings: Settings;
  ready: boolean;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
  prefsFor: (site: string) => ShieldPrefs;
  setSitePref: (site: string, key: keyof ShieldPrefs, value: boolean) => void;
}

const Ctx = createContext<SettingsCtx | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          const saved = JSON.parse(raw) as Partial<Settings>;
          setSettings({
            ...DEFAULT_SETTINGS,
            ...saved,
            shield: { ...DEFAULT_SETTINGS.shield, ...saved.shield },
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        loaded.current = true;
        setReady(true);
      });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings)).catch(() => {});
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

  const prefsFor = useCallback(
    (site: string): ShieldPrefs => ({ ...settings.shield, ...settings.siteOverrides[site] }),
    [settings.shield, settings.siteOverrides],
  );

  const setSitePref = useCallback((site: string, key: keyof ShieldPrefs, value: boolean) => {
    setSettings((s) => {
      if (!site) return { ...s, shield: { ...s.shield, [key]: value } };
      const current = { ...s.siteOverrides[site], [key]: value };
      // Bỏ ghi đè nếu trùng mặc định
      if (s.shield[key] === value) delete current[key];
      const siteOverrides = { ...s.siteOverrides };
      if (Object.keys(current).length) siteOverrides[site] = current;
      else delete siteOverrides[site];
      return { ...s, siteOverrides };
    });
  }, []);

  const value = useMemo(
    () => ({ settings, ready, update, reset, prefsFor, setSitePref }),
    [settings, ready, update, reset, prefsFor, setSitePref],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
