import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme, useStyles } from '@/theme';
import { Glass } from './glass';
import type { IconName } from './icon-button';
import { IconButton } from './icon-button';
import { Txt } from './txt';

export interface Notice {
  /** Đổi mỗi lần hiện để tự ẩn tính lại từ đầu */
  key: number;
  icon: IconName;
  title: string;
  subtitle?: string;
  action?: { label: string; run: () => void };
  /** Tự ẩn sau bao lâu (ms); 0 = không tự ẩn */
  autoHide?: number;
}

interface Props {
  notice: Notice | null;
  bottom: number;
  onClose: () => void;
}

/** Thông báo nổi phía trên thanh dock, có thể kèm một nút hành động. */
export function NoticeBanner({ notice, bottom, onClose }: Props) {
  const styles = useStyles(makeStyles);

  const { accent, onAccent } = useTheme();

  useEffect(() => {
    if (!notice?.autoHide) return;
    const t = setTimeout(onClose, notice.autoHide);
    return () => clearTimeout(t);
  }, [notice, onClose]);

  if (!notice) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom }]}>
      <Glass radius={24} contentStyle={styles.row}>
        <Ionicons name={notice.icon} size={20} color={accent} />
        <View style={{ flex: 1 }}>
          <Txt weight="semibold" size={14} accessibilityRole="alert">
            {notice.title}
          </Txt>
          {notice.subtitle ? (
            <Txt size={12} numberOfLines={2} style={{ opacity: 0.7 }}>
              {notice.subtitle}
            </Txt>
          ) : null}
        </View>
        {notice.action && (
          <Pressable
            onPress={() => {
              notice.action?.run();
              onClose();
            }}
            accessibilityRole="button"
            style={({ pressed }) => [styles.btn, { backgroundColor: accent }, pressed && { opacity: 0.85 }]}
          >
            <Txt weight="semibold" size={13} color={onAccent}>
              {notice.action.label}
            </Txt>
          </Pressable>
        )}
        <IconButton icon="close" label="Đóng" size={36} iconSize={16} onPress={onClose} />
      </Glass>
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    wrap: { position: 'absolute', left: 16, right: 16 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 4, minHeight: 56 },
    btn: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, justifyContent: 'center' },
  });
