import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import type { ShieldPrefs } from '@/state/settings';
import type { Counts } from '@/state/stats';
import { colors, useTheme } from '@/theme';
import { Sheet } from './sheet';
import { ToggleRow } from './toggle-row';
import { Txt } from './txt';

interface Props {
  visible: boolean;
  onClose: () => void;
  site: string;
  counts: Counts & { total: number };
  prefs: ShieldPrefs;
  onToggle: (key: keyof ShieldPrefs, value: boolean) => void;
  onReload: () => void;
}

export function ShieldSheet({ visible, onClose, site, counts, prefs, onToggle, onReload }: Props) {
  const { accent, accentSoft, onAccent } = useTheme();
  const anyOn = prefs.ads || prefs.gambling || prefs.popups;

  const stats = [
    { label: 'Quảng cáo', value: counts.ads, color: accent },
    { label: 'Cờ bạc', value: counts.gambling, color: colors.gambling },
    { label: 'Pop-up', value: counts.popups, color: colors.popups },
  ];

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <View style={[styles.badge, { backgroundColor: anyOn ? accentSoft : 'rgba(255,255,255,0.08)' }]}>
          <Ionicons name={anyOn ? 'shield-checkmark' : 'shield-outline'} size={28} color={anyOn ? accent : colors.textMuted} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={20} accessibilityRole="header">
            {anyOn ? 'Shield đang bật' : 'Shield đang tắt'}
          </Txt>
          <Txt size={14} color={colors.textMuted} numberOfLines={1}>
            {site ? `${site} · đã chặn ${counts.total} mục` : 'Áp dụng cho mọi trang web'}
          </Txt>
        </View>
      </View>

      {site ? (
        <View style={styles.stats}>
          {stats.map((s) => (
            <View key={s.label} style={styles.stat} accessible accessibilityLabel={`${s.label}: ${s.value}`}>
              <Txt weight="bold" size={24} color={s.color} style={{ lineHeight: 30, fontVariant: ['tabular-nums'] }}>
                {s.value}
              </Txt>
              <Txt size={12} color={colors.textMuted}>
                {s.label}
              </Txt>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.group}>
        <ToggleRow
          icon="dice-outline"
          iconColor={colors.gambling}
          title="Quảng cáo cờ bạc"
          subtitle="Nhà cái, cá cược, nổ hũ"
          value={prefs.gambling}
          onChange={(v) => onToggle('gambling', v)}
        />
        <ToggleRow
          icon="megaphone-outline"
          title="Quảng cáo thường"
          subtitle="Banner, quảng cáo hiển thị"
          value={prefs.ads}
          onChange={(v) => onToggle('ads', v)}
        />
        <ToggleRow
          icon="albums-outline"
          iconColor={colors.popups}
          title="Pop-up & chuyển hướng"
          subtitle="Cửa sổ tự mở, chuyển trang lạ"
          value={prefs.popups}
          onChange={(v) => onToggle('popups', v)}
        />
        <ToggleRow
          icon="moon-outline"
          iconColor="#93C5FD"
          title={site ? 'Chế độ tối cho trang này' : 'Chế độ tối cho trang web'}
          value={prefs.dark}
          onChange={(v) => onToggle('dark', v)}
          last
        />
      </View>

      {site ? (
        <Pressable
          onPress={() => {
            onReload();
            onClose();
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.reload, { backgroundColor: accent }, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="refresh" size={18} color={onAccent} />
          <Txt weight="semibold" size={15} color={onAccent}>
            Tải lại để áp dụng hoàn toàn
          </Txt>
        </Pressable>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16, marginTop: 4 },
  badge: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  stat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  group: {
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  reload: {
    height: 50,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
