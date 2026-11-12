import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/theme';
import { Glass } from './glass';
import { Txt } from './txt';

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

/** Bảng trượt từ dưới lên, nổi cách mép, nền kính. Chạm nền tối để đóng. */
export function Sheet({ visible, onClose, title, children }: Props) {
  const insets = useSafeAreaInsets();
  const [anim] = useState(() => new Animated.Value(0));
  const [mounted, setMounted] = useState(visible);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);
  // Gắn modal ngay khi được yêu cầu mở (điều chỉnh state trong lúc render, theo khuyến nghị của React)
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible && reduceMotion) {
      anim.setValue(1);
    } else if (visible) {
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, damping: 22, stiffness: 240, mass: 0.9 }).start();
    } else {
      Animated.timing(anim, {
        toValue: 0,
        duration: reduceMotion ? 0 : 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => finished && setMounted(false));
    }
  }, [visible, anim, reduceMotion]);

  if (!mounted) return null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: anim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Đóng" />
      </Animated.View>
      <Animated.View
        style={[
          styles.wrap,
          { bottom: Math.max(insets.bottom, 12) },
          { transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [500, 0] }) }] },
        ]}
      >
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
    </Modal>
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
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginBottom: 8,
  },
  title: { textAlign: 'center', marginBottom: 12, color: colors.text },
});
