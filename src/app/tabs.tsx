import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/icon-button';
import { Txt } from '@/components/txt';
import { displayHost, faviconFor } from '@/lib/url';
import { totalBlocked, useTabs, type Tab } from '@/state/tabs';
import { colors, useTheme } from '@/theme';

export default function TabsScreen() {
  const insets = useSafeAreaInsets();
  const { accent, accentSoft, onAccent } = useTheme();
  const { tabs, activeId, setActive, closeTab, closeAll, newTab } = useTabs();

  const pick = (id: string) => {
    setActive(id);
    router.back();
  };

  const renderItem = ({ item }: { item: Tab }) => {
    const isActive = item.id === activeId;
    const showPage = !item.home && !!item.url;
    const host = showPage ? displayHost(item.url) : '';
    const blocked = totalBlocked(item).total;
    return (
      <Pressable
        onPress={() => pick(item.id)}
        accessibilityRole="button"
        accessibilityLabel={`${item.title || host || 'Thẻ mới'}${isActive ? ', đang mở' : ''}`}
        style={({ pressed }) => [
          styles.card,
          isActive && { borderColor: accent, borderWidth: 2 },
          pressed && { transform: [{ scale: 0.97 }] },
        ]}
      >
        <View style={styles.cardHead}>
          {showPage ? (
            <Image source={faviconFor(item.url!)} style={styles.favicon} />
          ) : (
            <Ionicons name="shield-checkmark" size={16} color={accent} />
          )}
          <Txt weight="medium" size={13} numberOfLines={1} style={{ flex: 1 }}>
            {showPage ? item.title || host : 'Thẻ mới'}
          </Txt>
          <IconButton
            icon="close"
            label="Đóng thẻ"
            size={32}
            iconSize={16}
            color={colors.textMuted}
            onPress={() => closeTab(item.id)}
          />
        </View>
        <View style={styles.preview}>
          <Ionicons name={showPage ? 'globe-outline' : 'add'} size={34} color={colors.textFaint} />
          <Txt size={12} color={colors.textMuted} numberOfLines={1} style={{ marginTop: 6, paddingHorizontal: 8 }}>
            {host || 'Trang chủ Khiên'}
          </Txt>
          {blocked > 0 && (
            <View style={[styles.blocked, { backgroundColor: accentSoft }]}>
              <Ionicons name="shield-checkmark" size={11} color={accent} />
              <Txt weight="semibold" size={11} color={accent} style={{ lineHeight: 14 }}>
                {blocked}
              </Txt>
            </View>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.header}>
        <Txt weight="bold" size={22} accessibilityRole="header">
          {tabs.length} thẻ
        </Txt>
        <Pressable onPress={closeAll} accessibilityRole="button" hitSlop={8} style={styles.headerBtn}>
          <Txt weight="medium" size={15} color={colors.danger}>
            Đóng tất cả
          </Txt>
        </Pressable>
      </View>

      <FlatList
        data={tabs}
        keyExtractor={(t) => t.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        renderItem={renderItem}
      />

      <View style={styles.footer}>
        <Pressable
          onPress={() => {
            newTab();
            router.back();
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.newBtn, { backgroundColor: accent }, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="add" size={22} color={onAccent} />
          <Txt weight="semibold" size={16} color={onAccent}>
            Thẻ mới
          </Txt>
        </Pressable>
        <Pressable onPress={() => router.back()} accessibilityRole="button" style={styles.doneBtn}>
          <Txt weight="semibold" size={16} color={accent}>
            Xong
          </Txt>
        </Pressable>
      </View>
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
  card: {
    flex: 1,
    maxWidth: '50%',
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 4, height: 40 },
  favicon: { width: 16, height: 16, borderRadius: 4 },
  preview: {
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  blocked: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    height: 22,
    borderRadius: 11,
  },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8 },
  newBtn: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  doneBtn: { height: 52, paddingHorizontal: 20, justifyContent: 'center' },
});
