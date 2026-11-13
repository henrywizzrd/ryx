import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DockButtonId, DockStyle } from '@/state/settings';
import { colors, useTheme } from '@/theme';
import { Glass } from './glass';
import { IconButton, type IconName } from './icon-button';
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
  onNewTab: () => void;
  /** Vuốt lên trên dock → màn các thẻ (giống Safari) */
  onSwipeUp: () => void;
  /** Vuốt ngang trên dock → thẻ bên cạnh */
  onSwipeSide: (dir: 'next' | 'prev') => void;
}

/** Ngưỡng để coi là "vuốt" (chưa tới thì vẫn là bấm nút bình thường). */
const SWIPE_UP = 36;
const SWIPE_SIDE = 56;

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
  onSwipeUp,
  onSwipeSide,
}: Props) {
  const insets = useSafeAreaInsets();
  const { accent } = useTheme();
  const s = SIZES[dockStyle];
  const m = dockMetrics(dockStyle, insets.bottom);
  const attached = dockStyle === 'attached';

  // Vuốt trên dock: chỉ kích hoạt khi ngón tay đã di chuyển đủ xa, nên bấm nút vẫn như cũ
  const swipe = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY([-12, 12])
    .activeOffsetX([-18, 18])
    .onEnd((e) => {
      const ax = Math.abs(e.translationX);
      const ay = Math.abs(e.translationY);
      if (-e.translationY > SWIPE_UP && ay > ax) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onSwipeUp();
      } else if (ax > SWIPE_SIDE && ax > ay) {
        onSwipeSide(e.translationX < 0 ? 'next' : 'prev');
      }
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
          onPress={onNewTab}
        />
      )}
    </View>
  );

  if (attached) {
    return wrap(
      <Glass
        radius={0}
        shadow={false}
        style={[styles.attached, { height: m.height }]}
        contentStyle={{ paddingBottom: insets.bottom }}
      >
        {content}
      </Glass>,
    );
  }

  return wrap(
    <View
      pointerEvents="box-none"
      style={[styles.floatRow, { left: s.margin, right: s.margin, bottom: m.bottom, height: s.height }]}
    >
      <Glass radius={s.height / 2} style={{ flex: 1, height: s.height }}>
        {content}
      </Glass>
      <Glass radius={s.height / 2} style={{ width: s.height, height: s.height, marginLeft: 10 }}>
        <Pressable
          onPress={onNewTab}
          accessibilityRole="button"
          accessibilityLabel="Thẻ mới"
          style={({ pressed }) => [styles.plus, pressed && styles.pressed]}
        >
          <Ionicons name="add" size={s.icon + 5} color={accent} />
        </Pressable>
      </Glass>
    </View>,
  );
}

const styles = StyleSheet.create({
  floatRow: { position: 'absolute', flexDirection: 'row' },
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
