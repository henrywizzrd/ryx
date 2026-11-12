import Ionicons from '@expo/vector-icons/Ionicons';
import { useUpdates } from 'expo-updates';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { restartToApply } from '@/lib/app-updates';
import { useTheme } from '@/theme';
import { Glass } from './glass';
import { IconButton } from './icon-button';
import { Txt } from './txt';

/** Thông báo nổi khi bản cập nhật qua mạng đã tải xong. */
export function UpdateBanner() {
  const { isUpdatePending } = useUpdates();
  const insets = useSafeAreaInsets();
  const { accent, onAccent } = useTheme();
  const [dismissed, setDismissed] = useState(false);

  if (!isUpdatePending || dismissed) return null;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 8 }]}>
      <Glass radius={24} contentStyle={styles.row}>
        <Ionicons name="sparkles-outline" size={18} color={accent} />
        <Txt weight="medium" size={14} style={{ flex: 1 }} accessibilityRole="alert">
          Đã có bản cập nhật mới
        </Txt>
        <Pressable
          onPress={restartToApply}
          accessibilityRole="button"
          style={({ pressed }) => [styles.btn, { backgroundColor: accent }, pressed && { opacity: 0.85 }]}
        >
          <Txt weight="semibold" size={13} color={onAccent}>
            Khởi động lại
          </Txt>
        </Pressable>
        <IconButton icon="close" label="Để sau" size={36} iconSize={16} onPress={() => setDismissed(true)} />
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 4, minHeight: 52 },
  btn: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center' },
});
