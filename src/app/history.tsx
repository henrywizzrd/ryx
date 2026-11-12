import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/icon-button';
import { Txt } from '@/components/txt';
import { displayHost, faviconFor } from '@/lib/url';
import { RETENTION_DAYS, useHistory, type HistoryEntry } from '@/state/history';
import { useTabs } from '@/state/tabs';
import { colors, fonts, useTheme } from '@/theme';

function dayLabel(t: number) {
  const d = new Date(t);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86400000);
  if (diff === 0) return 'Hôm nay';
  if (diff === 1) return 'Hôm qua';
  return d.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' });
}

function clock(t: number) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const { accent } = useTheme();
  const { entries, remove, clear } = useHistory();
  const { active, open } = useTabs();
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? entries.filter((e) => e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q)) : entries;
    const map = new Map<string, HistoryEntry[]>();
    for (const e of list) {
      const k = dayLabel(e.t);
      const arr = map.get(k);
      if (arr) arr.push(e);
      else map.set(k, [e]);
    }
    return [...map.entries()].map(([title, data]) => ({ title, data }));
  }, [entries, query]);

  const go = (url: string) => {
    open(active.id, url);
    router.back();
  };

  const confirmClear = () => {
    Alert.alert('Xoá toàn bộ lịch sử?', 'Không thể hoàn tác.', [
      { text: 'Huỷ', style: 'cancel' },
      { text: 'Xoá', style: 'destructive', onPress: clear },
    ]);
  };

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <Txt weight="bold" size={22} accessibilityRole="header">
          Lịch sử
        </Txt>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8} style={styles.headerBtn}>
          <Txt weight="semibold" size={16} color={accent}>
            Xong
          </Txt>
        </Pressable>
      </View>

      <View style={styles.search}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Tìm trong lịch sử"
          placeholderTextColor={colors.textFaint}
          accessibilityLabel="Tìm trong lịch sử"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={styles.input}
        />
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(e) => e.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        renderSectionHeader={({ section }) => (
          <Txt weight="semibold" size={13} color={colors.textMuted} style={styles.section}>
            {section.title}
          </Txt>
        )}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Pressable
              onPress={() => go(item.url)}
              accessibilityRole="link"
              accessibilityLabel={`${item.title || displayHost(item.url)}, lúc ${clock(item.t)}`}
              style={({ pressed }) => [styles.rowMain, pressed && { opacity: 0.6 }]}
            >
              <Image source={faviconFor(item.url)} style={styles.favicon} />
              <View style={{ flex: 1 }}>
                <Txt weight="medium" size={15} numberOfLines={1}>
                  {item.title || displayHost(item.url)}
                </Txt>
                <Txt size={12} color={colors.textMuted} numberOfLines={1}>
                  {clock(item.t)} · {displayHost(item.url)}
                </Txt>
              </View>
            </Pressable>
            <IconButton icon="close" label="Xoá khỏi lịch sử" size={40} iconSize={16} color={colors.textFaint} onPress={() => remove(item.id)} />
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="time-outline" size={40} color={accent} />
            <Txt weight="semibold" size={16} style={{ marginTop: 10 }}>
              {query ? 'Không tìm thấy' : 'Chưa có lịch sử'}
            </Txt>
            <Txt size={13} color={colors.textMuted} style={{ marginTop: 4, textAlign: 'center' }}>
              {query ? 'Thử từ khoá khác.' : `Các trang bạn xem sẽ được lưu ở đây trong ${RETENTION_DAYS} ngày.`}
            </Txt>
          </View>
        }
      />

      {entries.length > 0 && (
        <Pressable onPress={confirmClear} accessibilityRole="button" style={({ pressed }) => [styles.clear, pressed && { opacity: 0.7 }]}>
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
          <Txt weight="medium" size={14} color={colors.danger}>
            Xoá toàn bộ lịch sử
          </Txt>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  headerBtn: { minHeight: 44, justifyContent: 'center' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 14,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  input: { flex: 1, color: colors.text, fontFamily: fonts.regular, fontSize: 16, paddingVertical: 10 },
  section: { paddingTop: 18, paddingBottom: 6, paddingHorizontal: 4 },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 4 },
  favicon: { width: 20, height: 20, borderRadius: 5 },
  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  clear: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
