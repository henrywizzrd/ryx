import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';

import { ZOOM_SPRING } from './dock';

/**
 * Vuốt lên trên phần tử con (vd thanh địa chỉ ở màn ngang) → trang thu nhỏ theo tay, thả đủ xa là vào màn các thẻ.
 * Dùng toạ độ màn hình vì phần tử con co lại cùng trang trong lúc kéo.
 */
export function SwipeUpZoom({
  enabled,
  zoom,
  distance,
  onStart,
  onEnd,
  children,
}: {
  enabled: boolean;
  zoom: SharedValue<number>;
  /** Kéo bao xa thì trang thu nhỏ hết */
  distance: number;
  onStart: () => void;
  onEnd: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const startY = useSharedValue(0);
  const active = useSharedValue(false);
  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetY(-12)
    .failOffsetX([-24, 24])
    .onBegin((e) => {
      startY.set(e.absoluteY);
    })
    .onUpdate((e) => {
      const up = Math.max(0, startY.get() - e.absoluteY);
      if (!active.get()) {
        active.set(true);
        runOnJS(onStart)();
      }
      zoom.set(Math.min(1, up / distance));
    })
    .onEnd((e) => {
      if (!active.get()) return;
      active.set(false);
      const open = zoom.get() > 0.3 || e.velocityY < -650;
      zoom.set(
        withSpring(
          open ? 1 : 0,
          { ...ZOOM_SPRING, velocity: Math.max(-1.2, Math.min(1.2, -e.velocityY / distance)) },
          (f) => {
            if (f) runOnJS(onEnd)(open);
          },
        ),
      );
    });
  return (
    <GestureDetector gesture={pan}>
      <Animated.View collapsable={false}>{children}</Animated.View>
    </GestureDetector>
  );
}
