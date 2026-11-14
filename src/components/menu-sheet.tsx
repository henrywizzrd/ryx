import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';

import { colors, fg, pageModeIcon, pageModeLabel } from '@/theme';
import type { IconName } from './icon-button';
import { Sheet } from './sheet';
import { ToggleRow } from './toggle-row';
import { PressScale } from './press-scale';
import { Txt } from './txt';

export type MenuAction =
  | 'reload'
  | 'share'
  | 'bookmark'
  | 'home'
  | 'safari'
  | 'shield'
  | 'pick'
  | 'customize'
  | 'newTab'
  | 'closeTab'
  | 'logs'
  | 'history'
  | 'dns'
  | 'downloads';

interface Props {
  visible: boolean;
  onClose: () => void;
  hasPage: boolean;
  dark: boolean;
  bookmarked: boolean;
  onToggleDark: (v: boolean) => void;
  onAction: (a: MenuAction) => void;
}

const ACTIONS: { id: MenuAction; icon: IconName; label: string; needsPage?: boolean }[] = [
  { id: 'reload', icon: 'refresh', label: 'Tải lại', needsPage: true },
  { id: 'share', icon: 'share-outline', label: 'Chia sẻ', needsPage: true },
  { id: 'bookmark', icon: 'star-outline', label: 'Thêm dấu trang', needsPage: true },
  { id: 'safari', icon: 'compass-outline', label: 'Mở bằng Safari', needsPage: true },
  { id: 'home', icon: 'home-outline', label: 'Trang chủ' },
  { id: 'shield', icon: 'shield-checkmark-outline', label: 'Shield' },
  { id: 'pick', icon: 'hand-left-outline', label: 'Ẩn quảng cáo', needsPage: true },
  { id: 'customize', icon: 'color-palette-outline', label: 'Tuỳ chỉnh' },
  { id: 'newTab', icon: 'add-circle-outline', label: 'Thẻ mới' },
  { id: 'closeTab', icon: 'close-circle-outline', label: 'Đóng thẻ' },
  { id: 'history', icon: 'time-outline', label: 'Lịch sử' },
  { id: 'downloads', icon: 'download-outline', label: 'Tải về' },
  { id: 'dns', icon: 'lock-closed-outline', label: 'DNS bảo mật' },
  { id: 'logs', icon: 'bug-outline', label: 'Nhật ký' },
];

export function MenuSheet({ visible, onClose, hasPage, dark, bookmarked, onToggleDark, onAction }: Props) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.grid}>
        {ACTIONS.map((a) => {
          const disabled = a.needsPage && !hasPage;
          return (
            <PressScale
              key={a.id}
              disabled={disabled}
              onPress={() => {
                onClose();
                onAction(a.id);
              }}
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              scaleTo={0.94}
              style={[styles.cell, disabled && { opacity: 0.35 }]}
            >
              <Ionicons
                name={a.id === 'bookmark' && bookmarked ? 'star' : a.icon}
                size={24}
                color={a.id === 'bookmark' && bookmarked ? '#FBBF24' : colors.text}
              />
              <Txt size={12} numberOfLines={1} style={{ marginTop: 6 }}>
                {a.id === 'bookmark' && bookmarked ? 'Bỏ dấu trang' : a.label}
              </Txt>
            </PressScale>
          );
        })}
      </View>
      {hasPage && (
        <View style={styles.group}>
          <ToggleRow
            icon={pageModeIcon}
            iconColor="#93C5FD"
            title={`${pageModeLabel} cho trang này`}
            value={dark}
            onChange={onToggleDark}
            last
          />
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8, marginTop: 4 },
  cell: { width: '25%', alignItems: 'center', paddingVertical: 14, borderRadius: 18 },
  pressed: { backgroundColor: fg(0.08) },
  group: { borderRadius: 20, backgroundColor: fg(0.05), paddingHorizontal: 14 },
});
