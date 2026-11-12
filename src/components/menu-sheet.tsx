import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors } from '@/theme';
import type { IconName } from './icon-button';
import { Sheet } from './sheet';
import { ToggleRow } from './toggle-row';
import { Txt } from './txt';

export type MenuAction = 'reload' | 'share' | 'home' | 'safari' | 'shield' | 'customize' | 'newTab' | 'closeTab' | 'logs' | 'history';

interface Props {
  visible: boolean;
  onClose: () => void;
  hasPage: boolean;
  dark: boolean;
  onToggleDark: (v: boolean) => void;
  onAction: (a: MenuAction) => void;
}

const ACTIONS: { id: MenuAction; icon: IconName; label: string; needsPage?: boolean }[] = [
  { id: 'reload', icon: 'refresh', label: 'Tải lại', needsPage: true },
  { id: 'share', icon: 'share-outline', label: 'Chia sẻ', needsPage: true },
  { id: 'safari', icon: 'compass-outline', label: 'Mở bằng Safari', needsPage: true },
  { id: 'home', icon: 'home-outline', label: 'Trang chủ' },
  { id: 'shield', icon: 'shield-checkmark-outline', label: 'Khiên' },
  { id: 'customize', icon: 'color-palette-outline', label: 'Tuỳ chỉnh' },
  { id: 'newTab', icon: 'add-circle-outline', label: 'Thẻ mới' },
  { id: 'closeTab', icon: 'close-circle-outline', label: 'Đóng thẻ' },
  { id: 'history', icon: 'time-outline', label: 'Lịch sử' },
  { id: 'logs', icon: 'bug-outline', label: 'Nhật ký' },
];

export function MenuSheet({ visible, onClose, hasPage, dark, onToggleDark, onAction }: Props) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.grid}>
        {ACTIONS.map((a) => {
          const disabled = a.needsPage && !hasPage;
          return (
            <Pressable
              key={a.id}
              disabled={disabled}
              onPress={() => {
                onClose();
                onAction(a.id);
              }}
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              style={({ pressed }) => [styles.cell, pressed && styles.pressed, disabled && { opacity: 0.35 }]}
            >
              <Ionicons name={a.icon} size={24} color={colors.text} />
              <Txt size={12} numberOfLines={1} style={{ marginTop: 6 }}>
                {a.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
      {hasPage && (
        <View style={styles.group}>
          <ToggleRow icon="moon-outline" iconColor="#93C5FD" title="Chế độ tối cho trang này" value={dark} onChange={onToggleDark} last />
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8, marginTop: 4 },
  cell: { width: '25%', alignItems: 'center', paddingVertical: 14, borderRadius: 18 },
  pressed: { backgroundColor: 'rgba(255,255,255,0.08)' },
  group: { borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 14 },
});
