import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';
import { Glass } from './glass';
import { ShieldAnim } from './shield-anim';
import { IconButton } from './icon-button';
import { Txt } from './txt';

export interface BlockedPopup {
  /** Đổi mỗi lần chặn để hiệu ứng chạy lại. */
  key: number;
  url: string;
  host: string;
}

interface Props {
  popup: BlockedPopup | null;
  bottom: number;
  onOpen: (url: string) => void;
  onClose: () => void;
}

const AUTO_HIDE_MS = 6000;

/** Báo "đã chặn cửa sổ bật lên" kèm nút Mở nếu cậu thực sự muốn xem trang đó. */
export function PopupBanner({ popup, bottom, onOpen, onClose }: Props) {
  const { accent, onAccent } = useTheme();

  useEffect(() => {
    if (!popup) return;
    const t = setTimeout(onClose, AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [popup, onClose]);

  if (!popup) return null;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom }]}>
      <Glass radius={24} contentStyle={styles.row}>
        <ShieldAnim playKey={popup.key} style={styles.anim} />
        <View style={{ flex: 1 }}>
          <Txt weight="semibold" size={14} accessibilityRole="alert">
            Đã chặn cửa sổ bật lên
          </Txt>
          <Txt size={12} numberOfLines={1} style={{ opacity: 0.7 }}>
            {popup.host}
          </Txt>
        </View>
        <Pressable
          onPress={() => onOpen(popup.url)}
          accessibilityRole="button"
          accessibilityLabel={`Vẫn mở ${popup.host}`}
          style={({ pressed }) => [styles.btn, { backgroundColor: accent }, pressed && { opacity: 0.85 }]}
        >
          <Txt weight="semibold" size={13} color={onAccent}>
            Vẫn mở
          </Txt>
        </Pressable>
        <IconButton icon="close" label="Đóng" size={36} iconSize={16} onPress={onClose} />
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 6, paddingRight: 4, minHeight: 56 },
  anim: { width: 44, height: 44 },
  btn: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, justifyContent: 'center' },
});
