import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fg } from '@/theme';
import { Glass } from './glass';
import { Txt } from './txt';

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * Bảng trượt từ dưới lên, nổi cách mép, nền kính. Chạm nền tối để đóng.
 * Chạy hoàn toàn trên luồng giao diện (Reanimated, 120 Hz) và không dùng Modal của iOS
 * (mở Modal tốn vài khung hình đầu → trông như hiệu ứng bị khựng). Đặt bảng ở cuối cây giao diện để nó nằm trên cùng.
 */
export function Sheet({ visible, onClose, title, children }: Props) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const t = useSharedValue(0);
  // Gắn bảng ngay khi được yêu cầu mở (điều chỉnh state trong lúc render, theo khuyến nghị của React)
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (!mounted) return;
    if (visible) {
      t.set(reduceMotion ? withTiming(1, { duration: 150 }) : withSpring(1, { duration: 320, dampingRatio: 1 }));
    } else {
      t.set(
        withTiming(0, { duration: reduceMotion ? 120 : 200, easing: EASE_OUT }, (done) => {
          if (done) scheduleOnRN(setMounted, false);
        }),
      );
    }
  }, [visible, mounted, reduceMotion, t]);

  const backdrop = useAnimatedStyle(() => ({ opacity: t.get() }));
  const panel = useAnimatedStyle(() => ({
    opacity: reduceMotion ? t.get() : 1,
    // Dịch theo chính chiều cao của bảng: bảng cao bao nhiêu cũng trượt ra khỏi màn hình vừa đủ
    transform: [{ translateY: reduceMotion ? 0 : `${(1 - t.get()) * 110}%` }],
  }));

  if (!mounted) return null;

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdrop]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Đóng" />
      </Animated.View>
      <Animated.View style={[styles.wrap, { bottom: Math.max(insets.bottom, 12) }, panel]}>
        <Glass radius={32} contentStyle={styles.content}>
          <View style={styles.grabber} />
          {title ? (
            <Txt weight="semibold" size={17} style={styles.title} accessibilityRole="header">
              {title}
            </Txt>
          ) : null}
          {children}
        </Glass>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.45)' },
  wrap: { position: 'absolute', left: 8, right: 8 },
  content: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 8 },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: fg(0.25),
    marginBottom: 8,
  },
  title: { textAlign: 'center', marginBottom: 12, color: colors.text },
});
