import { useSettings } from '@/state/settings';

export const colors = {
  bg: '#0A0D12',
  surface: '#121821',
  surfaceRaised: '#1A222D',
  text: '#F2F5F8',
  textMuted: '#9AA6B6',
  textFaint: '#7F8A9A',
  border: 'rgba(255,255,255,0.10)',
  glassBorder: 'rgba(255,255,255,0.16)',
  glassHighlight: 'rgba(255,255,255,0.07)',
  danger: '#F87171',
  gambling: '#F59E0B',
  popups: '#A78BFA',
};

/** Be Vietnam Pro: hỗ trợ đầy đủ dấu tiếng Việt. */
export const fonts = {
  regular: 'BeVietnamPro_400Regular',
  medium: 'BeVietnamPro_500Medium',
  semibold: 'BeVietnamPro_600SemiBold',
  bold: 'BeVietnamPro_700Bold',
};

export const ACCENT_PRESETS = ['#34D399', '#38BDF8', '#818CF8', '#F472B6', '#FBBF24', '#FB7185'];

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

export function useTheme() {
  const { settings } = useSettings();
  const glass = GLASS_LEVELS[settings.glass];
  return {
    colors,
    fonts,
    accent: settings.accent,
    onAccent: onAccent(settings.accent),
    accentSoft: withAlpha(settings.accent, 0.16),
    glass,
  };
}
