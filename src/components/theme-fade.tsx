import { useEffect, useRef, useState, type RefObject } from 'react';
import { Image, StyleSheet, type HostInstance } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { captureRef } from 'react-native-view-shot';

import { log } from '@/lib/logger';
import { setBeforeThemeChange, subscribeTheme } from '@/theme';

const AImage = Animated.createAnimatedComponent(Image);
const FADE_MS = 420;

/**
 * Hiệu ứng đổi giao diện: chụp màn hình (màu cũ) phủ lên trên, đổi màu bên dưới, rồi làm mờ dần ảnh chụp
 * → màn hình chuyển màu mượt thay vì đổi cái rụp. Trả về lớp phủ, đặt làm con CUỐI của khung gốc màn hình.
 */
export function useThemeFade(root: RefObject<HostInstance | null>) {
  const [shot, setShot] = useState<string | null>(null);
  const op = useSharedValue(0);
  const ready = useRef<(() => void) | null>(null);

  useEffect(() => {
    setBeforeThemeChange(async () => {
      if (!root.current) return;
      const uri = await captureRef(root, { format: 'jpg', quality: 0.92, result: 'tmpfile' });
      // Đợi ảnh chụp hiện lên đã rồi mới đổi màu bên dưới (tối đa 300 ms để không treo)
      await new Promise<void>((res) => {
        ready.current = res;
        op.set(1);
        setShot(uri);
        setTimeout(res, 300);
      });
    });
    const unsub = subscribeTheme(() => {
      // Màu mới đã vẽ xong (2 khung hình) → làm mờ ảnh chụp
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          op.set(withTiming(0, { duration: FADE_MS, easing: Easing.out(Easing.cubic) }));
          setTimeout(() => setShot(null), FADE_MS + 40);
        }),
      );
    });
    return () => {
      setBeforeThemeChange(null);
      unsub();
    };
  }, [root, op]);

  const anim = useAnimatedStyle(() => ({ opacity: op.get() }));
  if (!shot) return null;
  return (
    <AImage
      source={{ uri: shot }}
      onLoad={() => ready.current?.()}
      onError={() => {
        log.warn('ui', 'Không hiện được ảnh chụp để chuyển màu giao diện');
        ready.current?.();
      }}
      resizeMode="stretch"
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, anim]}
    />
  );
}
