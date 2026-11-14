import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';

import { useSettings } from '@/state/settings';

export type ThemeId = 'default' | 'matcha';
export type ThemeMode = 'dark' | 'light' | 'system';

export type Palette = {
  scheme: 'dark' | 'light';
  bg: string;
  bgDeep: string;
  surface: string;
  surfaceRaised: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  glassBorder: string;
  glassHighlight: string;
  /** r,g,b của lớp phủ trên kính */
  glassTint: string;
  /** r,g,b của lớp "chạm/viền mờ" (trắng trên nền tối, mực tối trên nền sáng) */
  fgRgb: string;
  danger: string;
  gambling: string;
  popups: string;
};

const PALETTES: Record<ThemeId, Record<'dark' | 'light', Palette>> = {
  default: {
    dark: {
      scheme: 'dark',
      bg: '#0A0D12',
      bgDeep: '#07090D',
      surface: '#121821',
      surfaceRaised: '#1A222D',
      text: '#F2F5F8',
      textMuted: '#9AA6B6',
      textFaint: '#7F8A9A',
      border: 'rgba(255,255,255,0.10)',
      glassBorder: 'rgba(255,255,255,0.16)',
      glassHighlight: 'rgba(255,255,255,0.07)',
      glassTint: '14,18,24',
      fgRgb: '255,255,255',
      danger: '#F87171',
      gambling: '#F59E0B',
      popups: '#A78BFA',
    },
    light: {
      scheme: 'light',
      bg: '#F4F6F9',
      bgDeep: '#E4E8EE',
      surface: '#FFFFFF',
      surfaceRaised: '#EBEEF3',
      text: '#0E141B',
      textMuted: '#556070',
      textFaint: '#687383',
      border: 'rgba(14,20,27,0.10)',
      glassBorder: 'rgba(14,20,27,0.10)',
      glassHighlight: 'rgba(255,255,255,0.65)',
      glassTint: '250,251,253',
      fgRgb: '14,20,27',
      danger: '#DC2626',
      gambling: '#B45309',
      popups: '#7C3AED',
    },
  },
  /** Matcha: xanh trà — bản tối nền trà đậm chữ kem, bản sáng nền kem sữa chữ trà */
  matcha: {
    dark: {
      scheme: 'dark',
      bg: '#0C110A',
      bgDeep: '#080B06',
      surface: '#151C11',
      surfaceRaised: '#1E2718',
      text: '#F2F4E9',
      textMuted: '#A9B49A',
      textFaint: '#8B967D',
      border: 'rgba(214,236,190,0.11)',
      glassBorder: 'rgba(214,236,190,0.18)',
      glassHighlight: 'rgba(226,242,204,0.08)',
      glassTint: '17,24,13',
      fgRgb: '226,242,204',
      danger: '#F87171',
      gambling: '#F59E0B',
      popups: '#A78BFA',
    },
    light: {
      scheme: 'light',
      bg: '#F3F5EA',
      bgDeep: '#E3E9D3',
      surface: '#FCFDF7',
      surfaceRaised: '#E8EDDA',
      text: '#1A2214',
      textMuted: '#56644A',
      textFaint: '#67745A',
      border: 'rgba(40,60,20,0.12)',
      glassBorder: 'rgba(40,60,20,0.12)',
      glassHighlight: 'rgba(255,255,255,0.65)',
      glassTint: '247,249,239',
      fgRgb: '26,34,20',
      danger: '#DC2626',
      gambling: '#B45309',
      popups: '#7C3AED',
    },
  },
};

export const THEMES: { id: ThemeId; label: string; accent: { dark: string; light: string } }[] = [
  { id: 'default', label: 'Mặc định', accent: { dark: '#34D399', light: '#059669' } },
  { id: 'matcha', label: 'Matcha', accent: { dark: '#9DC46B', light: '#5E8A2E' } },
];
export const MODES: { id: ThemeMode; label: string }[] = [
  { id: 'dark', label: 'Tối' },
  { id: 'light', label: 'Sáng' },
  { id: 'system', label: 'Theo máy' },
];

// Giao diện đọc ĐỒNG BỘ lúc mở app (để khung hình đầu đã đúng màu), sau đó đổi được ngay không cần mở lại app:
// setAppearance() tạo bảng màu mới, mọi màn đọc màu qua useTheme()/useStyles() nên tự vẽ lại.
const themeFile = () => new File(Paths.document, 'ryx-theme.txt');
function loadAppearance(): { theme: ThemeId; mode: ThemeMode } {
  const out: { theme: ThemeId; mode: ThemeMode } = { theme: 'default', mode: 'dark' };
  try {
    const f = themeFile();
    if (f.exists) {
      const [t, m] = f.textSync().trim().split(':');
      if (t === 'matcha' || t === 'default') out.theme = t;
      if (m === 'light' || m === 'system' || m === 'dark') out.mode = m;
    }
  } catch {}
  return out;
}
function saveAppearance(theme: ThemeId, mode: ThemeMode) {
  const f = themeFile();
  if (!f.exists) f.create();
  f.writeSync(`${theme}:${mode}`);
}
const schemeOf = (mode: ThemeMode): 'dark' | 'light' =>
  mode === 'system' ? (Appearance.getColorScheme() === 'light' ? 'light' : 'dark') : mode;

export interface ThemeState {
  theme: ThemeId;
  mode: ThemeMode;
  /** Sáng hay tối thực tế ("Theo máy" lấy theo máy lúc chọn) */
  scheme: 'dark' | 'light';
  colors: Palette;
  /** Lớp mờ theo màu chữ của giao diện (thay cho rgba trắng cố định) */
  fg: (alpha: number) => string;
  /** Nhãn nút đưa trang về cùng kiểu với app (lib/inject: DARK_CSS/LIGHT_CSS) */
  pageModeLabel: string;
  pageModeIcon: 'sunny-outline' | 'moon-outline';
}
function build(theme: ThemeId, mode: ThemeMode): ThemeState {
  const scheme = schemeOf(mode);
  const colors: Palette = { ...PALETTES[theme][scheme] };
  return {
    theme,
    mode,
    scheme,
    colors,
    fg: (alpha: number) => `rgba(${colors.fgRgb},${alpha})`,
    pageModeLabel: scheme === 'light' ? 'Chế độ sáng' : 'Chế độ tối',
    pageModeIcon: scheme === 'light' ? 'sunny-outline' : 'moon-outline',
  };
}
// Ép giao diện hệ thống của app theo chế độ đang dùng: thanh trạng thái (giờ, pin) đổi sang chữ tối ở chế độ sáng,
// bảng chọn/thông báo của iOS cũng sáng/tối theo. ("Theo máy" thì để iOS tự quyết.)
function applySystem(t: ThemeState) {
  try {
    Appearance.setColorScheme(t.mode === 'system' ? 'auto' : t.scheme);
  } catch {}
}

const initial = loadAppearance();
let current = build(initial.theme, initial.mode);
applySystem(current);
const listeners = new Set<() => void>();

/** Giao diện hiện tại (dùng ngoài React; trong component dùng useTheme) */
export function getTheme(): ThemeState {
  return current;
}
export function subscribeTheme(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
/** Gọi ngay trước khi đổi màu (chụp màn hình làm hiệu ứng chuyển, xem components/theme-fade) */
let beforeChange: (() => Promise<void>) | null = null;
export function setBeforeThemeChange(fn: (() => Promise<void>) | null) {
  beforeChange = fn;
}
/** Đổi giao diện ngay, không mở lại app */
export async function setAppearance(theme: ThemeId, mode: ThemeMode): Promise<void> {
  if (theme === current.theme && mode === current.mode) return;
  saveAppearance(theme, mode);
  try {
    await beforeChange?.();
  } catch {}
  current = build(theme, mode);
  applySystem(current);
  listeners.forEach((l) => l());
}

/** Màu nhấn gợi ý cho giao diện + chế độ */
export function themeAccent(theme: ThemeId, mode: ThemeMode): string {
  return THEMES.find((t) => t.id === theme)!.accent[schemeOf(mode)];
}

/** Be Vietnam Pro: hỗ trợ đầy đủ dấu tiếng Việt. */
export const fonts = {
  regular: 'BeVietnamPro_400Regular',
  medium: 'BeVietnamPro_500Medium',
  semibold: 'BeVietnamPro_600SemiBold',
  bold: 'BeVietnamPro_700Bold',
};

export const ACCENT_PRESETS = ['#34D399', '#9DC46B', '#38BDF8', '#818CF8', '#F472B6', '#FBBF24', '#FB7185'];

/** Lớp phủ tối & cường độ làm mờ theo mức trong suốt (0 = đục, 3 = trong). */
const GLASS_LEVELS = [
  { overlay: 0.82, intensity: 90 },
  { overlay: 0.6, intensity: 80 },
  { overlay: 0.4, intensity: 70 },
  { overlay: 0.2, intensity: 60 },
] as const;

export const GLASS_LABELS = ['Đục', 'Vừa', 'Trong', 'Rất trong'];

/** Chữ tối trên màu nhấn sáng để đạt độ tương phản ≥ 4.5:1. */
export function onAccent(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return l > 0.3 ? '#05140E' : '#FFFFFF';
}

export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function useThemeState(): ThemeState {
  return useSyncExternalStore(subscribeTheme, getTheme);
}

export function useTheme() {
  const t = useThemeState();
  const { settings } = useSettings();
  const glass = GLASS_LEVELS[settings.glass];
  return {
    ...t,
    fonts,
    accent: settings.accent,
    onAccent: onAccent(settings.accent),
    accentSoft: withAlpha(settings.accent, 0.16),
    glass,
  };
}

/**
 * StyleSheet theo giao diện: khai báo `const makeStyles = (colors, fg) => StyleSheet.create({...})` ở ngoài,
 * trong component gọi `const styles = useStyles(makeStyles)`. Mỗi giao diện chỉ tạo 1 lần (có bộ nhớ đệm).
 */
const styleCache = new WeakMap<ThemeState, Map<unknown, unknown>>();
export function useStyles<T>(make: (colors: Palette, fg: (alpha: number) => string) => T): T {
  const t = useThemeState();
  let m = styleCache.get(t);
  if (!m) styleCache.set(t, (m = new Map()));
  if (!m.has(make)) m.set(make, make(t.colors, t.fg));
  return m.get(make) as T;
}
