import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NewTabPage } from '@/components/new-tab-page';
import { ToggleRow } from '@/components/toggle-row';
import { Txt } from '@/components/txt';
import { useSettings, type HomePrefs } from '@/state/settings';
import { colors, fg } from '@/theme';

const ITEMS: { key: keyof HomePrefs; icon: React.ComponentProps<typeof ToggleRow>['icon']; title: string }[] = [
  { key: 'logo', icon: 'shield-checkmark-outline', title: 'Logo Shield' },
  { key: 'title', icon: 'text-outline', title: 'Chữ "Ryx"' },
  { key: 'subtitle', icon: 'reorder-two-outline', title: 'Dòng chữ phụ' },
  { key: 'stats', icon: 'stats-chart-outline', title: 'Hộp "Đã chặn tuần này"' },
  { key: 'reading', icon: 'book-outline', title: 'Đọc tiếp' },
  { key: 'quick', icon: 'apps-outline', title: 'Truy cập nhanh' },
];

const noop = () => {};
const FRAME_W = 176;

/** Tuỳ chỉnh → Trang chủ: điện thoại thu nhỏ hiện trang chủ thật, bật/tắt từng phần thì thấy đổi ngay */
export function HomeCustomize() {
  const { settings, update } = useSettings();
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const s = FRAME_W / W;
  const set = (k: keyof HomePrefs, v: boolean) => update({ home: { ...settings.home, [k]: v } });

  return (
    <View>
      <View style={styles.phoneWrap}>
        <View
          style={[styles.phone, { width: FRAME_W, height: Math.round(H * s), backgroundColor: colors.bg }]}
          pointerEvents="none"
          accessibilityLabel="Xem trước trang chủ"
        >
          <View style={{ width: W, height: H, transformOrigin: 'left top', transform: [{ scale: s }] }}>
            <NewTabPage
              onSubmit={noop}
              onOpen={noop}
              onOpenNewTab={noop}
              paddingTop={insets.top}
              paddingBottom={0}
              preview
            />
          </View>
          {/* Dynamic Island cho giống điện thoại thật */}
          <View style={styles.island} />
        </View>
      </View>
      <Txt size={13} color={colors.textMuted} style={styles.note}>
        Ô tìm kiếm luôn hiện.
      </Txt>
      <View style={styles.card}>
        {ITEMS.map((it, i) => (
          <ToggleRow
            key={it.key}
            icon={it.icon}
            title={it.title}
            value={settings.home[it.key]}
            onChange={(v) => set(it.key, v)}
            last={i === ITEMS.length - 1}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  phoneWrap: { alignItems: 'center', marginTop: 4, marginBottom: 12 },
  phone: {
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 5,
    borderColor: fg(0.16),
  },
  island: {
    position: 'absolute',
    top: 7,
    alignSelf: 'center',
    width: 46,
    height: 13,
    borderRadius: 7,
    backgroundColor: '#000',
  },
  note: { textAlign: 'center', marginBottom: 12 },
  card: { borderRadius: 20, backgroundColor: colors.surface, overflow: 'hidden', paddingHorizontal: 14 },
});
