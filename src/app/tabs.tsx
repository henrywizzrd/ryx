import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, type IconName } from '@/components/icon-button';
import { SwipeToClose } from '@/components/swipe-to-close';
import { TabCard } from '@/components/tab-card';
import { Txt } from '@/components/txt';
import { useSettings, type TabLayout } from '@/state/settings';
import { useTabs, type Tab } from '@/state/tabs';
import { colors, useTheme } from '@/theme';

const LAYOUTS: { id: TabLayout; icon: IconName; label: string }[] = [
  { id: 'grid', icon: 'grid-outline', label: 'Lưới' },
  { id: 'list', icon: 'list-outline', label: 'Danh sách' },
  { id: 'stack', icon: 'layers-outline', label: 'Xếp chồng' },
  { id: 'carousel', icon: 'albums-outline', label: 'Trượt ngang' },
];

const STACK_CARD = 260;
const STACK_VISIBLE = 92; // phần mỗi thẻ lộ ra khi xếp chồng

export default function TabsScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { accent, accentSoft, onAccent } = useTheme();
  const { settings, update } = useSettings();
  const { tabs, activeId, setActive, closeTab, closeAll, newTab } = useTabs();
  const layout = settings.tabLayout ?? 'grid';
  const stackRef = useRef<ScrollViewInstance>(null);
  const activeIndex = Math.max(0, tabs.findIndex((t) => t.id === activeId));
  const [page, setPage] = useState(activeIndex);

  const open = (id: string) => {
    setActive(id);
    router.back();
  };

  const cardProps = (t: Tab) => ({
    tab: t,
    active: t.id === activeId,
    onOpen: () => open(t.id),
    onClose: () => closeTab(t.id),
    onDuplicate: () => newTab(t.url),
  });

  // Kiểu trượt ngang: thẻ lớn ở giữa màn hình
  const cardW = Math.round(width * 0.78);
  const gap = 14;
  const sidePad = (width - cardW) / 2;
  const carouselH = Math.min(Math.round(height * 0.56), 520);

  let body: React.ReactNode;
  if (layout === 'list') {
    body = (
      <FlatList
        data={tabs}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        renderItem={({ item }) => (
          <SwipeToClose direction="horizontal" onClose={() => closeTab(item.id)}>
            <TabCard variant="list" {...cardProps(item)} />
          </SwipeToClose>
        )}
      />
    );
  } else if (layout === 'stack') {
    body = (
      <ScrollView
        ref={stackRef}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        onContentSizeChange={() => stackRef.current?.scrollToEnd({ animated: false })}
      >
        {tabs.map((t, i) => (
          <SwipeToClose
            key={t.id}
            direction="horizontal"
            onClose={() => closeTab(t.id)}
            style={{
              marginTop: i === 0 ? 0 : -(STACK_CARD - STACK_VISIBLE),
              zIndex: i,
              transform: [{ perspective: 1200 }, { rotateX: '-10deg' }],
            }}
          >
            <TabCard variant="stack" height={STACK_CARD} {...cardProps(t)} />
          </SwipeToClose>
        ))}
      </ScrollView>
    );
  } else if (layout === 'carousel') {
    body = (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <FlatList
          data={tabs}
          horizontal
          keyExtractor={(t) => t.id}
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardW + gap}
          decelerationRate="fast"
          initialScrollIndex={activeIndex}
          getItemLayout={(_, index) => ({ length: cardW + gap, offset: (cardW + gap) * index, index })}
          contentContainerStyle={{ paddingHorizontal: sidePad - gap / 2, alignItems: 'center' }}
          onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / (cardW + gap)))}
          renderItem={({ item }) => (
            <SwipeToClose direction="up" onClose={() => closeTab(item.id)} style={{ width: cardW, marginHorizontal: gap / 2 }}>
              <TabCard variant="carousel" height={carouselH} {...cardProps(item)} />
            </SwipeToClose>
          )}
        />
        <Txt size={13} color={colors.textMuted} style={{ textAlign: 'center', marginTop: 14 }}>
          {Math.min(page, tabs.length - 1) + 1} / {tabs.length} · vuốt lên để đóng
        </Txt>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={tabs}
        keyExtractor={(t) => t.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        renderItem={({ item }) => (
          <SwipeToClose direction="horizontal" onClose={() => closeTab(item.id)} style={styles.gridCell}>
            <TabCard variant="grid" {...cardProps(item)} />
          </SwipeToClose>
        )}
      />
    );
  }

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

      <View style={styles.switcher} accessibilityRole="tablist">
        {LAYOUTS.map((l) => {
          const on = l.id === layout;
          return (
            <IconButton
              key={l.id}
              icon={l.icon}
              label={`Kiểu ${l.label}`}
              size={40}
              iconSize={19}
              color={on ? accent : colors.textMuted}
              style={[styles.switchBtn, on && { backgroundColor: accentSoft }]}
              onPress={() => update({ tabLayout: l.id })}
            />
          );
        })}
      </View>

      <View style={{ flex: 1 }}>{body}</View>

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
  switcher: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    gap: 4,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 4,
    borderRadius: 24,
    backgroundColor: colors.surface,
  },
  switchBtn: { borderRadius: 20 },
  gridCell: { flex: 1, maxWidth: '50%' },
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
