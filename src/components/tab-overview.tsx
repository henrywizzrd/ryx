import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { memo, useEffect, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type HostInstance,
  type ScrollViewInstance,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  LayoutAnimationConfig,
  LinearTransition,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  ZoomIn,
  ZoomOut,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LAYOUT_MS } from '@/lib/motion';
import { faviconFor } from '@/lib/url';
import { NewTabPage } from './new-tab-page';
import type { TabLayout } from '@/state/settings';
import type { Tab } from '@/state/tabs';
import { colors, useTheme, fg } from '@/theme';
import { IconButton, type IconName } from './icon-button';
import { SwipeToClose } from './swipe-to-close';
import { showTabMenu, tabInfo } from './tab-card';
import { Txt } from './txt';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Bo góc của khung thẻ (để trang thu nhỏ bo đúng bằng thẻ) */
  radius?: number;
}

/** Khoá trạng thái của thẻ mà ảnh chụp phải khớp */
export const thumbKeyOf = (t: Tab) => `${t.home}|${t.url ?? ''}`;

export const TAB_LAYOUTS: { id: TabLayout; icon: IconName; label: string }[] = [
  { id: 'grid', icon: 'grid-outline', label: 'Lưới' },
  { id: 'list', icon: 'list-outline', label: 'Danh sách' },
  { id: 'split', icon: 'browsers-outline', label: 'Chia đôi' },
  { id: 'carousel', icon: 'albums-outline', label: 'Trượt ngang' },
  { id: 'coverflow', icon: 'film-outline', label: 'Coverflow 3D' },
  { id: 'cascade', icon: 'reorder-four-outline', label: 'Xếp tầng' },
];

export type OverviewPhase = 'drag' | 'open' | 'closing';
/** off/fly: màn các thẻ ẩn */
export type FullPhase = OverviewPhase | 'off' | 'fly';

interface Props {
  phase: FullPhase;
  /** 0 = đang xem trang, 1 = màn các thẻ (chạy theo ngón tay khi kéo dock) */
  zoom: SharedValue<number>;
  /** Kiểu Trượt ngang: dock trượt theo thẻ đang mở */
  dockShift: SharedValue<number>;
  tabs: Tab[];
  activeId: string;
  /** Thẻ đang được trang thật "đứng thay" trong lúc bay vào/ra → ẩn khung xem trước của nó */
  hideId: string | null;
  layout: TabLayout;
  bottomPad: number;
  onLayoutChange: (l: TabLayout) => void;
  onActiveFrame: (r: Rect) => void;
  /** Tăng mỗi lần mở màn các thẻ: cuộn tới thẻ đang mở rồi đo lại vị trí của nó */
  token: number;
  /** Nhận hàm đo vị trí thẻ đang mở (để nút Các thẻ phóng đúng chỗ) */
  onActiveMeasurer: (fn: Measurer) => void;
  onActiveThumbShown: (uri: string) => void;
  onPick: (id: string, r: Rect | null) => void;
  onClose: (id: string) => void;
  onDuplicate: (id: string) => void;
  onCloseAll: () => void;
  onNewTab: (r: Rect | null) => void;
}

const LAYOUT_ANIM = LinearTransition.springify(LAYOUT_MS).dampingRatio(1);
const ENTER = ZoomIn.springify(LAYOUT_MS).dampingRatio(1);
const EXIT = ZoomOut.duration(170);
const TITLE_H = 28;

type MeasureRef = React.RefObject<HostInstance | null>;
function measure(ref: MeasureRef, cb: (r: Rect | null) => void) {
  const node = ref.current;
  if (!node) return cb(null);
  node.measureInWindow((x, y, w, h) => cb(w > 0 ? { x, y, w, h } : null));
}

// ---------- Thẻ ----------

interface CardProps {
  tab: Tab;
  active: boolean;
  hidden: boolean;
  width: number;
  height: number;
  radius?: number;
  /** Tiêu đề nằm dưới thay vì trên khung xem trước */
  titleBelow?: boolean;
  noTitle?: boolean;
  previewStyle?: StyleProp<ViewStyle>;
  ctx: Ctx;
}

type Measurer = (cb: (r: Rect | null) => void) => void;

interface Ctx {
  /** Ảnh của thẻ đang mở đã hiện xong (để đổi từ trang thật sang ảnh không bị nháy) */
  onActiveThumbShown: (uri: string) => void;
  token: number;
  onActiveMeasurer: (fn: Measurer) => void;
  onPick: (id: string, r: Rect | null) => void;
  onClose: (id: string) => void;
  onDuplicate: (id: string) => void;
  onActiveFrame: (r: Rect) => void;
}

function Card({ tab, active, hidden, width, height, radius = 18, titleBelow, noTitle, previewStyle, ctx }: CardProps) {
  const { accent } = useTheme();
  const ref = useRef<HostInstance>(null);
  const { showPage, title, host, tint } = tabInfo(tab);
  const { token, onActiveMeasurer, onActiveFrame } = ctx;
  useEffect(() => {
    if (!active) return;
    onActiveMeasurer((cb) => measure(ref, cb));
    // Đợi bố cục cuộn tới thẻ (2 khung hình) rồi mới đo
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => measure(ref, (r) => r && onActiveFrame({ ...r, radius })));
    });
    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
  }, [active, token, onActiveMeasurer, onActiveFrame, radius]);

  const titleRow = noTitle ? null : (
    <View style={[styles.titleRow, { width }]}>
      {showPage ? (
        <Image source={faviconFor(tab.url!)} style={styles.fav} />
      ) : (
        <Ionicons name="shield-checkmark" size={13} color={accent} />
      )}
      <Txt weight={active ? 'semibold' : 'medium'} size={12} numberOfLines={1} style={{ flex: 1 }}>
        {title}
      </Txt>
      <IconButton
        icon="close"
        label="Đóng thẻ"
        size={28}
        iconSize={14}
        color={colors.textMuted}
        onPress={() => ctx.onClose(tab.id)}
      />
    </View>
  );

  return (
    <View style={{ width }}>
      {!titleBelow && titleRow}
      <Pressable
        ref={ref}
        collapsable={false}
        onPress={() => {
          void Haptics.selectionAsync();
          measure(ref, (r) => ctx.onPick(tab.id, r && { ...r, radius }));
        }}
        onLongPress={() =>
          showTabMenu(
            tab,
            () => ctx.onDuplicate(tab.id),
            () => ctx.onClose(tab.id),
          )
        }
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={`${title}${active ? ', đang mở' : ''}`}
        style={({ pressed }) => [
          styles.preview,
          { width, height, borderRadius: radius, backgroundColor: tint },
          active && { borderColor: accent, borderWidth: 2 },
          hidden && { opacity: 0 },
          pressed && { transform: [{ scale: 0.97 }] },
          previewStyle,
        ]}
      >
        {tab.thumb && tab.thumbKey === thumbKeyOf(tab) ? (
          // Ảnh chụp cả màn hình, khớp chiều ngang, cắt phần dưới — đúng như trang thật khi thu nhỏ vào khung
          <Image
            source={{ uri: tab.thumb }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            contentPosition="top"
            transition={0}
            onDisplay={active ? () => ctx.onActiveThumbShown(tab.thumb!) : undefined}
            accessibilityIgnoresInvertColors
          />
        ) : showPage ? (
          <>
            <Image source={faviconFor(tab.url!)} style={styles.bigFav} />
            <Txt size={12} color={colors.textMuted} numberOfLines={1} style={{ paddingHorizontal: 8 }}>
              {host}
            </Txt>
          </>
        ) : (
          <HomeMini width={width} />
        )}
      </Pressable>
      {titleBelow && titleRow}
    </View>
  );
}

/** Trang chủ Ryx thu nhỏ đúng tỉ lệ để làm ảnh xem trước của thẻ đang ở trang chủ */
function HomeMini({ width }: { width: number }) {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const s = width / W;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <View style={{ width: W, height: H, transformOrigin: 'left top', transform: [{ scale: s }] }}>
        <NewTabPage onSubmit={noop} onOpen={noop} onOpenNewTab={noop} paddingTop={insets.top} paddingBottom={0} />
      </View>
    </View>
  );
}
const noop = () => {};

/** Vỏ mỗi thẻ: hiệu ứng thêm/xoá + dồn chỗ có nảy, vuốt để đóng */
function Item({
  tab,
  dir,
  ctx,
  style,
  children,
}: {
  tab: Tab;
  dir: 'horizontal' | 'up';
  ctx: Ctx;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  return (
    <Animated.View entering={ENTER} exiting={EXIT} layout={LAYOUT_ANIM} style={style}>
      <SwipeToClose direction={dir} onClose={() => ctx.onClose(tab.id)}>
        {children}
      </SwipeToClose>
    </Animated.View>
  );
}

// ---------- Các kiểu sắp xếp ----------

/** Mỗi lần mở màn các thẻ: cuộn (không hiệu ứng) để thẻ đang mở nằm trong tầm nhìn */
function useReveal(token: number, x: number, y: number) {
  const ref = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    ref.current?.scrollTo({ x, y, animated: false });
  }, [token, x, y]);
  return ref;
}

interface LayoutProps {
  token: number;
  tabs: Tab[];
  activeId: string;
  hideId: string | null;
  ctx: Ctx;
  W: number;
  H: number;
  dockShift: SharedValue<number>;
}

function Grid({ tabs, activeId, hideId, ctx, W, H, token, cols }: LayoutProps & { cols: number }) {
  const pad = 16;
  const gap = cols === 2 ? 14 : 10;
  const w = Math.floor((W - pad * 2 - gap * (cols - 1)) / cols);
  const h = Math.round(w * (cols === 2 ? 1.38 : 1.5));
  const rowH = h + TITLE_H + gap;
  const ai = Math.max(
    0,
    tabs.findIndex((t) => t.id === activeId),
  );
  const y0 = Math.max(0, Math.floor(ai / cols) * rowH - H * 0.3);
  const ref = useReveal(token, 0, y0);
  return (
    <ScrollView ref={ref} contentOffset={{ x: 0, y: y0 }} contentContainerStyle={[styles.wrap, { padding: pad, gap }]}>
      {tabs.map((t) => (
        <Item key={t.id} tab={t} dir="horizontal" ctx={ctx}>
          <Card
            tab={t}
            active={t.id === activeId}
            hidden={t.id === hideId}
            width={w}
            height={h}
            radius={cols === 2 ? 18 : 14}
            ctx={ctx}
          />
        </Item>
      ))}
    </ScrollView>
  );
}

function List({ tabs, activeId, hideId, ctx, W, H, token }: LayoutProps) {
  const { accentSoft } = useTheme();
  const ai = Math.max(
    0,
    tabs.findIndex((t) => t.id === activeId),
  );
  const ref = useReveal(token, 0, Math.max(0, ai * 82 - H * 0.3));
  return (
    <ScrollView
      ref={ref}
      contentOffset={{ x: 0, y: Math.max(0, ai * 82 - H * 0.3) }}
      contentContainerStyle={{ padding: 16, gap: 10 }}
    >
      {tabs.map((t) => {
        const { title, host } = tabInfo(t);
        const active = t.id === activeId;
        return (
          <Item key={t.id} tab={t} dir="horizontal" ctx={ctx}>
            <View style={[styles.listRow, active && { backgroundColor: accentSoft }]}>
              <Card
                tab={t}
                active={active}
                hidden={t.id === hideId}
                width={52}
                height={52}
                radius={12}
                noTitle
                ctx={ctx}
              />
              <View style={{ flex: 1 }}>
                <Txt weight="medium" size={15} numberOfLines={1}>
                  {title}
                </Txt>
                <Txt size={12} color={colors.textMuted} numberOfLines={1}>
                  {host || 'Trang chủ Ryx'}
                </Txt>
              </View>
              <IconButton
                icon="close"
                label="Đóng thẻ"
                size={40}
                iconSize={16}
                color={colors.textMuted}
                onPress={() => ctx.onClose(t.id)}
              />
            </View>
          </Item>
        );
      })}
      <View style={{ height: 1, width: W - 32 }} />
    </ScrollView>
  );
}

/** Xếp tầng: thẻ to chồng thẳng lên nhau, thẻ sau thu nhỏ dần (không nghiêng) */
function Cascade({ tabs, activeId, hideId, ctx, W, H, token }: LayoutProps) {
  const h = Math.round(H * 0.46);
  const step = 128;
  const ai = Math.max(
    0,
    tabs.findIndex((t) => t.id === activeId),
  );
  const n = tabs.length;
  const ref = useReveal(token, 0, Math.max(0, ai * step - 60));
  return (
    <ScrollView
      ref={ref}
      contentOffset={{ x: 0, y: Math.max(0, ai * step - 60) }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 60 }}
    >
      {tabs.map((t, i) => (
        <Item
          key={t.id}
          tab={t}
          dir="horizontal"
          ctx={ctx}
          style={{
            marginTop: i === 0 ? 0 : -(h + TITLE_H - step),
            transform: [{ scale: 1 - Math.min(n - 1 - i, 4) * 0.025 }],
          }}
        >
          <View style={styles.cascadeShadow}>
            <Card
              tab={t}
              active={t.id === activeId}
              hidden={t.id === hideId}
              width={W - 32}
              height={h}
              radius={26}
              ctx={ctx}
            />
          </View>
        </Item>
      ))}
    </ScrollView>
  );
}

/** Trượt ngang kiểu Safari: thẻ hiện tại ở giữa, thẻ khác ló hai bên; dock trượt theo thẻ đang mở */
function Carousel({ tabs, activeId, hideId, ctx, W, H, token, dockShift }: LayoutProps) {
  const w = Math.round(W * 0.76);
  const h = Math.min(Math.round(H * 0.56), Math.round(w * 2));
  const gap = 16;
  const step = w + gap;
  const ai = Math.max(
    0,
    tabs.findIndex((t) => t.id === activeId),
  );
  const onScroll = useAnimatedScrollHandler((e) => {
    dockShift.set(ai * step - e.contentOffset.x);
  });
  const ref = useReveal(token, ai * step, 0);
  return (
    <View style={{ flex: 1, justifyContent: 'center' }}>
      <Animated.ScrollView
        ref={ref as never}
        horizontal
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        contentOffset={{ x: ai * step, y: 0 }}
        contentContainerStyle={{ paddingHorizontal: (W - w) / 2 - gap / 2, alignItems: 'center' }}
      >
        {tabs.map((t) => (
          <Item key={t.id} tab={t} dir="up" ctx={ctx} style={{ marginHorizontal: gap / 2 }}>
            <Card
              tab={t}
              active={t.id === activeId}
              hidden={t.id === hideId}
              width={w}
              height={h}
              radius={28}
              titleBelow
              ctx={ctx}
            />
          </Item>
        ))}
      </Animated.ScrollView>
    </View>
  );
}

function CoverItem({
  index,
  step,
  scroll,
  children,
}: {
  index: number;
  step: number;
  scroll: SharedValue<number>;
  children: React.ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    const d = (index * step - scroll.value) / step;
    const c = Math.max(-1.6, Math.min(1.6, d));
    return {
      transform: [
        { perspective: 900 },
        { translateX: interpolate(c, [-1.6, -1, 0, 1, 1.6], [step * 0.5, step * 0.32, 0, -step * 0.32, -step * 0.5]) },
        { rotateY: `${interpolate(c, [-1, 0, 1], [48, 0, -48], Extrapolation.CLAMP)}deg` },
        { scale: interpolate(Math.abs(c), [0, 1, 1.6], [1, 0.84, 0.76]) },
      ],
      opacity: interpolate(Math.abs(d), [0, 2, 3], [1, 0.9, 0], Extrapolation.CLAMP),
    };
  });
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** Coverflow 3D: thẻ giữa đứng thẳng, hai bên xoay nghiêng */
function Coverflow({ tabs, activeId, hideId, ctx, W, H, token }: LayoutProps) {
  const w = Math.round(W * 0.62);
  const h = Math.min(Math.round(H * 0.5), Math.round(w * 1.9));
  const step = Math.round(w * 0.78);
  const ai = Math.max(
    0,
    tabs.findIndex((t) => t.id === activeId),
  );
  const scroll = useSharedValue(ai * step);
  const onScroll = useAnimatedScrollHandler((e) => {
    scroll.value = e.contentOffset.x;
  });
  const ref = useReveal(token, ai * step, 0);
  return (
    <View style={{ flex: 1, justifyContent: 'center' }}>
      <Animated.ScrollView
        ref={ref as never}
        horizontal
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        contentOffset={{ x: ai * step, y: 0 }}
        contentContainerStyle={{ paddingHorizontal: (W - step) / 2, alignItems: 'center' }}
      >
        {tabs.map((t, i) => (
          <Item key={t.id} tab={t} dir="up" ctx={ctx} style={{ width: step, alignItems: 'center' }}>
            <CoverItem index={i} step={step} scroll={scroll}>
              <Card
                tab={t}
                active={t.id === activeId}
                hidden={t.id === hideId}
                width={w}
                height={h}
                radius={24}
                titleBelow
                ctx={ctx}
              />
            </CoverItem>
          </Item>
        ))}
      </Animated.ScrollView>
    </View>
  );
}

/** Chia đôi: các thẻ khác nhỏ, nghiêng ở cột trái; thẻ vừa thu nhỏ to bên phải */
function Split({ tabs, activeId, hideId, ctx, W, H }: LayoutProps) {
  const pad = 16;
  const gap = 16;
  const others = tabs.filter((t) => t.id !== activeId);
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  // Cân đối: lề trái = lề phải = 16, khoảng giữa 2 cột 16; chỉ có 1 thẻ thì thẻ lớn nằm giữa
  const alone = others.length === 0;
  const leftW = alone ? 0 : Math.round((W - pad * 2 - gap) * 0.34);
  const bigW = alone ? Math.round(W * 0.72) : W - pad * 2 - gap - leftW;
  const bigH = Math.min(H - 24 - TITLE_H, Math.round(bigW * 1.9));
  const smallW = leftW;
  return (
    <View style={{ flex: 1, flexDirection: 'row', paddingHorizontal: pad, gap, justifyContent: 'center' }}>
      {!alone && (
        <ScrollView
          style={{ width: leftW, flexGrow: 0 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 40, gap: 14 }}
        >
          {others.map((t) => (
            <Item
              key={t.id}
              tab={t}
              dir="horizontal"
              ctx={ctx}
              style={{ transform: [{ perspective: 700 }, { rotateY: '14deg' }] }}
            >
              <Card
                tab={t}
                active={false}
                hidden={t.id === hideId}
                width={smallW}
                height={Math.round(smallW * 1.6)}
                radius={14}
                ctx={ctx}
              />
            </Item>
          ))}
        </ScrollView>
      )}
      <View style={{ width: bigW, paddingTop: 8, paddingBottom: 16, justifyContent: 'center' }}>
        <Card
          tab={active}
          active
          hidden={active.id === hideId}
          width={bigW}
          height={Math.max(200, bigH)}
          radius={22}
          ctx={ctx}
        />
      </View>
    </View>
  );
}

// ---------- Màn các thẻ ----------

function TabOverviewImpl(props: Props) {
  const { phase, zoom, dockShift, tabs, activeId, hideId, layout, bottomPad } = props;
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const { accent, accentSoft, onAccent } = useTheme();
  const plusRef = useRef<HostInstance>(null);

  const ctx: Ctx = {
    onPick: props.onPick,
    onClose: (id) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      props.onClose(id);
    },
    onDuplicate: props.onDuplicate,
    onActiveFrame: props.onActiveFrame,
    token: props.token,
    onActiveMeasurer: props.onActiveMeasurer,
    onActiveThumbShown: props.onActiveThumbShown,
  };

  // Màn các thẻ hiện dần theo mức thu nhỏ của trang
  const fade = useAnimatedStyle(() => ({
    opacity: interpolate(zoom.value, [0, 0.55], [0, 1], Extrapolation.CLAMP),
    // Không phóng/thu cả màn: vị trí thẻ được đo khi màn này còn đang hiện dần, mà thu phóng thì số đo sai
    // (trước đây lệch 6% → trang bay vào khung to hơn thẻ thật rồi giật về đúng chỗ).
  }));

  const bodyH = H - insets.top - 104 - bottomPad;
  const lp: LayoutProps = { tabs, activeId, hideId, ctx, W, H: bodyH, dockShift, token: props.token };
  let body: React.ReactNode;
  switch (layout) {
    case 'list':
      body = <List {...lp} />;
      break;
    case 'cascade':
      body = <Cascade {...lp} />;
      break;
    case 'carousel':
      body = <Carousel {...lp} />;
      break;
    case 'coverflow':
      body = <Coverflow {...lp} />;
      break;
    case 'split':
      body = <Split {...lp} />;
      break;
    default:
      body = <Grid {...lp} cols={2} />;
  }

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, fade]}
      pointerEvents={phase === 'open' ? 'auto' : 'none'}
    >
      <View style={[styles.header, { marginTop: insets.top + 4 }]}>
        <Pressable onPress={props.onCloseAll} accessibilityRole="button" hitSlop={8} style={styles.headBtn}>
          <Txt weight="medium" size={15} color={colors.danger}>
            Đóng tất cả
          </Txt>
        </Pressable>
        <View pointerEvents="none" style={styles.count}>
          <Txt weight="bold" size={17} accessibilityRole="header">
            {tabs.length} thẻ
          </Txt>
        </View>
        <Pressable
          ref={plusRef}
          collapsable={false}
          onPress={() => measure(plusRef, (r) => props.onNewTab(r))}
          accessibilityRole="button"
          accessibilityLabel="Thẻ mới"
          hitSlop={6}
          style={({ pressed }) => [styles.plus, { backgroundColor: accent }, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="add" size={22} color={onAccent} />
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chips}
        contentContainerStyle={styles.chipsRow}
      >
        {TAB_LAYOUTS.map((l) => {
          const on = l.id === layout;
          return (
            <Pressable
              key={l.id}
              onPress={() => {
                void Haptics.selectionAsync();
                props.onLayoutChange(l.id);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [styles.chip, on && { backgroundColor: accentSoft }, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name={l.icon} size={15} color={on ? accent : colors.textMuted} />
              <Txt weight={on ? 'semibold' : 'medium'} size={13} color={on ? accent : colors.textMuted}>
                {l.label}
              </Txt>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={{ flex: 1, marginBottom: bottomPad }}>
        {/* Không chạy hiệu ứng "thêm thẻ" cho các thẻ có sẵn lúc mở màn này */}
        <LayoutAnimationConfig skipEntering>
          <View key={layout} style={{ flex: 1 }}>
            {body}
          </View>
        </LayoutAnimationConfig>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.bgDeep },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 52,
  },
  headBtn: { minHeight: 44, justifyContent: 'center', minWidth: 90 },
  plus: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  count: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  chips: { flexGrow: 0, marginTop: 6 },
  chipsRow: { paddingHorizontal: 12, gap: 6, height: 40, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 17 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, height: TITLE_H, paddingLeft: 4 },
  fav: { width: 14, height: 14, borderRadius: 3 },
  bigFav: { width: 40, height: 40, borderRadius: 10, marginBottom: 8 },
  preview: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: fg(0.14),
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 8,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  cascadeShadow: {
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
  },
});

/** Khoá nội dung của thẻ ảnh hưởng tới màn các thẻ (bỏ qua tiến trình tải… để không vẽ lại liên tục) */
const tabsKey = (tabs: Tab[]) =>
  tabs.map((t) => `${t.id}|${t.title}|${t.url}|${t.home}|${t.thumb}|${t.thumbKey}`).join('\n');

/**
 * Màn các thẻ luôn được gắn sẵn (ẩn) để lúc kéo dock không phải dựng từ đầu → không khựng khung hình đầu.
 * Khi đang xem trang (phase off) chỉ vẽ lại nếu danh sách thẻ đổi.
 */
export const TabOverview = memo(TabOverviewImpl, (a, b) => {
  if (a.phase !== b.phase || b.phase !== 'off') return false;
  return (
    a.activeId === b.activeId &&
    a.layout === b.layout &&
    a.bottomPad === b.bottomPad &&
    a.hideId === b.hideId &&
    tabsKey(a.tabs) === tabsKey(b.tabs)
  );
});
