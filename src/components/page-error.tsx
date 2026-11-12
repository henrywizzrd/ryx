import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { displayHost } from '@/lib/url';
import { colors, useTheme } from '@/theme';
import { Txt } from './txt';

interface Props {
  url: string | null;
  code: number;
  description: string;
  onRetry: () => void;
}

/** Lỗi mạng hay gặp khi nhà mạng chặn trang (DNS trả sai / không phân giải được). */
const LIKELY_BLOCKED = new Set([-1000, -1003, -1004, -1005, -1200, -1202]);

/** Trang lỗi riêng của Ryx, thay cho trang "Error loading page" mặc định của WebView. */
export function PageError({ url, code, description, onRetry }: Props) {
  const { accent, onAccent } = useTheme();
  const host = displayHost(url);
  const blocked = LIKELY_BLOCKED.has(code);

  return (
    <View style={styles.root}>
      <Ionicons name={blocked ? 'shield-half-outline' : 'cloud-offline-outline'} size={48} color={colors.textMuted} />
      <Txt weight="bold" size={20} style={styles.center} accessibilityRole="header">
        Không mở được trang
      </Txt>
      {host ? (
        <Txt weight="medium" size={15} color={colors.textMuted} style={styles.center} numberOfLines={1}>
          {host}
        </Txt>
      ) : null}
      <Txt size={14} color={colors.textMuted} style={[styles.center, { marginTop: 4 }]}>
        {blocked
          ? 'Có thể nhà mạng đã chặn trang này. Bật DNS bảo mật thường sẽ vào lại được.'
          : 'Kiểm tra kết nối mạng rồi thử lại.'}
      </Txt>

      <View style={styles.actions}>
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          style={({ pressed }) => [styles.primary, { backgroundColor: accent }, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="refresh" size={18} color={onAccent} />
          <Txt weight="semibold" size={15} color={onAccent}>
            Thử lại
          </Txt>
        </Pressable>
        {blocked && (
          <Pressable
            onPress={() => router.push('/dns')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.text} />
            <Txt weight="medium" size={15}>
              Bật DNS bảo mật
            </Txt>
          </Pressable>
        )}
        {url ? (
          <Pressable
            onPress={() => Linking.openURL(url).catch(() => {})}
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="compass-outline" size={18} color={colors.text} />
            <Txt weight="medium" size={15}>
              Mở bằng Safari
            </Txt>
          </Pressable>
        ) : null}
      </View>

      <Txt size={11} color={colors.textFaint} style={[styles.center, { marginTop: 20 }]}>
        Mã lỗi {code} · {description}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 6,
  },
  center: { textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: 10, marginTop: 20 },
  primary: {
    minHeight: 50,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondary: {
    minHeight: 50,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surfaceRaised,
  },
});
