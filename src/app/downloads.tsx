import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { ActionSheetIOS, Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { IconName } from '@/components/icon-button';
import { Txt } from '@/components/txt';
import { saveMediaToPhotos, SaveMediaError } from '@/lib/save-media';
import { displayHost } from '@/lib/url';
import { useDownloads, type DownloadItem } from '@/state/downloads';
import { colors, useTheme, fg } from '@/theme';

const VIDEO = /\.(mp4|m4v|mov)$/i;
const IMAGE = /\.(jpe?g|png|gif|webp|heic)$/i;

function iconFor(name: string): IconName {
  if (VIDEO.test(name) || /\.(webm|mkv)$/i.test(name)) return 'film-outline';
  if (IMAGE.test(name)) return 'image-outline';
  if (/\.(mp3|m4a|aac|wav|flac)$/i.test(name)) return 'musical-note-outline';
  if (/\.(zip|rar|7z|ipa|apk)$/i.test(name)) return 'archive-outline';
  if (/\.pdf$/i.test(name)) return 'document-text-outline';
  return 'document-outline';
}

function mb(n: number) {
  if (n < 1048576) return `${Math.max(0, Math.round(n / 1024))} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export default function DownloadsScreen() {
  const insets = useSafeAreaInsets();
  const { accent } = useTheme();
  const { items, cancel, remove, retry, clearFinished } = useDownloads();

  const share = (d: DownloadItem) =>
    Sharing.shareAsync(d.uri).catch((e: unknown) => Alert.alert('Không mở được', String(e)));

  const menu = (d: DownloadItem) => {
    const actions: { label: string; run: () => void }[] = [];
    if (d.status === 'downloading') actions.push({ label: 'Huỷ tải', run: () => cancel(d.id) });
    if (d.status === 'done') {
      actions.push({ label: 'Mở / Chia sẻ…', run: () => void share(d) });
      if (VIDEO.test(d.name) || IMAGE.test(d.name)) {
        actions.push({
          label: 'Lưu vào Ảnh',
          run: () =>
            void saveMediaToPhotos(d.uri, VIDEO.test(d.name) ? 'video' : 'image', null)
              .then(() => Alert.alert('Đã lưu vào Ảnh'))
              .catch((e: unknown) =>
                Alert.alert('Không lưu được', e instanceof SaveMediaError ? e.message : String(e)),
              ),
        });
      }
    }
    if (d.status === 'error' || d.status === 'canceled') actions.push({ label: 'Tải lại', run: () => retry(d.id) });
    actions.push({ label: 'Xoá', run: () => remove(d.id) });
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: d.name,
        message: displayHost(d.url),
        options: [...actions.map((a) => a.label), 'Huỷ'],
        destructiveButtonIndex: actions.length - 1,
        cancelButtonIndex: actions.length,
      },
      (i) => actions[i]?.run(),
    );
  };

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <Txt weight="bold" size={22} accessibilityRole="header">
          Tải về
        </Txt>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8} style={styles.headerBtn}>
          <Txt weight="semibold" size={16} color={accent}>
            Xong
          </Txt>
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="download-outline" size={40} color={colors.textFaint} />
            <Txt size={15} color={colors.textMuted} style={{ textAlign: 'center' }}>
              Chưa có gì. Nhấn giữ ảnh/video trong trang rồi chọn “Tải về”, hoặc mở link file (zip, pdf, ipa…).
            </Txt>
          </View>
        }
        renderItem={({ item: d }) => {
          const pct = d.total > 0 ? d.received / d.total : 0;
          const sub =
            d.status === 'downloading'
              ? d.total > 0
                ? `${mb(d.received)} / ${mb(d.total)} · ${Math.round(pct * 100)}%`
                : `${mb(d.received)} · đang tải…`
              : d.status === 'done'
                ? `${mb(d.total)} · ${displayHost(d.url)}`
                : d.status === 'canceled'
                  ? 'Đã huỷ · chạm để tải lại'
                  : `Lỗi: ${d.error ?? 'không rõ'}`;
          return (
            <Pressable
              onPress={() => (d.status === 'done' ? void share(d) : menu(d))}
              onLongPress={() => menu(d)}
              accessibilityRole="button"
              accessibilityLabel={`${d.name}, ${sub}`}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={styles.icon}>
                <Ionicons name={iconFor(d.name)} size={22} color={d.status === 'error' ? colors.danger : accent} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Txt weight="medium" size={15} numberOfLines={1}>
                  {d.name}
                </Txt>
                <Txt size={12} color={d.status === 'error' ? colors.danger : colors.textMuted} numberOfLines={1}>
                  {sub}
                </Txt>
                {d.status === 'downloading' && (
                  <View style={styles.track}>
                    <View style={[styles.bar, { width: `${Math.max(3, pct * 100)}%`, backgroundColor: accent }]} />
                  </View>
                )}
              </View>
              <Pressable onPress={() => menu(d)} accessibilityRole="button" accessibilityLabel="Tuỳ chọn" hitSlop={8}>
                <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
              </Pressable>
            </Pressable>
          );
        }}
        ListFooterComponent={
          items.length > 0 ? (
            <View style={{ gap: 12, marginTop: 8 }}>
              <Txt size={12} color={colors.textFaint} style={{ textAlign: 'center' }}>
                File nằm trong app Tệp → Trên iPhone → Ryx → Downloads
              </Txt>
              {items.some((d) => d.status === 'error' || d.status === 'canceled') && (
                <Pressable onPress={clearFinished} accessibilityRole="button" style={styles.clear}>
                  <Txt weight="medium" size={14} color={accent}>
                    Xoá các mục lỗi / đã huỷ
                  </Txt>
                </Pressable>
              )}
            </View>
          ) : undefined
        }
      />
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: fg(0.06),
  },
  track: { height: 4, borderRadius: 2, backgroundColor: fg(0.1), overflow: 'hidden' },
  bar: { height: 4, borderRadius: 2 },
  clear: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
});
