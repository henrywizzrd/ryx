import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { MOTION } from '@/lib/motion';
import { useStyles, useTheme, type Palette } from '@/theme';
import { Glass } from './glass';
import type { IconName } from './icon-button';
import { Txt } from './txt';

export interface MenuItem {
  label: string;
  icon: IconName;
  run: () => void;
  destructive?: boolean;
}

export interface ContextMenuState {
  /** Đổi mỗi lần mở để chạy lại hiệu ứng */
  key: number;
  /** Toạ độ ngón tay trên màn hình */
  x: number;
  y: number;
  title?: string;
  subtitle?: string;
  items: MenuItem[];
}

const WIDTH = 260;
const ROW = 48;
const HEAD = 56;
const MARGIN = 12;

/**
 * Menu nhỏ bật ra ngay chỗ nhấn giữ (kiểu menu ngữ cảnh của iOS), thay cho bảng chọn kéo từ dưới lên.
 * Chạm ra ngoài để đóng. Bật "Giảm chuyển động" thì chỉ mờ dần, không phóng to.
 */
export function ContextMenu({ menu, onClose }: { menu: ContextMenuState | null; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const { colors, fg } = useTheme();

  const { width: W, height: H } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (!menu) return;
    t.value = 0;
    t.value = reduceMotion ? withTiming(1, { duration: 150 }) : withSpring(1, MOTION.snappy);
  }, [menu, reduceMotion, t]);

  const backdrop = useAnimatedStyle(() => ({ opacity: Math.min(1, t.value) }));
  const card = useAnimatedStyle(() => ({
    opacity: Math.min(1, t.value * 1.4),
    transform: [{ scale: reduceMotion ? 1 : 0.86 + 0.14 * t.value }],
  }));

  if (!menu) return null;

  const height = (menu.title ? HEAD : 0) + menu.items.length * ROW;
  const left = Math.min(Math.max(menu.x - WIDTH / 2, MARGIN), W - WIDTH - MARGIN);
  // Đủ chỗ thì hiện dưới ngón tay, không thì hiện phía trên
  const below = menu.y + 16 + height < H - 110;
  const top = Math.max(MARGIN + 40, below ? menu.y + 16 : menu.y - 16 - height);
  // Điểm gốc phóng to là chỗ ngón tay (mép trên hoặc dưới của menu)
  const origin = { transformOrigin: `${Math.min(Math.max(menu.x - left, 24), WIDTH - 24)}px ${below ? 0 : height}px` };

  const run = (item: MenuItem) => {
    void Haptics.selectionAsync();
    onClose();
    // Đợi menu đóng xong rồi mới chạy (vd mở bảng chia sẻ)
    setTimeout(item.run, 60);
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.dim, backdrop]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Đóng menu" />
      </Animated.View>
      <Animated.View style={[styles.card, { left, top, width: WIDTH }, origin, card]}>
        <Glass radius={18}>
          {menu.title ? (
            <View style={styles.head}>
              <Txt weight="semibold" size={14} numberOfLines={1}>
                {menu.title}
              </Txt>
              {menu.subtitle ? (
                <Txt size={12} color={colors.textMuted} numberOfLines={1}>
                  {menu.subtitle}
                </Txt>
              ) : null}
            </View>
          ) : null}
          {menu.items.map((item, i) => (
            <Animated.View
              key={item.label}
              entering={reduceMotion ? undefined : FadeInDown.delay(40 + i * 35).duration(200)}
            >
              <Pressable
                onPress={() => run(item)}
                accessibilityRole="menuitem"
                style={({ pressed }) => [
                  styles.row,
                  (i > 0 || menu.title) && styles.divider,
                  pressed && { backgroundColor: fg(0.1) },
                ]}
              >
                <Ionicons name={item.icon} size={20} color={item.destructive ? colors.danger : colors.text} />
                <Txt
                  size={16}
                  color={item.destructive ? colors.danger : colors.text}
                  numberOfLines={1}
                  style={{ flex: 1 }}
                >
                  {item.label}
                </Txt>
              </Pressable>
            </Animated.View>
          ))}
        </Glass>
      </Animated.View>
    </View>
  );
}

const makeStyles = (_colors: Palette, fg: (alpha: number) => string) =>
  StyleSheet.create({
    dim: { backgroundColor: 'rgba(0,0,0,0.28)' },
    card: { position: 'absolute' },
    head: { height: HEAD, justifyContent: 'center', paddingHorizontal: 16, gap: 2 },
    row: { height: ROW, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fg(0.12) },
  });
