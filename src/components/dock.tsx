import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View, type HostInstance } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DockButtonId, DockStyle } from '@/state/settings';
import { colors, useTheme } from '@/theme';
import { Glass } from './glass';
import { IconButton, type IconName } from './icon-button';
import type { Rect } from './tab-overview';
import { Txt } from './txt';

export const DOCK_BUTTONS: Record<DockButtonId, { icon: IconName; label: string }> = {
  back: { icon: 'chevron-back', label: 'Quay lại' },
  forward: { icon: 'chevron-forward', label: 'Tiến tới' },
  tabs: { icon: 'copy-outline', label: 'Các thẻ' },
  menu: { icon: 'ellipsis-horizontal', label: 'Menu' },
  shield: { icon: 'shield-checkmark-outline', label: 'Shield' },
  reload: { icon: 'refresh', label: 'Tải lại' },
  home: { icon: 'home-outline', label: 'Trang chủ' },
  share: { icon: 'share-outline', label: 'Chia sẻ' },
};

const SIZES: Record<DockStyle, { height: number; button: number; icon: number; margin: number }> = {
  floating: { height: 58, button: 46, icon: 23, margin: 16 },
  compact: { height: 48, button: 44, icon: 20, margin: 16 },
  attached: { height: 52, button: 46, icon: 23, margin: 0 },
};

/** Khoảng cách từ đáy màn hình tới mép trên của dock (dùng để đặt thanh địa chỉ & inset nội dung). */
export function dockMetrics(style: DockStyle, bottomInset: number) {
  const s = SIZES[style];
  if (style === 'attached') {
    const bottom = 0;
    return { bottom, height: s.height + bottomInset, top: s.height + bottomInset };
  }
  const bottom = Math.max(16, bottomInset - 16);
  return { bottom, height: s.height, top: bottom + s.height };
}

interface Props {
  dockStyle: DockStyle;
  buttons: DockButtonId[];
  tabCount: number;
  canGoBack: boolean;
  canGoForward: boolean;
  blocked: number;
  onPress: (id: DockButtonId) => void;
  /** rect: vị trí nút + (để thẻ mới bay ra từ đó) */
  onNewTab: (from: Rect | null) => void;
  /** 0 = trang, 1 = màn các thẻ. Giữ dock kéo lên thì trang thu nhỏ theo tay. */
  zoom: SharedValue<number>;
  /** Cho phép kéo dock để thu nhỏ (tắt khi đang ở màn các thẻ) */
  zoomEnabled: boolean;
  onZoomStart: () => void;
  onZoomEnd: (open: boolean) => void;
  /** Lệch thêm do màn các thẻ (dock đi theo thẻ đang mở / nảy từ dưới lên) */
  extraX: SharedValue<number>;
  extraY: SharedValue<number>;
  /** Ẩn mượt (vd khi đang gõ địa chỉ) */
  hidden: boolean;
  /** Vuốt ngang trên dock → thẻ bên cạnh */
  onSwipeSide: (dir: 'next' | 'prev') => void;
}

/** Ngưỡng để coi là "vuốt" (chưa tới thì vẫn là bấm nút bình thường). */
const GROUP_GAP = 6;
const SWIPE_SIDE = 56;
/** Lò xo kiểu iOS: dứt khoát, nảy rất nhẹ. */
const SPRING = { damping: 20, stiffness: 260, mass: 0.9 };
/** Dock nảy về chỗ cũ khi thả tay */
const BOUNCE = { damping: 17, stiffness: 240, mass: 0.8 };
/** Trang thu nhỏ / phóng to */
export const ZOOM_SPRING = { damping: 30, stiffness: 240, mass: 1 };

function TabCountIcon({ count, size }: { count: number; size: number }) {
  const box = Math.round(size * 0.92);
  return (
    <View style={[styles.tabCount, { width: box, height: box, borderRadius: box * 0.28 }]}>
      <Txt weight="bold" size={count > 9 ? 10 : 12} style={{ lineHeight: 15 }}>
        {count > 99 ? '99+' : count}
      </Txt>
    </View>
  );
}

/** Nhóm back+forward liền nhau thành một cụm, các nút khác đứng riêng. */
function groupButtons(ids: DockButtonId[]): DockButtonId[][] {
  const groups: DockButtonId[][] = [];
  for (const id of ids) {
    const last = groups[groups.length - 1];
    const pair =
      last &&
      last.length === 1 &&
      ((last[0] === 'back' && id === 'forward') || (last[0] === 'forward' && id === 'back'));
    if (pair) last.push(id);
    else groups.push([id]);
  }
  return groups;
}

export function Dock({
  dockStyle,
  buttons,
  tabCount,
  canGoBack,
  canGoForward,
  blocked,
  onPress,
  onNewTab,
  onSwipeSide,
  zoom,
  zoomEnabled,
  onZoomStart,
  onZoomEnd,
  extraX,
  extraY,
  hidden,
}: Props) {
  const { height: H } = useWindowDimensions();
  const plusRef = useRef<HostInstance>(null);
  const pressPlus = () => {
    const node = plusRef.current;
    if (!node) return onNewTab(null);
    node.measureInWindow((x, y, w, h) => onNewTab(w > 0 ? { x, y, w, h } : null));
  };
  const insets = useSafeAreaInsets();
  const { accent } = useTheme();
  const s = SIZES[dockStyle];
  const m = dockMetrics(dockStyle, insets.bottom);
  const attached = dockStyle === 'attached';

  // ---- Vuốt trên dock (chạy trên luồng giao diện cho mượt) ----
  // Chạm vào dock: dock lún nhẹ. Kéo lên: dock bám theo tay (có lực cản), thả đủ xa → mở màn các thẻ.
  // Kéo ngang: dock lệch theo tay, thả đủ xa → sang thẻ bên cạnh. Bấm nút vẫn như cũ vì phải kéo quá ngưỡng mới tính.
  const reduceMotion = useReducedMotion();
  const ty = useSharedValue(0);
  const tx = useSharedValue(0);
  const press = useSharedValue(0);

  const fireSide = (dir: 'next' | 'prev') => onSwipeSide(dir);
  const startZoom = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onZoomStart();
  };
  const zooming = useSharedValue(false);
  const dist = H * 0.34;

  const swipe = Gesture.Pan()
    .activeOffsetY([-10, 10])
    .activeOffsetX([-18, 18])
    .onBegin(() => {
      press.value = withSpring(1, SPRING);
    })
    .onUpdate((e) => {
      const vertical = Math.abs(e.translationY) >= Math.abs(e.translationX);
      if (zoomEnabled && (zooming.value || (vertical && e.translationY < -4))) {
        // Giữ dock kéo lên: dock bám theo ngón tay, trang thu nhỏ dần
        if (!zooming.value) {
          zooming.value = true;
          runOnJS(startZoom)();
        }
        const up = Math.max(0, -e.translationY);
        ty.value = -(up > 220 ? 220 + (up - 220) * 0.4 : up);
        tx.value = 0;
        zoom.set(Math.min(1, up / dist));
        return;
      }
      if (reduceMotion) return;
      ty.value = 0;
      tx.value = vertical ? 0 : e.translationX * 0.35;
    })
    .onEnd((e) => {
      if (zooming.value) {
        zooming.value = false;
        const open = zoom.value > 0.3 || e.velocityY < -650;
        zoom.set(
          reduceMotion
            ? withTiming(open ? 1 : 0, { duration: 200 }, (f) => {
                if (f) runOnJS(onZoomEnd)(open);
              })
            : withSpring(open ? 1 : 0, { ...ZOOM_SPRING, velocity: Math.max(-2, Math.min(2, -e.velocityY / dist)) }, (f) => {
                if (f) runOnJS(onZoomEnd)(open);
              }),
        );
        // Thả tay: dock nảy về chỗ cũ
        ty.value = withSpring(0, BOUNCE);
        tx.value = withSpring(0, SPRING);
        return;
      }
      const ax = Math.abs(e.translationX);
      const ay = Math.abs(e.translationY);
      if (ax > SWIPE_SIDE && ax > ay) runOnJS(fireSide)(e.translationX < 0 ? 'next' : 'prev');
      ty.value = withSpring(0, SPRING);
      tx.value = withSpring(0, SPRING);
    })
    .onFinalize(() => {
      press.value = withSpring(0, SPRING);
      if (!zooming.value) {
        ty.value = withSpring(0, BOUNCE);
        tx.value = withSpring(0, SPRING);
      }
    });

  // Ẩn/hiện mượt khi gõ địa chỉ
  const hide = useSharedValue(hidden ? 1 : 0);
  useEffect(() => {
    hide.value = withTiming(hidden ? 1 : 0, { duration: hidden ? 160 : 260 });
  }, [hidden, hide]);

  const motion = useAnimatedStyle(() => {
    const lift = Math.min(0.06, Math.max(0, -ty.value / 600));
    return {
      opacity: 1 - hide.value,
      transform: [
        { translateY: ty.value + extraY.value + hide.value * 40 },
        { translateX: tx.value + extraX.value * zoom.value },
        { scale: reduceMotion ? 1 : 1 - press.value * 0.03 + lift - hide.value * 0.06 },
      ],
    };
  });
  const wrap = (node: React.ReactElement) => <GestureDetector gesture={swipe}>{node}</GestureDetector>;

  const renderButton = (id: DockButtonId) => {
    const def = DOCK_BUTTONS[id];
    if (id === 'tabs') {
      return (
        <Pressable
          key={id}
          onPress={() => onPress(id)}
          accessibilityRole="button"
          accessibilityLabel={`${def.label}: ${tabCount} thẻ đang mở`}
          hitSlop={6}
          style={({ pressed }) => [
            styles.btn,
            { width: s.button, height: s.button, borderRadius: s.button / 2 },
            pressed && styles.pressed,
          ]}
        >
          <TabCountIcon count={tabCount} size={s.icon} />
        </Pressable>
      );
    }
    return (
      <IconButton
        key={id}
        icon={def.icon}
        label={def.label}
        size={s.button}
        iconSize={s.icon}
        disabled={(id === 'back' && !canGoBack) || (id === 'forward' && !canGoForward)}
        onPress={() => onPress(id)}
        color={id === 'shield' ? accent : colors.text}
        badge={id === 'shield' ? blocked : undefined}
        badgeColor={accent}
      />
    );
  };

  const groups = groupButtons(buttons);

  const content = (
    <View style={[styles.row, { paddingHorizontal: attached ? 12 : 8 }]}>
      {groups.map((g) => (
        <View key={g.join('-')} style={styles.group}>
          {g.map(renderButton)}
        </View>
      ))}
      {attached && (
        <IconButton
          icon="add"
          label="Thẻ mới"
          size={s.button}
          iconSize={s.icon + 3}
          color={accent}
          onPress={() => onNewTab(null)}
        />
      )}
    </View>
  );

  if (attached) {
    return wrap(
      <Animated.View pointerEvents={hidden ? 'none' : 'box-none'} style={[styles.attached, motion]}>
        <Glass radius={0} shadow={false} style={{ height: m.height }} contentStyle={{ paddingBottom: insets.bottom }}>
          {content}
        </Glass>
      </Animated.View>,
    );
  }

  return wrap(
    <Animated.View
      pointerEvents={hidden ? 'none' : 'box-none'}
      style={[styles.floatRow, { left: s.margin, right: s.margin, bottom: m.bottom, height: s.height }, motion]}
    >
      {/* Dock nổi chỉ rộng vừa đủ chứa các nút */}
      <Glass radius={s.height / 2} style={{ height: s.height }}>
        <View style={[styles.rowFloat, { gap: GROUP_GAP }]}>
          {groups.map((g) => (
            <View key={g.join('-')} style={styles.group}>
              {g.map(renderButton)}
            </View>
          ))}
        </View>
      </Glass>
      <Glass radius={s.height / 2} style={{ width: s.height, height: s.height, marginLeft: 10 }}>
        <Pressable
          ref={plusRef}
          collapsable={false}
          onPress={pressPlus}
          accessibilityRole="button"
          accessibilityLabel="Thẻ mới"
          style={({ pressed }) => [styles.plus, pressed && styles.pressed]}
        >
          <Ionicons name="add" size={s.icon + 5} color={accent} />
        </Pressable>
      </Glass>
    </Animated.View>,
  );
}

const styles = StyleSheet.create({
  floatRow: { position: 'absolute', flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  rowFloat: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, height: '100%' },
  attached: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.glassBorder,
  },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  group: { flexDirection: 'row', alignItems: 'center' },
  btn: { alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: 'rgba(255,255,255,0.10)', transform: [{ scale: 0.94 }] },
  tabCount: { borderWidth: 2, borderColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  plus: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
