import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import type { ShieldPrefs } from '@/state/settings';
import type { Counts } from '@/state/stats';
import { colors, useTheme, fg, pageModeIcon, pageModeLabel } from '@/theme';
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
  /** Số phần tử cậu tự ẩn trên trang này */
  customHidden: number;
  onStartPick: () => void;
  onClearCustom: () => void;
}

export function ShieldSheet({
  visible,
  onClose,
  site,
  counts,
  prefs,
  onToggle,
  onReload,
  customHidden,
  onStartPick,
  onClearCustom,
}: Props) {
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
        <View style={[styles.badge, { backgroundColor: anyOn ? accentSoft : fg(0.08) }]}>
          <Ionicons
            name={anyOn ? 'shield-checkmark' : 'shield-outline'}
            size={28}
            color={anyOn ? accent : colors.textMuted}
          />
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
          icon="hand-left-outline"
          title="Tự từ chối bảng hỏi cookie"
          subtitle={site ? 'Tắt nếu trang này bị lỗi khi đăng nhập/xem' : 'Bấm "Từ chối" giúp cậu'}
          value={prefs.cookies}
          onChange={(v) => onToggle('cookies', v)}
        />
        <ToggleRow
          icon={pageModeIcon}
          iconColor="#93C5FD"
          title={site ? `${pageModeLabel} cho trang này` : `${pageModeLabel} cho trang web`}
          value={prefs.dark}
          onChange={(v) => onToggle('dark', v)}
          last
        />
      </View>

      {site ? (
        <View style={styles.group}>
          <Pressable
            onPress={() => {
              onClose();
              onStartPick();
            }}
            accessibilityRole="button"
            style={({ pressed }) => [styles.linkRow, customHidden > 0 && styles.divider, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="hand-left-outline" size={20} color={accent} />
            <View style={{ flex: 1 }}>
              <Txt weight="medium" size={15}>
                Chạm để ẩn quảng cáo
              </Txt>
              <Txt size={13} color={colors.textMuted}>
                Chọn quảng cáo còn sót, Ryx nhớ và ẩn vĩnh viễn trên trang này
              </Txt>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </Pressable>
          {customHidden > 0 && (
            <Pressable
              onPress={onClearCustom}
              accessibilityRole="button"
              style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
              <Txt weight="medium" size={15} style={{ flex: 1 }}>
                Bỏ {customHidden} phần tử đã tự ẩn
              </Txt>
            </Pressable>
          )}
        </View>
      ) : null}

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
    backgroundColor: fg(0.06),
  },
  group: {
    borderRadius: 20,
    backgroundColor: fg(0.05),
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: fg(0.12) },
  reload: {
    height: 50,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
