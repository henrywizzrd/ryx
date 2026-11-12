import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { faviconFor } from '@/lib/url';
import { useStats } from '@/state/stats';
import { colors, fonts, useTheme } from '@/theme';
import { Txt } from './txt';

const SHORTCUTS = [
  { name: 'Google', url: 'https://www.google.com' },
  { name: 'YouTube', url: 'https://m.youtube.com' },
  { name: 'VnExpress', url: 'https://vnexpress.net' },
  { name: 'Tuổi Trẻ', url: 'https://tuoitre.vn' },
  { name: 'Wikipedia', url: 'https://vi.wikipedia.org' },
  { name: 'Facebook', url: 'https://m.facebook.com' },
  { name: 'Shopee', url: 'https://shopee.vn' },
  { name: 'Zing MP3', url: 'https://zingmp3.vn' },
];

interface Props {
  onSubmit: (text: string) => void;
  onOpen: (url: string) => void;
  paddingTop: number;
  paddingBottom: number;
}

const nf = new Intl.NumberFormat('vi-VN');

export function NewTabPage({ onSubmit, onOpen, paddingTop, paddingBottom }: Props) {
  const { accent, accentSoft } = useTheme();
  const { week } = useStats();
  const [query, setQuery] = useState('');

  const breakdown = [
    { label: 'Quảng cáo', value: week.ads, color: accent },
    { label: 'Cờ bạc', value: week.gambling, color: colors.gambling },
    { label: 'Pop-up', value: week.popups, color: colors.popups },
  ];

  return (
    <ScrollView
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
          keyboardAppearance="dark"
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

      <Txt weight="semibold" size={15} color={colors.textMuted} style={styles.sectionTitle}>
        Truy cập nhanh
      </Txt>
      <View style={styles.grid}>
        {SHORTCUTS.map((s) => (
          <Pressable
            key={s.url}
            onPress={() => onOpen(s.url)}
            accessibilityRole="link"
            accessibilityLabel={s.name}
            style={({ pressed }) => [styles.tile, pressed && { opacity: 0.6, transform: [{ scale: 0.96 }] }]}
          >
            <View style={styles.tileIcon}>
              <Image source={faviconFor(s.url)} style={styles.favicon} contentFit="contain" transition={150} />
            </View>
            <Txt size={12} numberOfLines={1} color={colors.text} style={{ marginTop: 6 }}>
              {s.name}
            </Txt>
          </Pressable>
        ))}
      </View>
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
});
