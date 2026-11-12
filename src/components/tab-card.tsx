import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { ActionSheetIOS, Pressable, StyleSheet, View } from 'react-native';

import { log } from '@/lib/logger';
import { displayHost, faviconFor } from '@/lib/url';
import { totalBlocked, type Tab } from '@/state/tabs';
import { colors, useTheme } from '@/theme';
import { IconButton } from './icon-button';
import { Txt } from './txt';

export type TabCardVariant = 'grid' | 'list' | 'stack' | 'carousel';

interface Props {
  tab: Tab;
  active: boolean;
  variant: TabCardVariant;
  onOpen: () => void;
  onClose: () => void;
  onDuplicate: () => void;
  height?: number;
}

/** Màu nền riêng cho từng tên miền (ổn định, tối, đủ tương phản với chữ trắng). */
function tintFor(host: string): string {
  let h = 0;
  for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) % 360;
  return `hsl(${h}, 32%, 20%)`;
}

export function tabInfo(tab: Tab) {
  const showPage = !tab.home && !!tab.url;
  const host = showPage ? displayHost(tab.url) : '';
  return {
    showPage,
    host,
    title: showPage ? tab.title || host : 'Thẻ mới',
    blocked: totalBlocked(tab).total,
    tint: showPage ? tintFor(host) : colors.surfaceRaised,
  };
}

/** Menu khi nhấn giữ một thẻ: Nhân đôi / Sao chép link / Đóng. */
export function showTabMenu(tab: Tab, onDuplicate: () => void, onClose: () => void) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  const { showPage, title } = tabInfo(tab);
  const options = showPage ? ['Huỷ', 'Nhân đôi thẻ', 'Sao chép link', 'Đóng thẻ'] : ['Huỷ', 'Đóng thẻ'];
  ActionSheetIOS.showActionSheetWithOptions(
    { title, options, cancelButtonIndex: 0, destructiveButtonIndex: options.length - 1 },
    (i) => {
      const picked = options[i];
      if (picked === 'Nhân đôi thẻ') onDuplicate();
      else if (picked === 'Sao chép link' && tab.url) {
        Clipboard.setStringAsync(tab.url).catch((e) => log.error('tabs', 'Không sao chép được link', e));
      } else if (picked === 'Đóng thẻ') onClose();
    },
  );
}

export function TabCard({ tab, active, variant, onOpen, onClose, onDuplicate, height }: Props) {
  const { accent, accentSoft } = useTheme();
  const { showPage, host, title, blocked, tint } = tabInfo(tab);
  const label = `${title}${active ? ', đang mở' : ''}`;
  const onLongPress = () => showTabMenu(tab, onDuplicate, onClose);

  const favicon = showPage ? (
    <Image source={faviconFor(tab.url!)} style={styles.favicon} />
  ) : (
    <Ionicons name="shield-checkmark" size={16} color={accent} />
  );

  const badge =
    blocked > 0 ? (
      <View style={[styles.badge, { backgroundColor: accentSoft }]}>
        <Ionicons name="shield-checkmark" size={11} color={accent} />
        <Txt weight="semibold" size={11} color={accent} style={{ lineHeight: 14 }}>
          {blocked}
        </Txt>
      </View>
    ) : null;

  if (variant === 'list') {
    return (
      <Pressable
        onPress={onOpen}
        onLongPress={onLongPress}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Nhấn giữ để xem thêm, vuốt ngang để đóng"
        style={({ pressed }) => [
          styles.row,
          active && { borderColor: accent, backgroundColor: accentSoft },
          pressed && { opacity: 0.75 },
        ]}
      >
        <View style={[styles.rowIcon, { backgroundColor: tint }]}>{favicon}</View>
        <View style={{ flex: 1 }}>
          <Txt weight="medium" size={15} numberOfLines={1}>
            {title}
          </Txt>
          <Txt size={12} color={colors.textMuted} numberOfLines={1}>
            {host || 'Trang chủ Ryx'}
          </Txt>
        </View>
        {badge}
        <IconButton icon="close" label="Đóng thẻ" size={40} iconSize={16} color={colors.textMuted} onPress={onClose} />
      </Pressable>
    );
  }

  const big = variant === 'carousel';
  return (
    <Pressable
      onPress={onOpen}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={big ? 'Nhấn giữ để xem thêm, vuốt lên để đóng' : 'Nhấn giữ để xem thêm, vuốt ngang để đóng'}
      style={({ pressed }) => [
        styles.card,
        { height: height ?? 230, borderRadius: big ? 28 : 22 },
        active && { borderColor: accent, borderWidth: 2 },
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
    >
      <View style={styles.cardHead}>
        {favicon}
        <Txt weight="medium" size={big ? 15 : 13} numberOfLines={1} style={{ flex: 1 }}>
          {title}
        </Txt>
        <IconButton icon="close" label="Đóng thẻ" size={36} iconSize={16} color={colors.textMuted} onPress={onClose} />
      </View>
      <View style={[styles.preview, { backgroundColor: tint }]}>
        {showPage ? (
          <Image source={faviconFor(tab.url!)} style={big ? styles.bigIcon : styles.midIcon} />
        ) : (
          <Ionicons name="add" size={big ? 48 : 34} color={colors.textFaint} />
        )}
        <Txt weight={big ? 'semibold' : 'regular'} size={big ? 16 : 12} color={colors.textMuted} numberOfLines={1} style={styles.host}>
          {host || 'Trang chủ Ryx'}
        </Txt>
        {badge ? <View style={styles.badgeWrap}>{badge}</View> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  favicon: { width: 16, height: 16, borderRadius: 4 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 4, height: 44 },
  preview: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  midIcon: { width: 36, height: 36, borderRadius: 9 },
  bigIcon: { width: 64, height: 64, borderRadius: 16 },
  host: { paddingHorizontal: 12 },
  badgeWrap: { position: 'absolute', bottom: 10, right: 10 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 22, borderRadius: 11 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingLeft: 10,
    paddingRight: 2,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
  },
  rowIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
