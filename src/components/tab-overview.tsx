import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
  type HostInstance,
  type ScrollViewInstance,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  FadeIn,
  FadeOut,
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
import { scheduleOnRN } from 'react-native-worklets';

import { LAYOUT_MS } from '@/lib/motion';
import { ADDRESS_BAR_HEIGHT, addrBarWidth, CARD_ADDR_BOTTOM, StaticAddressBar, StaticLens } from './address-bar';
import { faviconFor } from '@/lib/url';
import { NewTabPage } from './new-tab-page';
import { useSettings, type TabLayout } from '@/state/settings';
import { byRecent, type Tab, type TabFolder } from '@/state/tabs';
import { useTheme, useStyles, type Palette } from '@/theme';
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
  /** Thanh địa chỉ của thẻ đang mở đang thu thành nút kính lúp */
  addrCollapsed?: boolean;
  /** Khung thẻ (kiểu Cốc Cốc) */
  folders: TabFolder[];
  /** Đang ở chế độ khung: chỉ hiện thẻ của khung này */
  folderMode: string | null;
  onFolderMode: (id: string | null) => void;
  /** Kéo thẻ thả lên thẻ/khung khác */
  onMerge: (dragId: string, targetId: string) => void;
  /** Bỏ thẻ ra khỏi khung */
  onUnfold: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onPick: (id: string, r: Rect | null) => void;
  onClose: (id: string) => void;
  onDuplicate: (id: string) => void;
  onCloseAll: () => void;
  /** Nhấn giữ nút +: danh sách thẻ vừa đóng */
  onShowClosed: (x: number, y: number) => void;
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

// ---------- Khung thẻ + kéo thả ----------

interface FolderInfo {
  id: string;
  name: string;
  tabs: Tab[];
}
/** Một ô ở màn các thẻ: thẻ lẻ, hoặc khung (id = id khung, các trường khác lấy của thẻ dùng gần nhất trong khung) */
type Entry = Tab & { folder?: FolderInfo };

interface HitRect extends Rect {
  id: string;
}
interface DragInfo {
  id: string;
  tab: Tab;
  w: number;
  h: number;
  radius: number;
  /** grid: kéo ở màn các thẻ (thả lên thẻ khác để gộp) · folder: kéo trong khung đang mở (kéo ra ngoài để bỏ khỏi khung) */
  source: 'grid' | 'folder';
}
interface DragApi {
  absX: SharedValue<number>;
  absY: SharedValue<number>;
  offX: SharedValue<number>;
  offY: SharedValue<number>;
  rects: SharedValue<HitRect[]>;
  hoverSv: SharedValue<string>;
  moved: SharedValue<number>;
  begin: (d: DragInfo) => void;
  end: (moved: boolean, target: string, x: number, y: number) => void;
  hover: (id: string) => void;
}

/** Nhấn giữ ~0,3 giây rồi kéo: thẻ nhấc lên theo ngón tay. Thả ra mà chưa kéo thì hiện menu của thẻ. */
function Draggable({
  info,
  ctx,
  enabled = true,
  children,
}: {
  info: DragInfo;
  ctx: Ctx;
  enabled?: boolean;
  children: React.ReactNode;
}) {
  const { absX, absY, offX, offY, rects, hoverSv, moved, begin, end, hover } = ctx.drag;
  const { id, source } = info;
  const onBegin = () => begin(info);
  const onEnd = (m: boolean, target: string, x: number, y: number) => end(m, target, x, y);
  const onHover = (h: string) => hover(h);
  const pan = Gesture.Pan()
    .enabled(enabled)
    .activateAfterLongPress(320)
    .onStart((e) => {
      absX.set(e.absoluteX);
      absY.set(e.absoluteY);
      offX.set(e.x);
      offY.set(e.y);
      hoverSv.set('');
      moved.set(0);
      scheduleOnRN(onBegin);
    })
    .onUpdate((e) => {
      absX.set(e.absoluteX);
      absY.set(e.absoluteY);
      if (Math.abs(e.translationX) + Math.abs(e.translationY) > 10) moved.set(1);
      if (source !== 'grid') return;
      const list = rects.get();
      let hit = '';
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (
          r.id !== id &&
          e.absoluteX >= r.x &&
          e.absoluteX <= r.x + r.w &&
          e.absoluteY >= r.y &&
          e.absoluteY <= r.y + r.h
        ) {
          hit = r.id;
          break;
        }
      }
      if (hit !== hoverSv.get()) {
        hoverSv.set(hit);
        scheduleOnRN(onHover, hit);
      }
    })
    // Gọi cả khi cử chỉ không bắt đầu (chạm nhanh): lúc đó chưa có gì đang kéo nên end() bỏ qua
    .onFinalize(() => {
      scheduleOnRN(onEnd, moved.get() === 1, hoverSv.get(), absX.get(), absY.get());
    });
  return (
    <GestureDetector gesture={pan}>
      <Animated.View collapsable={false}>{children}</Animated.View>
    </GestureDetector>
  );
}

/** Ảnh thu nhỏ của một thẻ (dùng trong khung, trong bảng khung đang mở, và bản nhấc lên khi kéo) */
function MiniThumb({
  tab,
  width,
  height,
  radius,
  onDisplay,
}: {
  tab: Tab;
  width: number;
  height: number;
  radius: number;
  onDisplay?: (uri: string) => void;
}) {
  const { colors, accent } = useTheme();
  const { showPage, tint } = tabInfo(tab, colors);
  const box = { width, height, borderRadius: radius, overflow: 'hidden' as const };
  if (tab.thumb && tab.thumbKey === thumbKeyOf(tab))
    return (
      <View style={[box, { backgroundColor: tint }]}>
        <Image
          source={{ uri: tab.thumb }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          contentPosition="top"
          transition={0}
          onDisplay={onDisplay ? () => onDisplay(tab.thumb!) : undefined}
          accessibilityIgnoresInvertColors
        />
      </View>
    );
  const icon = Math.max(10, Math.min(28, Math.round(width * 0.34)));
  return (
    <View
      style={[box, { backgroundColor: showPage ? tint : colors.bg, alignItems: 'center', justifyContent: 'center' }]}
    >
      {showPage ? (
        <Image source={faviconFor(tab.url!)} style={{ width: icon, height: icon, borderRadius: icon * 0.22 }} />
      ) : (
        <Ionicons name="shield-checkmark" size={icon} color={accent} />
      )}
    </View>
  );
}

/** Mặt khung: lưới 2×2 ảnh thu nhỏ như thư mục ở màn hình chính iPhone; hơn 4 thẻ thì ô cuối chia nhỏ 2×2 */
function FolderGrid({
  folder,
  width,
  height,
  activeTabId,
  onActiveShown,
}: {
  folder: FolderInfo;
  width: number;
  height: number;
  activeTabId?: string;
  onActiveShown?: (uri: string) => void;
}) {
  const styles = useStyles(makeStyles);
  const { fg } = useTheme();
  const pad = Math.max(3, Math.round(width * 0.07));
  const gap = Math.max(2, Math.round(width * 0.045));
  const cw = Math.floor((width - pad * 2 - gap) / 2);
  const ch = Math.floor((height - pad * 2 - gap) / 2);
  const r = Math.max(3, Math.round(cw * 0.12));
  const many = folder.tabs.length > 4;
  const main = folder.tabs.slice(0, many ? 3 : 4);
  const rest = many ? folder.tabs.slice(3, 7) : [];
  const g2 = Math.max(1, Math.round(gap / 2));
  const sw = Math.floor((cw - g2) / 2);
  const sh = Math.floor((ch - g2) / 2);
  const shown = (t: Tab) => (t.id === activeTabId ? onActiveShown : undefined);
  return (
    <View style={[StyleSheet.absoluteFill, { padding: pad, backgroundColor: fg(0.07) }]}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap, width: cw * 2 + gap }}>
        {main.map((t) => (
          <MiniThumb key={t.id} tab={t} width={cw} height={ch} radius={r} onDisplay={shown(t)} />
        ))}
        {many && (
          <View style={{ width: cw, height: ch, flexDirection: 'row', flexWrap: 'wrap', gap: g2 }}>
            {rest.map((t) => (
              <MiniThumb key={t.id} tab={t} width={sw} height={sh} radius={Math.max(2, r / 2)} onDisplay={shown(t)} />
            ))}
          </View>
        )}
      </View>
      {width >= 70 && (
        <View style={styles.badge}>
          <Txt weight="bold" size={11} color="#fff">
            {folder.tabs.length}
          </Txt>
        </View>
      )}
    </View>
  );
}

// ---------- Thẻ ----------

interface CardProps {
  tab: Entry;
  active: boolean;
  /** Chia đôi: khung chứa thẻ đang mở (thẻ đó đang hiện to) → viền nét đứt */
  ring?: boolean;
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
  /** Id thẻ đang mở thật (khi ô đang mở là một khung) */
  activeTabId: string;
  /** Ảnh của thẻ đang mở đã hiện xong (để đổi từ trang thật sang ảnh không bị nháy) */
  onActiveThumbShown: (uri: string) => void;
  /** Thanh địa chỉ của thẻ đang mở đang thu thành nút kính lúp */
  addrCollapsed?: boolean;
  token: number;
  onActiveMeasurer: (fn: Measurer) => void;
  onPick: (id: string, r: Rect | null) => void;
  onClose: (id: string) => void;
  onDuplicate: (id: string) => void;
  onActiveFrame: (r: Rect) => void;
  onOpenFolder: (id: string) => void;
  /** Đăng ký hàm đo vị trí của một ô (để biết đang kéo thẻ đè lên ô nào) */
  register: (id: string, m: Measurer) => () => void;
  drag: DragApi;
  /** Ô đang được kéo (mờ đi ở chỗ cũ) và ô đang bị kéo đè lên (sẽ gộp vào) */
  dragId: string | null;
  hoverId: string | null;
}

function Card({
  tab,
  active,
  ring,
  hidden,
  width,
  height,
  radius = 18,
  titleBelow,
  noTitle,
  previewStyle,
  ctx,
}: CardProps) {
  const styles = useStyles(makeStyles);

  const { accent, colors, fg } = useTheme();
  const ref = useRef<HostInstance>(null);
  const { showPage, title, host, tint, blocked } = tabInfo(tab, colors);
  const { width: W } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const addrAtTop = useSettings().settings.addressBarPosition === 'top';
  const { token, onActiveMeasurer, onActiveFrame, register } = ctx;
  const folder = tab.folder;
  const ghost = ctx.dragId === tab.id;
  const targeted = ctx.hoverId === tab.id;
  useEffect(() => register(tab.id, (cb) => measure(ref, cb)), [register, tab.id]);
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

  const titleRow = noTitle ? null : folder ? (
    <View style={[styles.titleRow, { width }]}>
      <Ionicons name="folder-open" size={13} color={accent} />
      <Txt weight={active || ring ? 'semibold' : 'medium'} size={12} numberOfLines={1} style={{ flex: 1 }}>
        {folder.name}
      </Txt>
      <Txt size={12} color={colors.textMuted} style={{ paddingRight: 8 }}>
        {folder.tabs.length}
      </Txt>
    </View>
  ) : (
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
      <Draggable info={{ id: tab.id, tab, w: width, h: height, radius, source: 'grid' }} ctx={ctx} enabled={!folder}>
        <Pressable
          ref={ref}
          collapsable={false}
          onPress={() => {
            void Haptics.selectionAsync();
            if (folder) ctx.onOpenFolder(folder.id);
            else measure(ref, (r) => ctx.onPick(tab.id, r && { ...r, radius }));
          }}
          accessibilityRole="button"
          accessibilityLabel={
            folder
              ? `Khung ${folder.name}, ${folder.tabs.length} thẻ`
              : `${title}${active ? ', đang mở' : ''}. Nhấn giữ rồi kéo lên thẻ khác để gộp thành khung`
          }
          style={({ pressed }) => [
            styles.preview,
            { width, height, borderRadius: radius, backgroundColor: folder ? colors.surface : tint },
            hidden && { opacity: 0 },
            ghost && { opacity: 0.25 },
            pressed && { transform: [{ scale: 0.97 }] },
            targeted && { transform: [{ scale: 0.9 }] },
            previewStyle,
          ]}
        >
          {folder ? (
            <FolderGrid
              folder={folder}
              width={width}
              height={height}
              activeTabId={active ? ctx.activeTabId : undefined}
              onActiveShown={ctx.onActiveThumbShown}
            />
          ) : tab.thumb && tab.thumbKey === thumbKeyOf(tab) ? (
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
          {/* Chỉ thẻ đang mở (vừa thu nhỏ): thanh địa chỉ đúng chỗ, đúng tỉ lệ như trang thật lúc thu nhỏ (dock ẩn) */}
          {active && !folder && ctx.addrCollapsed && !addrAtTop && (
            // Thanh đang thu thành nút kính lúp: nút tròn sát mép trái, đúng như trang thật lúc thu nhỏ
            <View
              pointerEvents="none"
              style={[
                styles.cardAddr,
                {
                  left: 16 * (width / W),
                  top: height - (CARD_ADDR_BOTTOM + ADDRESS_BAR_HEIGHT) * (width / W),
                  transform: [{ scale: width / W }],
                },
              ]}
            >
              <StaticLens />
            </View>
          )}
          {active && !folder && !(ctx.addrCollapsed && !addrAtTop) && (
            <View
              pointerEvents="none"
              style={[
                styles.cardAddr,
                addrAtTop
                  ? { top: (insets.top + 4) * (width / W) }
                  : { top: height - (CARD_ADDR_BOTTOM + ADDRESS_BAR_HEIGHT) * (width / W) },
                { left: (width - addrBarWidth(W) * (width / W)) / 2, transform: [{ scale: width / W }] },
              ]}
            >
              <StaticAddressBar tab={tab} blocked={blocked} width={addrBarWidth(W)} />
            </View>
          )}
          {/* Viền vẽ ĐÈ lên ảnh (không đẩy ảnh vào trong), giống hệt viền mà trang thật có lúc thu nhỏ → đổi qua lại không nháy */}
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { borderRadius: radius },
              targeted
                ? { borderWidth: 3, borderColor: accent }
                : active
                  ? { borderWidth: 2, borderColor: accent }
                  : ring
                    ? { borderWidth: 2, borderColor: accent, borderStyle: 'dashed' }
                    : { borderWidth: StyleSheet.hairlineWidth, borderColor: fg(0.14) },
            ]}
          />
        </Pressable>
      </Draggable>
      {titleBelow && titleRow}
    </View>
  );
}

/** Trang chủ Ryx thu nhỏ đúng tỉ lệ để làm ảnh xem trước của thẻ đang ở trang chủ */
function HomeMini({ width }: { width: number }) {
  const { colors } = useTheme();

  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const s = width / W;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <View style={{ width: W, height: H, transformOrigin: 'left top', transform: [{ scale: s }] }}>
        <NewTabPage
          onSubmit={noop}
          onOpen={noop}
          onOpenNewTab={noop}
          paddingTop={insets.top}
          paddingBottom={0}
          preview
        />
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
  tab: Entry;
  dir: 'horizontal' | 'right' | 'up';
  ctx: Ctx;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  // Khung không vuốt để đóng (tránh lỡ tay đóng cả loạt thẻ)
  if (tab.folder)
    return (
      <Animated.View entering={ENTER} exiting={EXIT} layout={LAYOUT_ANIM} style={style}>
        {children}
      </Animated.View>
    );
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
  tabs: Entry[];
  /** Ô đang mở (có thể là khung chứa thẻ đang mở) */
  activeId: string;
  /** Thẻ đang mở thật (Chia đôi luôn hiện to thẻ này) */
  activeTab: Tab;
  hideId: string | null;
  ctx: Ctx;
  W: number;
  H: number;
  dockShift: SharedValue<number>;
}

function Grid({ tabs, activeId, hideId, ctx, W, H, token, cols }: LayoutProps & { cols: number }) {
  const styles = useStyles(makeStyles);

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
    <ScrollView
      ref={ref}
      scrollEnabled={!ctx.dragId}
      contentOffset={{ x: 0, y: y0 }}
      contentContainerStyle={[styles.wrap, { padding: pad, gap }]}
    >
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
  const styles = useStyles(makeStyles);

  const { accentSoft, colors } = useTheme();
  const ai = Math.max(
    0,
    tabs.findIndex((t) => t.id === activeId),
  );
  const ref = useReveal(token, 0, Math.max(0, ai * 82 - H * 0.3));
  return (
    <ScrollView
      ref={ref}
      scrollEnabled={!ctx.dragId}
      contentOffset={{ x: 0, y: Math.max(0, ai * 82 - H * 0.3) }}
      contentContainerStyle={{ padding: 16, gap: 10 }}
    >
      {tabs.map((t) => {
        const info = tabInfo(t, colors);
        const title = t.folder ? t.folder.name : info.title;
        const host = t.folder ? `Khung · ${t.folder.tabs.length} thẻ` : info.host;
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
              {t.folder ? (
                <IconButton
                  icon="chevron-forward"
                  label="Mở khung"
                  size={40}
                  iconSize={16}
                  color={colors.textMuted}
                  onPress={() => ctx.onOpenFolder(t.id)}
                />
              ) : (
                <IconButton
                  icon="close"
                  label="Đóng thẻ"
                  size={40}
                  iconSize={16}
                  color={colors.textMuted}
                  onPress={() => ctx.onClose(t.id)}
                />
              )}
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
  const styles = useStyles(makeStyles);

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
      scrollEnabled={!ctx.dragId}
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
        scrollEnabled={!ctx.dragId}
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
        scrollEnabled={!ctx.dragId}
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
function Split(props: LayoutProps) {
  const { width: SW, height: SH } = useWindowDimensions();
  return SW > SH ? <SplitLandscape {...props} /> : <SplitPortrait {...props} />;
}

/**
 * Chia đôi khi xoay ngang: thẻ đang mở nằm ngang ở giữa phía trên, các thẻ khác xếp một hàng ngang phía dưới
 * (trái qua phải, cuộn ngang). Thẻ theo đúng tỉ lệ màn hình ngang. Vuốt lên để đóng.
 */
function SplitLandscape({ tabs, activeTab: active, hideId, ctx, W, H }: LayoutProps) {
  const { width: SW, height: SH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const aspect = SW / SH;
  const others = tabs.filter((t) => t.id !== active.id);
  const smallH = others.length ? Math.max(56, Math.round(H * 0.27)) : 0;
  const smallW = Math.round(smallH * aspect);
  const rowH = others.length ? smallH + 12 : 0;
  const maxBigH = Math.max(80, H - rowH - TITLE_H - 12);
  const bigW = Math.min(W - insets.left - insets.right - 48, Math.round(maxBigH * aspect));
  const bigH = Math.round(bigW / aspect);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Item key={active.id} tab={active} dir="up" ctx={ctx}>
        <Card tab={active} active hidden={active.id === hideId} width={bigW} height={bigH} radius={16} ctx={ctx} />
      </Item>
      {others.length > 0 && (
        <ScrollView
          horizontal
          scrollEnabled={!ctx.dragId}
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, alignSelf: 'stretch', marginTop: 12 }}
          contentContainerStyle={{ paddingLeft: insets.left + 24, paddingRight: insets.right + 24, gap: 14 }}
        >
          {others.map((t) => (
            <Item key={t.id} tab={t} dir="up" ctx={ctx}>
              <Card
                tab={t}
                active={false}
                ring={!!t.folder?.tabs.some((x) => x.id === active.id)}
                hidden={t.id === hideId}
                width={smallW}
                height={smallH}
                radius={10}
                noTitle
                ctx={ctx}
              />
            </Item>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function SplitPortrait({ tabs, activeTab: active, hideId, ctx, W, H }: LayoutProps) {
  const pad = 16;
  const gap = 16;
  // Thẻ lớn luôn là thẻ đang mở; nếu nó nằm trong khung thì khung vẫn ở cột nhỏ (viền nét đứt)
  const others = tabs.filter((t) => t.id !== active.id);
  // Cân đối: lề trái = lề phải = 16, khoảng giữa 2 cột 16; chỉ có 1 thẻ thì thẻ lớn nằm giữa.
  // Thẻ nhỏ ở bên phải cho vừa tầm ngón cái tay phải (row-reverse), nghiêng vào phía thẻ lớn.
  const alone = others.length === 0;
  const leftW = alone ? 0 : Math.round((W - pad * 2 - gap) * 0.34);
  const bigW = alone ? Math.round(W * 0.72) : W - pad * 2 - gap - leftW;
  const bigH = Math.min(H - 24 - TITLE_H, Math.round(bigW * 1.9));
  const smallW = leftW;
  return (
    <View style={{ flex: 1, flexDirection: 'row-reverse', paddingHorizontal: pad, gap, justifyContent: 'center' }}>
      {!alone && (
        <ScrollView
          scrollEnabled={!ctx.dragId}
          style={{ width: leftW, flexGrow: 0 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 40, gap: 14 }}
        >
          {others.map((t) => (
            <Item
              key={t.id}
              tab={t}
              // Thẻ nhỏ nằm bên phải: vuốt sang phải (ra mép màn hình) là đóng
              dir="right"
              ctx={ctx}
              style={{ transform: [{ perspective: 700 }, { rotateY: '-14deg' }] }}
            >
              <Card
                tab={t}
                active={false}
                ring={!!t.folder?.tabs.some((x) => x.id === active.id)}
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
        {/* Thẻ lớn (thẻ đang mở): vuốt lên là đóng */}
        {/* key theo thẻ: đóng thẻ lớn xong thì thẻ mới lên thay là khung mới (không kế thừa vị trí đã vuốt đi) */}
        <Item key={active.id} tab={active} dir="up" ctx={ctx}>
          <Card
            tab={active}
            active
            hidden={active.id === hideId}
            width={bigW}
            height={Math.max(200, bigH)}
            radius={22}
            ctx={ctx}
          />
        </Item>
      </View>
    </View>
  );
}

/** Bảng khung đang mở: nổi lên giữa màn, đổi tên được; chạm thẻ để vào chế độ khung, kéo thẻ ra ngoài để bỏ khỏi khung */
function FolderPopup({
  folder,
  ctx,
  panelRef,
  onClose,
  onRename,
  onEnter,
}: {
  folder: FolderInfo;
  ctx: Ctx;
  panelRef: MeasureRef;
  onClose: () => void;
  onRename: (name: string) => void;
  onEnter: (tabId: string, r: Rect | null) => void;
}) {
  const styles = useStyles(makeStyles);
  const { colors, scheme } = useTheme();
  const { width: W, height: H } = useWindowDimensions();
  const landscape = W > H;
  const cols = landscape ? 4 : 3;
  const panelW = Math.min(W - 48, landscape ? 600 : 400);
  const gap = 12;
  const cellW = Math.floor((panelW - 32 - gap * (cols - 1)) / cols);
  const cellH = Math.round(cellW * Math.min(1.6, H / W));
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(150)}
      style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Đóng khung">
        <BlurView intensity={30} tint={scheme === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.25)' }]} />
      </Pressable>
      <Animated.View entering={ENTER}>
        <View ref={panelRef} collapsable={false} style={[styles.panel, { width: panelW }]}>
          <TextInput
            defaultValue={folder.name}
            onEndEditing={(e) => onRename(e.nativeEvent.text)}
            returnKeyType="done"
            selectTextOnFocus
            maxLength={40}
            accessibilityLabel="Tên khung"
            style={[styles.folderName, { color: colors.text }]}
          />
          <ScrollView
            style={{ maxHeight: H * (landscape ? 0.5 : 0.55), flexGrow: 0 }}
            scrollEnabled={!ctx.dragId}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap }}
          >
            {folder.tabs.map((t) => (
              <FolderCell key={t.id} tab={t} w={cellW} h={cellH} ctx={ctx} onEnter={onEnter} />
            ))}
          </ScrollView>
          <Txt size={12} color={colors.textMuted} style={{ textAlign: 'center', marginTop: 12 }}>
            Nhấn giữ rồi kéo thẻ ra ngoài để bỏ khỏi khung
          </Txt>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

function FolderCell({
  tab,
  w,
  h,
  ctx,
  onEnter,
}: {
  tab: Tab;
  w: number;
  h: number;
  ctx: Ctx;
  onEnter: (tabId: string, r: Rect | null) => void;
}) {
  const { colors, accent, fg } = useTheme();
  const ref = useRef<HostInstance>(null);
  const { title } = tabInfo(tab, colors);
  const active = tab.id === ctx.activeTabId;
  return (
    <View style={{ width: w }}>
      <Draggable info={{ id: tab.id, tab, w, h, radius: 14, source: 'folder' }} ctx={ctx}>
        <Pressable
          ref={ref}
          collapsable={false}
          onPress={() => {
            void Haptics.selectionAsync();
            measure(ref, (r) => onEnter(tab.id, r && { ...r, radius: 14 }));
          }}
          accessibilityRole="button"
          accessibilityLabel={`${title}. Mở thẻ trong khung`}
          style={({ pressed }) => [
            { width: w, height: h, borderRadius: 14 },
            ctx.dragId === tab.id && { opacity: 0.25 },
            pressed && { transform: [{ scale: 0.96 }] },
          ]}
        >
          <MiniThumb tab={tab} width={w} height={h} radius={14} />
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { borderRadius: 14 },
              active
                ? { borderWidth: 2, borderColor: accent }
                : { borderWidth: StyleSheet.hairlineWidth, borderColor: fg(0.14) },
            ]}
          />
        </Pressable>
      </Draggable>
      <Txt
        size={11}
        weight={active ? 'semibold' : 'regular'}
        numberOfLines={1}
        style={{ marginTop: 4, textAlign: 'center' }}
      >
        {title}
      </Txt>
    </View>
  );
}

// ---------- Màn các thẻ ----------

function TabOverviewImpl(props: Props) {
  const styles = useStyles(makeStyles);

  const { phase, zoom, dockShift, activeId, hideId, layout, bottomPad, folderMode } = props;
  // Thứ tự thẻ: dùng gần nhất trước (thẻ đang mở đầu tiên, thẻ vừa dùng/vừa mở thứ 2…), ở mọi kiểu xếp.
  // Chốt thứ tự mỗi lần mở màn này (token) để chọn thẻ xong các thẻ không nhảy chỗ trong lúc zoom vào.
  const [order, setOrder] = useState(() => ({
    token: props.token,
    ids: [...props.tabs].sort(byRecent).map((t) => t.id),
  }));
  if (order.token !== props.token)
    setOrder({ token: props.token, ids: [...props.tabs].sort(byRecent).map((t) => t.id) });
  const rank = new Map(order.ids.map((id, i) => [id, i]));
  // Thẻ mới thêm sau khi mở màn (chưa có trong thứ tự chốt) đứng đầu
  const tabs = [...props.tabs].sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1));
  const activeTab = props.tabs.find((t) => t.id === activeId) ?? tabs[0];

  // Gom thẻ trong khung thành một ô (đứng ở chỗ thẻ dùng gần nhất của khung). Chế độ khung thì hiện từng thẻ.
  const folderById = new Map(props.folders.map((f) => [f.id, f]));
  const entries: Entry[] = [];
  if (folderMode) entries.push(...tabs);
  else {
    const seen = new Map<string, FolderInfo>();
    for (const t of tabs) {
      const f = t.folderId ? folderById.get(t.folderId) : undefined;
      if (!f) {
        entries.push(t);
        continue;
      }
      const ex = seen.get(f.id);
      if (ex) ex.tabs.push(t);
      else {
        const info: FolderInfo = { id: f.id, name: f.name, tabs: [t] };
        seen.set(f.id, info);
        entries.push({ ...t, id: f.id, folder: info });
      }
    }
  }
  const entryOf = (id: string) => entries.find((e) => e.id === id || e.folder?.tabs.some((t) => t.id === id))?.id ?? id;
  const split = layout === 'split';

  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const { accent, accentSoft, onAccent, colors } = useTheme();
  const plusRef = useRef<HostInstance>(null);

  // ---- Bảng khung đang mở (đóng lại mỗi lần mở màn các thẻ) ----
  const [popup, setPopup] = useState<{ token: number; id: string | null }>({ token: props.token, id: null });
  const popupId = popup.token === props.token ? popup.id : null;
  const popupFolder = popupId ? entries.find((e) => e.id === popupId)?.folder : undefined;
  const panelRef = useRef<HostInstance>(null);

  // ---- Kéo thả ----
  const absX = useSharedValue(0);
  const absY = useSharedValue(0);
  const offX = useSharedValue(0);
  const offY = useSharedValue(0);
  const rects = useSharedValue<HitRect[]>([]);
  const hoverSv = useSharedValue('');
  const moved = useSharedValue(0);
  const [drag, setDrag] = useState<DragInfo | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const dragRef = useRef<DragInfo | null>(null);
  const panelRect = useRef<Rect | null>(null);
  const measurers = useRef(new Map<string, Measurer>());
  const register = useCallback((id: string, m: Measurer) => {
    measurers.current.set(id, m);
    return () => {
      if (measurers.current.get(id) === m) measurers.current.delete(id);
    };
  }, []);
  const begin = (d: DragInfo) => {
    dragRef.current = d;
    setDrag(d);
    setHoverId(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (d.source === 'folder') {
      rects.set([]);
      panelRect.current = null;
      panelRef.current?.measureInWindow((x, y, w, h) => {
        panelRect.current = w > 0 ? { x, y, w, h } : null;
      });
      return;
    }
    // Chụp vị trí mọi ô lúc bắt đầu kéo (màn không cuộn trong lúc kéo)
    const list = [...measurers.current.entries()].filter(([id]) => id !== d.id);
    const out: HitRect[] = [];
    let left = list.length;
    list.forEach(([id, m]) =>
      m((r) => {
        if (r) out.push({ id, ...r });
        if (--left === 0) rects.set(out);
      }),
    );
  };
  const end = (wasMoved: boolean, target: string, x: number, y: number) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setDrag(null);
    setHoverId(null);
    rects.set([]);
    if (!wasMoved) {
      // Nhấn giữ rồi thả (không kéo): menu của thẻ như trước
      const inFolder = d.source === 'folder' || !!folderMode;
      showTabMenu(
        d.tab,
        () => props.onDuplicate(d.id),
        () => ctx.onClose(d.id),
        inFolder ? () => props.onUnfold(d.id) : undefined,
      );
      return;
    }
    if (d.source === 'grid') {
      if (target) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        props.onMerge(d.id, target);
      }
      return;
    }
    const p = panelRect.current;
    if (p && (x < p.x || x > p.x + p.w || y < p.y || y > p.y + p.h)) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      props.onUnfold(d.id);
    }
  };
  const hover = (id: string) => {
    if (id) void Haptics.selectionAsync();
    setHoverId(id || null);
  };
  const lift = useAnimatedStyle(() => ({
    transform: [{ translateX: absX.get() - offX.get() }, { translateY: absY.get() - offY.get() }, { scale: 1.06 }],
  }));

  const ctx: Ctx = {
    activeTabId: activeId,
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
    addrCollapsed: props.addrCollapsed,
    onOpenFolder: (id) => setPopup({ token: props.token, id }),
    register,
    drag: { absX, absY, offX, offY, rects, hoverSv, moved, begin, end, hover },
    dragId: drag?.id ?? null,
    hoverId,
  };

  // Màn các thẻ hiện dần theo mức thu nhỏ của trang
  const fade = useAnimatedStyle(() => ({
    opacity: interpolate(zoom.value, [0, 0.55], [0, 1], Extrapolation.CLAMP),
    // Không phóng/thu cả màn: vị trí thẻ được đo khi màn này còn đang hiện dần, mà thu phóng thì số đo sai
    // (trước đây lệch 6% → trang bay vào khung to hơn thẻ thật rồi giật về đúng chỗ).
  }));

  // Màn ngang: hàng kiểu sắp xếp lên chung hàng với "Đóng tất cả" / nút + để dành chiều cao cho thẻ
  const landscape = W > H;
  const bodyH = H - insets.top - (landscape ? 60 : 104) - bottomPad;
  const lp: LayoutProps = {
    tabs: entries,
    // Chia đôi: thẻ to là thẻ đang mở thật; kiểu khác: ô đang mở có thể là khung chứa nó
    activeId: split ? activeId : entryOf(activeId),
    activeTab,
    hideId: hideId && (split ? hideId : entryOf(hideId)),
    ctx,
    W,
    H: bodyH,
    dockShift,
    token: props.token,
  };
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

  const modeFolder = folderMode ? folderById.get(folderMode) : undefined;
  const folderBar = modeFolder && (
    <>
      <Txt weight="bold" size={17} numberOfLines={1} style={{ maxWidth: landscape ? 200 : 130 }}>
        {`${modeFolder.name} · ${tabs.length}`}
      </Txt>
      <Pressable
        onPress={() => {
          void Haptics.selectionAsync();
          props.onFolderMode(null);
        }}
        accessibilityRole="button"
        accessibilityLabel="Thu nhỏ khung, về tất cả thẻ"
        hitSlop={8}
        style={({ pressed }) => [styles.minBtn, { backgroundColor: accentSoft }, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="contract-outline" size={14} color={accent} />
        <Txt weight="semibold" size={13} color={accent}>
          Thu nhỏ
        </Txt>
      </Pressable>
    </>
  );

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, fade]}
      pointerEvents={phase === 'open' ? 'auto' : 'none'}
    >
      <View
        style={[
          styles.header,
          { marginTop: insets.top + 4 },
          landscape && { paddingLeft: insets.left + 16, paddingRight: insets.right + 16 },
        ]}
      >
        <Pressable onPress={props.onCloseAll} accessibilityRole="button" hitSlop={8} style={styles.headBtn}>
          <Txt weight="medium" size={15} color={colors.danger}>
            {modeFolder ? 'Đóng khung' : 'Đóng tất cả'}
          </Txt>
        </Pressable>
        {/* Giữa: số thẻ; chế độ khung thì tên khung + nút Thu nhỏ (màn ngang: nằm cạnh nút Đóng) */}
        <View
          pointerEvents="box-none"
          style={[
            styles.count,
            landscape && (modeFolder ? { left: insets.left + 130, right: undefined } : { opacity: 0 }),
          ]}
        >
          <View style={styles.countRow}>
            {folderBar ?? (
              <Txt weight="bold" size={17}>
                {`${tabs.length} thẻ`}
              </Txt>
            )}
          </View>
        </View>
        <Pressable
          ref={plusRef}
          collapsable={false}
          onPress={() => measure(plusRef, (r) => props.onNewTab(r))}
          onLongPress={() => measure(plusRef, (r) => props.onShowClosed(r ? r.x : W - 60, r ? r.y + r.h : 100))}
          delayLongPress={350}
          accessibilityRole="button"
          accessibilityLabel={modeFolder ? 'Thẻ mới trong khung' : 'Thẻ mới'}
          accessibilityHint="Nhấn giữ để xem thẻ vừa đóng"
          hitSlop={6}
          style={({ pressed }) => [styles.plus, { backgroundColor: accent }, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="add" size={22} color={onAccent} />
        </Pressable>
      </View>

      <View style={{ flex: 1 }}>
        {/* Không chạy hiệu ứng "thêm thẻ" cho các thẻ có sẵn lúc mở màn này */}
        <LayoutAnimationConfig skipEntering>
          <View key={layout} style={{ flex: 1 }}>
            {body}
          </View>
        </LayoutAnimationConfig>
      </View>

      {/* Hàng chọn kiểu sắp xếp: ngay trên dock, trong tầm ngón cái */}
      <View
        style={
          landscape
            ? {
                position: 'absolute',
                top: insets.top + 4,
                left: insets.left + (modeFolder ? 380 : 150),
                right: insets.right + 80,
                height: 56,
                justifyContent: 'center',
                alignItems: 'center',
              }
            : { marginBottom: bottomPad }
        }
      >
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
                style={({ pressed }) => [
                  styles.chip,
                  on && { backgroundColor: accentSoft },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Ionicons name={l.icon} size={15} color={on ? accent : colors.textMuted} />
                <Txt weight={on ? 'semibold' : 'medium'} size={13} color={on ? accent : colors.textMuted}>
                  {l.label}
                </Txt>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {popupFolder && (
        <FolderPopup
          key={popupFolder.id}
          folder={popupFolder}
          ctx={ctx}
          panelRef={panelRef}
          onClose={() => setPopup({ token: props.token, id: null })}
          onRename={(n) => props.onRenameFolder(popupFolder.id, n)}
          onEnter={(tabId, r) => {
            setPopup({ token: props.token, id: null });
            props.onFolderMode(popupFolder.id);
            props.onPick(tabId, r);
          }}
        />
      )}

      {/* Bản thẻ nhấc lên, chạy theo ngón tay khi kéo */}
      {drag && (
        <Animated.View
          pointerEvents="none"
          style={[styles.lift, { width: drag.w, height: drag.h, borderRadius: drag.radius }, lift]}
        >
          <MiniThumb tab={drag.tab} width={drag.w} height={drag.h} radius={drag.radius} />
        </Animated.View>
      )}
    </Animated.View>
  );
}

const makeStyles = (colors: Palette, fg: (alpha: number) => string) =>
  StyleSheet.create({
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
    count: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chips: { flexGrow: 0, marginBottom: 6 },
    chipsRow: { paddingHorizontal: 12, gap: 6, height: 40, alignItems: 'center' },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 17 },
    wrap: { flexDirection: 'row', flexWrap: 'wrap' },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, height: TITLE_H, paddingLeft: 4 },
    cardAddr: { position: 'absolute', transformOrigin: 'left top' },
    countRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    minBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 30, paddingHorizontal: 10, borderRadius: 15 },
    badge: {
      position: 'absolute',
      right: 6,
      bottom: 6,
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: 5,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    panel: {
      padding: 16,
      borderRadius: 28,
      backgroundColor: colors.surface,
      shadowColor: '#000',
      shadowOpacity: 0.35,
      shadowRadius: 30,
      shadowOffset: { width: 0, height: 12 },
    },
    folderName: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 14, paddingVertical: 4 },
    lift: {
      position: 'absolute',
      left: 0,
      top: 0,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.4,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
    },
    fav: { width: 14, height: 14, borderRadius: 3 },
    bigFav: { width: 40, height: 40, borderRadius: 10, marginBottom: 8 },
    preview: {
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
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
  tabs.map((t) => `${t.id}|${t.title}|${t.url}|${t.home}|${t.thumb}|${t.thumbKey}|${t.folderId}`).join('\n');

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
    a.folders === b.folders &&
    a.folderMode === b.folderMode &&
    tabsKey(a.tabs) === tabsKey(b.tabs)
  );
});
