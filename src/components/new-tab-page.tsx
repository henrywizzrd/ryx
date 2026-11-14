import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { ActionSheetIOS, Alert, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  LayoutAnimationConfig,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { applyEdgeEffects } from '@/lib/edge';
import { MOTION } from '@/lib/motion';
import { displayHost, faviconFor } from '@/lib/url';
import { useBookmarks, type Bookmark } from '@/state/bookmarks';
import { useReading } from '@/state/reading';
import { useSettings } from '@/state/settings';
import { useStats } from '@/state/stats';
import { colors, fonts, useTheme } from '@/theme';
import { PressScale } from './press-scale';
import { Txt } from './txt';

interface Props {
  onSubmit: (text: string) => void;
  onOpen: (url: string) => void;
  onOpenNewTab: (url: string) => void;
  paddingTop: number;
  paddingBottom: number;
  /** Bản xem trước (Tuỳ chỉnh → Trang chủ, màn các thẻ): không chạy hiệu ứng hiện lần lượt */
  preview?: boolean;
}

const nf = new Intl.NumberFormat('vi-VN');
const PAD = 20;
/** Bật/tắt một phần trong Tuỳ chỉnh: mờ ra/vào, các phần còn lại dồn chỗ mượt */
const OUT = FadeOut.duration(160);
/** Một phần nhỏ trong cụm logo/chữ hiện lại khi bật */
const SHOW = FadeIn.duration(200);
const MOVE = LinearTransition.springify().damping(26).stiffness(260);

export function NewTabPage({ onSubmit, onOpen, onOpenNewTab, paddingTop, paddingBottom, preview }: Props) {
  useEffect(() => {
    applyEdgeEffects();
  }, []);
  const { accent, accentSoft } = useTheme();
  const { week } = useStats();
  const [query, setQuery] = useState('');
  const { bookmarks, remove, moveToFront, rename } = useBookmarks();
  const { reading, forget } = useReading();
  const { settings } = useSettings();
  const home = settings.home;
  const reduce = useReducedMotion();
  // Mở trang chủ: các phần hiện dần từ dưới lên, lần lượt cách nhau 40 ms. Bản xem trước thì chỉ mờ vào khi bật lại.
  const enter = (i: number) =>
    preview || reduce
      ? FadeIn.duration(200)
      : FadeInDown.duration(380)
          .delay(i * 40)
          .springify()
          .damping(24);

  // Ô tìm kiếm: bình thường 4/5 bề ngang, bấm vào thì dãn ra hết, bỏ ra thì thu lại
  const { width: W } = useWindowDimensions();
  const full = W - PAD * 2;
  const focus = useSharedValue(0);
  const searchAnim = useAnimatedStyle(() => ({ width: full * (0.8 + 0.2 * focus.get()) }));
  const setFocus = (on: boolean) => focus.set(reduce ? (on ? 1 : 0) : withSpring(on ? 1 : 0, MOTION.snappy));

  // Nhấn giữ một ô truy cập nhanh
  const bookmarkMenu = (b: Bookmark) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const actions: { label: string; run: () => void }[] = [
      { label: 'Mở trong thẻ mới', run: () => onOpenNewTab(b.url) },
      { label: 'Đưa lên đầu', run: () => moveToFront(b.id) },
      {
        label: 'Đổi tên',
        run: () => Alert.prompt('Đổi tên', undefined, (t) => rename(b.id, t), 'plain-text', b.title),
      },
      { label: 'Xoá khỏi truy cập nhanh', run: () => remove(b.url) },
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: b.title,
        message: displayHost(b.url),
        options: [...actions.map((a) => a.label), 'Huỷ'],
        destructiveButtonIndex: actions.length - 1,
        cancelButtonIndex: actions.length,
      },
      (i) => actions[i]?.run(),
    );
  };

  const breakdown = [
    { label: 'Quảng cáo', value: week.ads, color: accent },
    { label: 'Cờ bạc', value: week.gambling, color: colors.gambling },
    { label: 'Pop-up', value: week.popups, color: colors.popups },
  ];

  return (
    // Bản xem trước: không chạy hiệu ứng lúc mới hiện, chỉ khi bật/tắt từng phần
    <LayoutAnimationConfig skipEntering={!!preview}>
      <ScrollView
        // Đánh dấu cho hiệu ứng mờ mép trên (iOS 26+)
        testID="ryx-edge"
        style={StyleSheet.absoluteFill}
        contentContainerStyle={[styles.container, { paddingTop: paddingTop + 28, paddingBottom: paddingBottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {(home.logo || home.title || home.subtitle) && (
          <Animated.View entering={enter(0)} exiting={OUT} layout={MOVE} style={styles.brand}>
            {home.logo && (
              <Animated.View
                entering={SHOW}
                exiting={OUT}
                layout={MOVE}
                style={[styles.logo, { backgroundColor: accentSoft }]}
              >
                <Ionicons name="shield-checkmark" size={30} color={accent} />
              </Animated.View>
            )}
            {home.title && (
              <Animated.View entering={SHOW} exiting={OUT} layout={MOVE}>
                <Txt weight="bold" size={34} style={{ lineHeight: 42 }} accessibilityRole="header">
                  Ryx
                </Txt>
              </Animated.View>
            )}
            {home.subtitle && (
              <Animated.View entering={SHOW} exiting={OUT} layout={MOVE}>
                <Txt size={15} color={colors.textMuted}>
                  Duyệt web sạch quảng cáo, an toàn hơn
                </Txt>
              </Animated.View>
            )}
          </Animated.View>
        )}

        <Animated.View entering={enter(1)} layout={MOVE} style={[styles.search, searchAnim]}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => {
              if (query.trim()) onSubmit(query);
              setQuery('');
            }}
            placeholder="Tìm trên Google hoặc nhập địa chỉ"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="web-search"
            returnKeyType="search"
            keyboardAppearance={colors.scheme}
            selectionColor={accent}
            accessibilityLabel="Tìm kiếm"
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            editable={!preview}
            style={styles.searchInput}
          />
        </Animated.View>

        {home.stats && (
          <Animated.View
            entering={enter(2)}
            exiting={OUT}
            layout={MOVE}
            style={styles.card}
            accessible
            accessibilityLabel={`Đã chặn tuần này: ${week.total} mục`}
          >
            <View style={styles.cardHead}>
              <Txt weight="semibold" size={15} color={colors.textMuted}>
                Đã chặn tuần này
              </Txt>
              <Ionicons name="shield-half" size={18} color={accent} />
            </View>
            <Txt weight="bold" size={44} color={accent} style={{ lineHeight: 54, fontVariant: ['tabular-nums'] }}>
              {nf.format(week.total)}
            </Txt>
            <View style={styles.breakdown}>
              {breakdown.map((b) => (
                <View key={b.label} style={styles.breakItem}>
                  <View style={styles.breakLabel}>
                    <View style={[styles.dot, { backgroundColor: b.color }]} />
                    <Txt size={13} color={colors.textMuted}>
                      {b.label}
                    </Txt>
                  </View>
                  <Txt weight="semibold" size={18} style={{ fontVariant: ['tabular-nums'] }}>
                    {nf.format(b.value)}
                  </Txt>
                </View>
              ))}
            </View>
          </Animated.View>
        )}

        {home.reading && reading.length > 0 && (
          <Animated.View entering={enter(3)} exiting={OUT} layout={MOVE}>
            <Txt weight="semibold" size={15} color={colors.textMuted} style={styles.sectionTitle}>
              Đọc tiếp
            </Txt>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.readRow}
              style={styles.readScroll}
            >
              {reading.slice(0, 12).map((r) => (
                <PressScale
                  key={r.series}
                  onPress={() => onOpen(r.url)}
                  onLongPress={() =>
                    ActionSheetIOS.showActionSheetWithOptions(
                      {
                        title: r.title,
                        options: ['Bỏ khỏi Đọc tiếp', 'Huỷ'],
                        destructiveButtonIndex: 0,
                        cancelButtonIndex: 1,
                      },
                      (i) => i === 0 && forget(r.series),
                    )
                  }
                  accessibilityRole="link"
                  accessibilityLabel={`Đọc tiếp ${r.title}, ${r.chapter}`}
                  style={styles.readCard}
                >
                  <View style={styles.readHead}>
                    <Image source={faviconFor(r.url)} style={styles.readIcon} contentFit="contain" />
                    <Txt size={11} color={colors.textMuted} numberOfLines={1} style={{ flex: 1 }}>
                      {displayHost(r.url)}
                    </Txt>
                  </View>
                  <Txt weight="semibold" size={14} numberOfLines={2}>
                    {r.title}
                  </Txt>
                  <Txt weight="medium" size={13} color={accent} numberOfLines={1}>
                    {r.chapter}
                  </Txt>
                </PressScale>
              ))}
            </ScrollView>
          </Animated.View>
        )}

        {home.quick && (
          <Animated.View entering={enter(4)} exiting={OUT} layout={MOVE}>
            <Txt weight="semibold" size={15} color={colors.textMuted} style={styles.sectionTitle}>
              Truy cập nhanh
            </Txt>
            <View style={styles.grid}>
              {bookmarks.map((b) => (
                <PressScale
                  scaleTo={0.94}
                  key={b.id}
                  onPress={() => onOpen(b.url)}
                  onLongPress={() => bookmarkMenu(b)}
                  accessibilityRole="link"
                  accessibilityLabel={b.title}
                  accessibilityHint="Nhấn giữ để sửa hoặc xoá"
                  style={styles.tile}
                >
                  <View style={styles.tileIcon}>
                    <Image source={faviconFor(b.url)} style={styles.favicon} contentFit="contain" transition={150} />
                  </View>
                  <Txt size={12} numberOfLines={1} color={colors.text} style={{ marginTop: 6, maxWidth: '90%' }}>
                    {b.title}
                  </Txt>
                </PressScale>
              ))}
            </View>
            {bookmarks.length === 0 && (
              <Txt size={13} color={colors.textMuted} style={{ marginLeft: 4 }}>
                Mở một trang rồi chọn Menu → Thêm dấu trang để ghim vào đây.
              </Txt>
            )}
          </Animated.View>
        )}
      </ScrollView>
    </LayoutAnimationConfig>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: PAD },
  brand: { alignItems: 'center', gap: 6, marginBottom: 24 },
  logo: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 52,
    borderRadius: 26,
    paddingHorizontal: 18,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: 16,
    // Bề ngang do searchAnim đặt (4/5, dãn ra khi bấm vào), nằm giữa
    alignSelf: 'center',
  },
  searchInput: { flex: 1, height: 52, color: colors.text, fontFamily: fonts.regular, fontSize: 16 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: 28,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  breakdown: {
    flexDirection: 'row',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  breakItem: { flex: 1, gap: 2 },
  breakLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { marginBottom: 12, marginLeft: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 18 },
  tile: { width: '25%', alignItems: 'center' },
  tileIcon: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  favicon: { width: 30, height: 30 },
  readScroll: { marginHorizontal: -20, marginBottom: 24 },
  readRow: { paddingHorizontal: 20, gap: 10 },
  readCard: {
    width: 170,
    padding: 12,
    gap: 4,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  readHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  readIcon: { width: 14, height: 14 },
});
