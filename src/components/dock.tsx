import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View, type HostInstance, type LayoutChangeEvent } from 'react-native';
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
import { useTheme, useStyles, type Palette } from '@/theme';
import { ADDRESS_BAR_HEIGHT } from './address-bar';
import { Glass } from './glass';
import { IconButton, type IconName } from './icon-button';
import { MOTION } from '@/lib/motion';
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

/**
 * Màn ngang: dock dọc ở mép phải (giữa theo chiều dọc), nút + ở góc trên bên phải.
 * right: khoảng từ mép phải màn hình tới dock · width: bề ngang dock · pad: tổng chỗ cần chừa bên phải.
 */
export function sideDockMetrics(style: DockStyle, rightInset: number) {
  const s = SIZES[style === 'attached' ? 'floating' : style];
  const right = Math.max(12, rightInset);
  return { right, width: s.height, pad: right + s.height + 12 };
}

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
  /** Dịch dock sang phải (nhường chỗ nút kính lúp khi thanh địa chỉ thu gọn) */
  /** Thanh địa chỉ thu thành nút kính lúp bên trái dock (0..1): dock nhường chỗ, không đè lên nhau */
  lens?: SharedValue<number>;
  /** Ẩn mượt (vd khi đang gõ địa chỉ) */
  hidden: boolean;
  /** Vuốt ngang trên dock → thẻ bên cạnh (dock dọc: vuốt lên/xuống) */
  onSwipeSide: (dir: 'next' | 'prev') => void;
  /** Màn ngang: dock dọc bên phải, kéo dock vào giữa màn để mở màn các thẻ; nút + ra góc trên bên phải */
  vertical?: boolean;
  /** Ẩn bong bóng tròn (nút ><) — vd đang ở màn các thẻ */
  bubbleHidden?: boolean;
  /** 0 = dock + thanh địa chỉ đầy đủ, 1 = thu gọn vào bong bóng (chạy mượt từ index) */
  mini: SharedValue<number>;
  /** Đang thu gọn (để tắt chạm vào dock đã ẩn) */
  minimized: boolean;
  /** Bấm bong bóng: thu gọn / bung ra */
  onToggleMini: () => void;
}

/** Ngưỡng để coi là "vuốt" (chưa tới thì vẫn là bấm nút bình thường). */
const GROUP_GAP = 6;
const SWIPE_SIDE = 56;
/** Lò xo kiểu iOS: dứt khoát, nảy rất nhẹ. */
const SPRING = MOTION.snappy;
/** Dock nảy về chỗ cũ khi thả tay */
const BOUNCE = MOTION.settle;
/** Trang thu nhỏ / phóng to */
export const ZOOM_SPRING = MOTION.smooth;

function TabCountIcon({ count, size }: { count: number; size: number }) {
  const styles = useStyles(makeStyles);

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
  lens,
  hidden,
  vertical = false,
  bubbleHidden = false,
  mini,
  minimized,
  onToggleMini,
}: Props) {
  const styles = useStyles(makeStyles);

  const { width: W, height: H } = useWindowDimensions();
  const plusRef = useRef<HostInstance>(null);
  const pressPlus = () => {
    const node = plusRef.current;
    if (!node) return onNewTab(null);
    node.measureInWindow((x, y, w, h) => onNewTab(w > 0 ? { x, y, w, h } : null));
  };
  const insets = useSafeAreaInsets();
  const { accent, colors } = useTheme();
  // Dock dọc luôn kiểu nổi (kiểu "dính đáy" không hợp với cạnh phải)
  const s = SIZES[vertical && dockStyle === 'attached' ? 'floating' : dockStyle];
  const side = sideDockMetrics(dockStyle, insets.right);
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
  const dist = (vertical ? W : H) * 0.34;

  const swipe = Gesture.Pan()
    .activeOffsetY([-10, 10])
    .activeOffsetX([-18, 18])
    .onBegin(() => {
      press.value = withSpring(1, SPRING);
    })
    .onUpdate((e) => {
      // Trục "mở màn các thẻ": dock ngang kéo lên; dock dọc (màn ngang) kéo sang trái vào giữa màn
      const main = vertical ? -e.translationX : -e.translationY;
      const cross = vertical ? e.translationY : e.translationX;
      const alongMain = Math.abs(main) >= Math.abs(cross);
      if (zoomEnabled && (zooming.value || (alongMain && main > 4))) {
        // Giữ dock kéo đi: dock bám theo ngón tay, trang thu nhỏ dần
        if (!zooming.value) {
          zooming.value = true;
          runOnJS(startZoom)();
        }
        const up = Math.max(0, main);
        const moved = -(up > 220 ? 220 + (up - 220) * 0.4 : up);
        if (vertical) {
          tx.value = moved;
          ty.value = 0;
        } else {
          ty.value = moved;
          tx.value = 0;
        }
        zoom.set(Math.min(1, up / dist));
        return;
      }
      if (reduceMotion) return;
      if (vertical) {
        tx.value = 0;
        ty.value = alongMain ? 0 : e.translationY * 0.35;
      } else {
        ty.value = 0;
        tx.value = alongMain ? 0 : e.translationX * 0.35;
      }
    })
    .onEnd((e) => {
      if (zooming.value) {
        zooming.value = false;
        const v = vertical ? e.velocityX : e.velocityY;
        const open = zoom.value > 0.3 || v < -650;
        zoom.set(
          reduceMotion
            ? withTiming(open ? 1 : 0, { duration: 200 }, (f) => {
                if (f) runOnJS(onZoomEnd)(open);
              })
            : withSpring(open ? 1 : 0, { ...ZOOM_SPRING, velocity: Math.max(-1.2, Math.min(1.2, -v / dist)) }, (f) => {
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
      // Dock ngang: vuốt trái = thẻ sau · dock dọc: vuốt lên = thẻ sau
      if (vertical) {
        if (ay > SWIPE_SIDE && ay > ax) runOnJS(fireSide)(e.translationY < 0 ? 'next' : 'prev');
      } else if (ax > SWIPE_SIDE && ax > ay) runOnJS(fireSide)(e.translationX < 0 ? 'next' : 'prev');
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

  // ---- Nhường chỗ cho nút kính lúp (dock ngang) ----
  // Kính lúp nằm sát mép trái (16 → 16 + ADDRESS_BAR_HEIGHT). Dock dịch sang phải vừa đủ; hết chỗ bên phải thì dock
  // co lại (neo mép phải) cho vừa khoảng giữa kính lúp và bong bóng. Đo vị trí thật nên thêm/bớt nút vẫn đúng.
  const dockLX = useSharedValue(0);
  const dockLW = useSharedValue(0);
  const bubLX = useSharedValue(0);
  const bubLW = useSharedValue(0);
  const fitFor = (c: number) => {
    'worklet';
    if (c <= 0 || dockLW.value <= 0) return { shift: 0, scale: 1 };
    const need = Math.max(0, 16 + ADDRESS_BAR_HEIGHT + 8 - (s.margin + dockLX.value));
    const room = Math.max(0, W - s.margin - (s.margin + bubLX.value + bubLW.value));
    const shift = Math.min(need, room);
    const rest = need - shift;
    const fit = Math.max(0.72, (dockLW.value - rest) / dockLW.value);
    return { shift: shift * c, scale: 1 - (1 - fit) * c };
  };

  const motion = useAnimatedStyle(() => {
    if (vertical) {
      // Dock dọc: ẩn thì trượt sang phải; đổi thẻ thì nảy từ phải vào (dùng extraY làm độ lệch)
      const lift = Math.min(0.06, Math.max(0, -tx.value / 600));
      return {
        opacity: 1 - hide.value,
        transform: [
          { translateX: tx.value + extraY.value * 0.5 + hide.value * 40 },
          { translateY: ty.value },
          { scale: reduceMotion ? 1 : 1 - press.value * 0.03 + lift - hide.value * 0.06 },
        ],
      };
    }
    const lift = Math.min(0.06, Math.max(0, -ty.value / 600));
    return {
      opacity: 1 - hide.value,
      transform: [
        { translateY: ty.value + extraY.value + hide.value * 40 },
        { translateX: tx.value + extraX.value * zoom.value + fitFor(lens?.value ?? 0).shift },
        { scale: reduceMotion ? 1 : 1 - press.value * 0.03 + lift - hide.value * 0.06 },
      ],
    };
  });
  const wrap = (node: React.ReactElement) => <GestureDetector gesture={swipe}>{node}</GestureDetector>;

  const renderButton = (id: DockButtonId, size: number = s.button) => {
    const def = DOCK_BUTTONS[id];
    const iconSize = Math.min(s.icon, Math.round(size * 0.5));
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
            { width: size, height: size, borderRadius: size / 2 },
            pressed && styles.pressed,
          ]}
        >
          <TabCountIcon count={tabCount} size={iconSize} />
        </Pressable>
      );
    }
    return (
      <IconButton
        key={id}
        icon={def.icon}
        label={def.label}
        size={size}
        iconSize={iconSize}
        disabled={(id === 'back' && !canGoBack) || (id === 'forward' && !canGoForward)}
        onPress={() => onPress(id)}
        color={id === 'shield' ? accent : colors.text}
        badge={id === 'shield' ? blocked : undefined}
        badgeColor={accent}
      />
    );
  };

  const groups = groupButtons(buttons);
  // Nút + (thẻ mới) nằm trong dock, ngay bên phải nút > (không có > thì sau <, không có cả hai thì đứng đầu)
  const items: (DockButtonId[] | 'plus')[] = [...groups];
  if (!attached) {
    let at = groups.findIndex((g) => g.includes('forward'));
    if (at < 0) at = groups.findIndex((g) => g.includes('back'));
    items.splice(at + 1, 0, 'plus');
  }
  const renderPlus = (size: number = s.button) => (
    <View key="plus" ref={plusRef} collapsable={false}>
      <IconButton
        icon="add"
        label="Thẻ mới"
        size={size}
        iconSize={Math.min(s.icon + 3, Math.round(size * 0.56))}
        color={accent}
        onPress={pressPlus}
      />
    </View>
  );

  // Bong bóng tròn (nút >< / bung ra): ẩn mượt khi gõ địa chỉ / ở màn các thẻ
  const bubbleOff = hidden || bubbleHidden;
  const bubbleHide = useSharedValue(bubbleOff ? 1 : 0);
  useEffect(() => {
    bubbleHide.value = withTiming(bubbleOff ? 1 : 0, { duration: bubbleOff ? 140 : 240 });
  }, [bubbleOff, bubbleHide]);
  const toggleMini = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onToggleMini();
  };
  // Icon trong bong bóng: >< khi đầy đủ, <> (bung ra) khi đã thu gọn — đổi chéo mờ dần
  const iconFull = useAnimatedStyle(() => ({
    opacity: 1 - mini.value,
    transform: [{ scale: 1 - mini.value * 0.4 }, { rotate: `${mini.value * 90}deg` }],
  }));
  const iconMini = useAnimatedStyle(() => ({
    opacity: mini.value,
    transform: [{ scale: 0.6 + mini.value * 0.4 }, { rotate: `${(mini.value - 1) * 90}deg` }],
  }));
  const bubbleInner = (
    <Pressable
      onPress={toggleMini}
      accessibilityRole="button"
      accessibilityLabel={minimized ? 'Hiện lại dock và thanh địa chỉ' : 'Thu gọn dock và thanh địa chỉ'}
      accessibilityHint="Vuốt để mở các thẻ"
      style={({ pressed }) => [styles.plus, pressed && styles.pressed]}
    >
      <Animated.View style={[styles.bubbleIcon, iconFull]}>
        <Ionicons name="contract" size={s.icon} color={colors.text} />
      </Animated.View>
      <Animated.View style={[styles.bubbleIcon, iconMini]}>
        <Ionicons name="expand" size={s.icon} color={accent} />
      </Animated.View>
    </Pressable>
  );

  // Dock co lại rồi mờ đi về phía bong bóng (dock ngang: sang phải · dock dọc: co tại chỗ, chìm xuống)
  const bubbleDx = useSharedValue(0);
  const dockMini = useAnimatedStyle(() => {
    const p = mini.value;
    if (vertical) {
      return { opacity: 1 - p, transform: [{ translateY: p * H * 0.12 }, { scale: 1 - p * 0.4 }] };
    }
    const fit = fitFor(lens?.value ?? 0).scale;
    return { opacity: 1 - p, transform: [{ translateX: p * bubbleDx.value * 0.5 }, { scale: (1 - p * 0.35) * fit }] };
  });
  // Dock ngang: bong bóng trượt về góc dưới bên phải
  const bubbleMotion = useAnimatedStyle(() => ({
    opacity: 1 - bubbleHide.value,
    transform: [{ translateX: mini.value * bubbleDx.value }, { scale: 1 - bubbleHide.value * 0.2 }],
  }));
  const rowW = W - s.margin * 2;
  const onBubbleLayout = (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    bubbleDx.value = Math.max(0, rowW - width - x);
    bubLX.value = x;
    bubLW.value = width;
  };
  const onDockLayout = (e: LayoutChangeEvent) => {
    dockLX.value = e.nativeEvent.layout.x;
    dockLW.value = e.nativeEvent.layout.width;
  };

  // Bong bóng góc dưới bên trái (màn ngang): vuốt lên → màn các thẻ · vuốt trái/phải → thẻ bên cạnh (như dock)
  const ctx = useSharedValue(0);
  const cty = useSharedValue(0);
  const cZoom = useSharedValue(false);
  const cDist = H * 0.45;
  const cornerPan = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .activeOffsetY([-10, 10])
    .onUpdate((e) => {
      const up = -e.translationY;
      const alongUp = Math.abs(e.translationY) >= Math.abs(e.translationX);
      if (zoomEnabled && (cZoom.value || (alongUp && up > 4))) {
        if (!cZoom.value) {
          cZoom.value = true;
          ctx.value = 0;
          runOnJS(startZoom)();
        }
        const u = Math.max(0, up);
        cty.value = -(u > 160 ? 160 + (u - 160) * 0.4 : u);
        zoom.set(Math.min(1, u / cDist));
        return;
      }
      if (reduceMotion) return;
      cty.value = 0;
      ctx.value = alongUp ? 0 : e.translationX * 0.35;
    })
    .onEnd((e) => {
      if (cZoom.value) {
        cZoom.value = false;
        const v = e.velocityY;
        const open = zoom.value > 0.3 || v < -650;
        zoom.set(
          reduceMotion
            ? withTiming(open ? 1 : 0, { duration: 200 }, (f) => {
                if (f) runOnJS(onZoomEnd)(open);
              })
            : withSpring(open ? 1 : 0, { ...ZOOM_SPRING, velocity: Math.max(-1.2, Math.min(1.2, -v / cDist)) }, (f) => {
                if (f) runOnJS(onZoomEnd)(open);
              }),
        );
        return;
      }
      const ax = Math.abs(e.translationX);
      if (ax > SWIPE_SIDE && ax > Math.abs(e.translationY)) runOnJS(fireSide)(e.translationX < 0 ? 'next' : 'prev');
    })
    .onFinalize(() => {
      cZoom.value = false;
      ctx.value = withSpring(0, SPRING);
      cty.value = withSpring(0, BOUNCE);
    });
  const cornerMotion = useAnimatedStyle(() => ({
    opacity: 1 - bubbleHide.value,
    transform: [
      { translateX: ctx.value },
      { translateY: cty.value },
      { scale: 1 - bubbleHide.value * 0.2 },
    ],
  }));

  if (vertical) {
    // Nút ít cho vừa chiều cao màn ngang: thu nhỏ nút khi nhiều nút
    const room = H - 24 - insets.bottom;
    const btn = Math.min(
      s.button,
      Math.floor((room - 16 - GROUP_GAP * items.length) / Math.max(1, buttons.length + 1)),
    );
    return (
      <>
        {wrap(
          <Animated.View
            pointerEvents={hidden ? 'none' : 'box-none'}
            style={[styles.sideCol, { right: side.right, width: s.height }, motion]}
          >
            <Animated.View
              pointerEvents={minimized ? 'none' : 'box-none'}
              style={[{ transformOrigin: 'center' }, dockMini]}
            >
              <Glass radius={s.height / 2} style={{ width: s.height }}>
                <View style={[styles.colFloat, { gap: GROUP_GAP }]}>
                  {items.map((g) =>
                    g === 'plus' ? (
                      <View key="plus" style={{ width: btn, height: btn, alignItems: 'center', justifyContent: 'center' }}>
                        {renderPlus(btn)}
                      </View>
                    ) : (
                      <View key={g.join('-')} style={styles.groupCol}>
                        {g.map((id) => (
                          <View
                            key={id}
                            style={{ width: btn, height: btn, alignItems: 'center', justifyContent: 'center' }}
                          >
                            {renderButton(id, btn)}
                          </View>
                        ))}
                      </View>
                    ),
                  )}
                </View>
              </Glass>
            </Animated.View>
          </Animated.View>,
        )}
        <GestureDetector gesture={cornerPan}>
          <Animated.View
            pointerEvents={bubbleOff ? 'none' : 'box-none'}
            style={[
              styles.cornerPlus,
              {
                // Góc dưới bên trái, thẳng hàng với thanh địa chỉ (thanh ở màn ngang cách đáy max(12, inset dưới))
                bottom: Math.max(12, insets.bottom) + (ADDRESS_BAR_HEIGHT - s.height) / 2,
                left: Math.max(16, insets.left),
                width: s.height,
                height: s.height,
              },
              cornerMotion,
            ]}
          >
            <Glass radius={s.height / 2} style={{ width: s.height, height: s.height }}>
              {bubbleInner}
            </Glass>
          </Animated.View>
        </GestureDetector>
      </>
    );
  }

  const content = (
    <View style={[styles.row, { paddingHorizontal: attached ? 12 : 8 }]}>
      {groups.map((g) => (
        <View key={g.join('-')} style={styles.group}>
          {g.map((id) => renderButton(id))}
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
      {/* Dock nổi chỉ rộng vừa đủ chứa các nút; thu gọn thì co lại, mờ đi về phía bong bóng */}
      <Animated.View
        onLayout={onDockLayout}
        pointerEvents={minimized ? 'none' : 'box-none'}
        style={[{ transformOrigin: 'right center' }, dockMini]}
      >
        <Glass radius={s.height / 2} style={{ height: s.height }}>
          <View style={[styles.rowFloat, { gap: GROUP_GAP }]}>
            {items.map((g) =>
              g === 'plus' ? (
                renderPlus()
              ) : (
                <View key={g.join('-')} style={styles.group}>
                  {g.map((id) => renderButton(id))}
                </View>
              ),
            )}
          </View>
        </Glass>
      </Animated.View>
      <Animated.View
        onLayout={onBubbleLayout}
        pointerEvents={bubbleOff ? 'none' : 'box-none'}
        style={[{ marginLeft: 10 }, bubbleMotion]}
      >
        <Glass radius={s.height / 2} style={{ width: s.height, height: s.height }}>
          {bubbleInner}
        </Glass>
      </Animated.View>
    </Animated.View>,
  );
}

const makeStyles = (colors: Palette, fg: (alpha: number) => string) =>
  StyleSheet.create({
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
    groupCol: { flexDirection: 'column', alignItems: 'center' },
    sideCol: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' },
    colFloat: { flexDirection: 'column', alignItems: 'center', paddingVertical: 8 },
    cornerPlus: { position: 'absolute' },
    btn: { alignItems: 'center', justifyContent: 'center' },
    pressed: { backgroundColor: fg(0.1), transform: [{ scale: 0.94 }] },
    tabCount: { borderWidth: 2, borderColor: colors.text, alignItems: 'center', justifyContent: 'center' },
    plus: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    bubbleIcon: { position: 'absolute' },
  });
