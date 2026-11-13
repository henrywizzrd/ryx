import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { ActionSheetIOS, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { applyEdgeEffects } from '@/lib/edge';
import { displayHost, faviconFor } from '@/lib/url';
import { useBookmarks, type Bookmark } from '@/state/bookmarks';
import { useReading } from '@/state/reading';
import { useStats } from '@/state/stats';
import { colors, fonts, useTheme } from '@/theme';
import { Txt } from './txt';

interface Props {
  onSubmit: (text: string) => void;
  onOpen: (url: string) => void;
  onOpenNewTab: (url: string) => void;
  paddingTop: number;
  paddingBottom: number;
}

const nf = new Intl.NumberFormat('vi-VN');

export function NewTabPage({ onSubmit, onOpen, onOpenNewTab, paddingTop, paddingBottom }: Props) {
  useEffect(() => {
    applyEdgeEffects();
  }, []);
  const { accent, accentSoft } = useTheme();
  const { week } = useStats();
  const [query, setQuery] = useState('');
  const { bookmarks, remove, moveToFront, rename } = useBookmarks();
  const { reading, forget } = useReading();

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
    <ScrollView
      // Đánh dấu cho hiệu ứng mờ mép trên (iOS 26+)
      testID="ryx-edge"
      style={StyleSheet.absoluteFill}
      contentContainerStyle={[styles.container, { paddingTop: paddingTop + 28, paddingBottom: paddingBottom + 24 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <View style={styles.brand}>
        <View style={[styles.logo, { backgroundColor: accentSoft }]}>
          <Ionicons name="shield-checkmark" size={30} color={accent} />
        </View>
        <Txt weight="bold" size={34} style={{ lineHeight: 42 }} accessibilityRole="header">
          Ryx
        </Txt>
        <Txt size={15} color={colors.textMuted}>
          Duyệt web sạch quảng cáo, an toàn hơn
        </Txt>
      </View>

      <View style={styles.search}>
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
          style={styles.searchInput}
        />
      </View>

      <View style={styles.card} accessible accessibilityLabel={`Đã chặn tuần này: ${week.total} mục`}>
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
      </View>

      {reading.length > 0 && (
        <>
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
              <Pressable
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
                style={({ pressed }) => [styles.readCard, pressed && { opacity: 0.7 }]}
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
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}

      <Txt weight="semibold" size={15} color={colors.textMuted} style={styles.sectionTitle}>
        Truy cập nhanh
      </Txt>
      <View style={styles.grid}>
        {bookmarks.map((b) => (
          <Pressable
            key={b.id}
            onPress={() => onOpen(b.url)}
            onLongPress={() => bookmarkMenu(b)}
            accessibilityRole="link"
            accessibilityLabel={b.title}
            accessibilityHint="Nhấn giữ để sửa hoặc xoá"
            style={({ pressed }) => [styles.tile, pressed && { opacity: 0.6, transform: [{ scale: 0.96 }] }]}
          >
            <View style={styles.tileIcon}>
              <Image source={faviconFor(b.url)} style={styles.favicon} contentFit="contain" transition={150} />
            </View>
            <Txt size={12} numberOfLines={1} color={colors.text} style={{ marginTop: 6, maxWidth: '90%' }}>
              {b.title}
            </Txt>
          </Pressable>
        ))}
      </View>
      {bookmarks.length === 0 && (
        <Txt size={13} color={colors.textMuted} style={{ marginLeft: 4 }}>
          Mở một trang rồi chọn Menu → Thêm dấu trang để ghim vào đây.
        </Txt>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20 },
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
