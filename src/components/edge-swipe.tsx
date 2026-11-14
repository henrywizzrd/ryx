import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useStyles, useTheme, type Palette } from '@/theme';

interface Props {
  /** Vùng trên/dưới mà dải vuốt được phép chiếm (tránh thanh địa chỉ, dock) */
  top: number;
  bottom: number;
  onBack: () => void;
}

/** Bề rộng dải nhận vuốt ở mép trái màn hình. */
const EDGE = 18;
/** Kéo quá khoảng này (hoặc vuốt nhanh) thì lùi trang. */
const TRIGGER = 80;

/**
 * Vuốt từ mép trái sang phải để về trang trước (giống Safari).
 * Ryx tự làm thay cho cử chỉ có sẵn của WKWebView vì cử chỉ đó không chạy được bên trong app.
 */
export function EdgeSwipeBack({ top, bottom, onBack }: Props) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();

  const dx = useSharedValue(0);

  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX(10)
    .failOffsetY([-24, 24])
    .onUpdate((e) => {
      const prev = dx.value;
      dx.value = Math.max(0, e.translationX);
      if (prev < TRIGGER && dx.value >= TRIGGER) void Haptics.selectionAsync();
    })
    .onEnd((e) => {
      if (e.translationX > TRIGGER || e.velocityX > 800) onBack();
      dx.value = withTiming(0, { duration: 180 });
    })
    .onFinalize(() => {
      if (dx.value !== 0) dx.value = withTiming(0, { duration: 180 });
    });

  // Nút mũi tên trượt theo ngón tay, đậm dần khi đủ để lùi
  const arrow = useAnimatedStyle(() => ({
    opacity: interpolate(dx.value, [0, 24, TRIGGER], [0, 0.5, 1], 'clamp'),
    transform: [
      { translateX: interpolate(dx.value, [0, TRIGGER * 1.6], [-44, 20], 'clamp') },
      { scale: interpolate(dx.value, [TRIGGER - 10, TRIGGER], [0.85, 1], 'clamp') },
    ],
  }));

  return (
    <>
      <GestureDetector gesture={pan}>
        <View style={[styles.strip, { top, bottom }]} accessible={false} />
      </GestureDetector>
      <View pointerEvents="none" style={[styles.arrowWrap, { top, bottom }]}>
        <Animated.View style={[styles.arrow, arrow]}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Animated.View>
      </View>
    </>
  );
}

const makeStyles = (_colors: Palette, fg: (alpha: number) => string) =>
  StyleSheet.create({
    strip: { position: 'absolute', left: 0, width: EDGE },
    arrowWrap: { position: 'absolute', left: 0, width: 80, justifyContent: 'center' },
    arrow: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(40,40,46,0.92)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: fg(0.18),
    },
  });
