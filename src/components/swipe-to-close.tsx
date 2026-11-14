import { type StyleProp, useWindowDimensions, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { MOTION } from '@/lib/motion';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

interface Props {
  /** horizontal: vuốt trái/phải · right: chỉ vuốt sang phải · up: vuốt lên để đóng */
  direction: 'horizontal' | 'right' | 'up';
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

const DISTANCE = 0.33; // phần màn hình cần vuốt qua
const VELOCITY = 900; // hoặc vuốt nhanh

/** Bọc một thẻ để vuốt đi là đóng (giống vuốt tắt app trên iPhone). */
export function SwipeToClose({ direction, onClose, style, children }: Props) {
  const { width, height } = useWindowDimensions();
  const offset = useSharedValue(0);
  const horizontal = direction !== 'up';
  const rightOnly = direction === 'right';
  const limit = horizontal ? width : height;

  const pan = horizontal
    ? rightOnly
      ? Gesture.Pan().activeOffsetX([-9999, 14]).failOffsetY([-12, 12])
      : Gesture.Pan().activeOffsetX([-14, 14]).failOffsetY([-12, 12])
    : Gesture.Pan().activeOffsetY([-14, 9999]).failOffsetX([-12, 12]);

  pan
    .onUpdate((e) => {
      offset.value = horizontal
        ? rightOnly
          ? Math.max(0, e.translationX)
          : e.translationX
        : Math.min(0, e.translationY);
    })
    .onEnd((e) => {
      const v = horizontal ? e.velocityX : e.velocityY;
      const far = Math.abs(offset.value) > limit * DISTANCE;
      const fast = horizontal ? (rightOnly ? v > VELOCITY : Math.abs(v) > VELOCITY) : v < -VELOCITY;
      if (far || fast) {
        const sign = horizontal ? (offset.value === 0 ? Math.sign(v) || -1 : Math.sign(offset.value)) : -1;
        offset.value = withTiming(sign * limit, { duration: 180 }, (done) => {
          if (done) runOnJS(onClose)();
        });
      } else {
        offset.value = withSpring(0, MOTION.snappy);
      }
    });

  const animated = useAnimatedStyle(() => {
    const p = Math.min(1, Math.abs(offset.value) / limit);
    return {
      opacity: 1 - p * 0.9,
      transform: horizontal ? [{ translateX: offset.value }] : [{ translateY: offset.value }, { scale: 1 - p * 0.15 }],
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[style, animated]}>{children}</Animated.View>
    </GestureDetector>
  );
}
