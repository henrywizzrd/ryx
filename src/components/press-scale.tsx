import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { MOTION } from '@/lib/motion';

const APressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** Mức thu nhỏ khi nhấn (mặc định 0.97 = lún 3%) */
  scaleTo?: number;
};

/** Nút "nhấn là lún nhẹ": thu nhỏ một chút khi chạm, thả ra thì bật lại (lò xo, chạy trên luồng UI) */
export function PressScale({ style, scaleTo = 0.97, onPressIn, onPressOut, ...rest }: Props) {
  const reduce = useReducedMotion();
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.get() }] }));
  return (
    <APressable
      {...rest}
      onPressIn={(e) => {
        if (!reduce) s.set(withSpring(scaleTo, MOTION.snappy));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        s.set(withSpring(1, MOTION.snappy));
        onPressOut?.(e);
      }}
      style={[style, anim]}
    />
  );
}
