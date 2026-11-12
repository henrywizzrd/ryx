import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from '@/components/txt';
import { clearLogs, SESSION_ID, type LogEntry, type LogLevel } from '@/lib/logger';
import { useLogs, usePerfSnapshot } from '@/lib/use-logs';
import { colors, fonts, useTheme, withAlpha } from '@/theme';

type Filter = 'all' | 'error' | 'warn' | 'perf' | 'crash';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'error', label: 'Lỗi' },
  { id: 'crash', label: 'Crash' },
  { id: 'perf', label: 'Hiệu năng' },
  { id: 'warn', label: 'Cảnh báo' },
];

const LEVEL_STYLE: Record<LogLevel, { color: string; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  debug: { color: '#7F8A9A', label: 'DEBUG', icon: 'ellipse-outline' },
  info: { color: '#7DD3FC', label: 'INFO', icon: 'information-circle-outline' },
  warn: { color: '#FBBF24', label: 'WARN', icon: 'warning-outline' },
  error: { color: '#F87171', label: 'LỖI', icon: 'close-circle-outline' },
  perf: { color: '#C4B5FD', label: 'PERF', icon: 'speedometer-outline' },
  crash: { color: '#FB7185', label: 'CRASH', icon: 'flash-outline' },
};

function matches(e: LogEntry, f: Filter) {
  if (f === 'all') return true;
  if (f === 'error') return e.level === 'error' || e.level === 'crash';
  return e.level === f;
}

function time(t: number) {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function deviceHeader() {
  return [
    `Khiên ${Constants.expoConfig?.version ?? '?'}`,
    `${Device.modelName ?? 'iPhone'} · ${Platform.OS} ${Platform.Version}`,
    `Phiên hiện tại: ${SESSION_ID}`,
    `Xuất lúc: ${new Date().toLocaleString('vi-VN')}`,
  ].join('\n');
}

function exportText(list: LogEntry[]) {
  const lines = list.map((e) => {
    const head = `[${new Date(e.t).toISOString()}] ${LEVEL_STYLE[e.level].label} ${e.tag}: ${e.msg}`;
    return e.detail ? `${head}\n    ${e.detail.replace(/\n/g, '\n    ')}` : head;
  });
  return `${deviceHeader()}\n\n${lines.join('\n')}`;
}

export default function LogsScreen() {
  const insets = useSafeAreaInsets();
  const { accent, accentSoft } = useTheme();
  const logs = useLogs();
  const perf = usePerfSnapshot();
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<number | null>(null);

  const visible = useMemo(() => logs.filter((e) => matches(e, filter)).reverse(), [logs, filter]);
  const sessionStats = useMemo(() => {
    let errors = 0;
    let crashes = 0;
    for (const e of logs) {
      if (e.session !== SESSION_ID) continue;
      if (e.level === 'error') errors++;
      if (e.level === 'crash') crashes++;
    }
    return { errors, crashes };
  }, [logs]);

  const copy = async () => {
    await Clipboard.setStringAsync(exportText(visible.slice().reverse()));
    Alert.alert('Đã sao chép', `${visible.length} dòng nhật ký đã nằm trong bộ nhớ tạm.`);
  };

  const share = () => {
    Share.share({ message: exportText(visible.slice().reverse()) }).catch(() => {});
  };

  const confirmClear = () => {
    Alert.alert('Xoá nhật ký?', 'Toàn bộ nhật ký (kể cả của các lần mở trước) sẽ bị xoá.', [
      { text: 'Huỷ', style: 'cancel' },
      { text: 'Xoá', style: 'destructive', onPress: clearLogs },
    ]);
  };

  const renderItem = ({ item, index }: { item: LogEntry; index: number }) => {
    const s = LEVEL_STYLE[item.level];
    const open = expanded === item.id;
    const prev = visible[index - 1];
    const newSession = prev && prev.session !== item.session;
    return (
      <>
        {newSession && (
          <Txt size={11} color={colors.textFaint} style={styles.sessionSep}>
            — Lần mở trước —
          </Txt>
        )}
        <Pressable
          onPress={() => setExpanded(open ? null : item.id)}
          accessibilityRole="button"
          accessibilityHint={item.detail ? 'Chạm để xem chi tiết' : undefined}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: 'rgba(255,255,255,0.04)' }]}
        >
          <View style={styles.rowHead}>
            <Ionicons name={s.icon} size={15} color={s.color} />
            <Txt weight="semibold" size={11} color={s.color} style={styles.levelLabel}>
              {s.label}
            </Txt>
            <Txt size={11} color={colors.textFaint}>
              {time(item.t)} · {item.tag}
            </Txt>
            {item.detail ? (
              <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textFaint} style={{ marginLeft: 'auto' }} />
            ) : null}
          </View>
          <Txt size={14} numberOfLines={open ? undefined : 2} style={{ marginTop: 2 }}>
            {item.msg}
          </Txt>
          {open && item.detail ? (
            <Txt size={12} color={colors.textMuted} selectable style={styles.detail}>
              {item.detail}
            </Txt>
          ) : null}
        </Pressable>
      </>
    );
  };

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <Txt weight="bold" size={22} accessibilityRole="header">
          Nhật ký
        </Txt>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8} style={styles.headerBtn}>
          <Txt weight="semibold" size={16} color={accent}>
            Xong
          </Txt>
        </Pressable>
      </View>

      <View style={styles.stats}>
        <Stat label="JS FPS" value={String(perf.fps)} warn={perf.fps < 45} />
        <Stat label="Lần treo" value={String(perf.freezes)} warn={perf.freezes > 0} />
        <Stat label="Lỗi phiên này" value={String(sessionStats.errors)} warn={sessionStats.errors > 0} />
        <Stat label="Crash" value={String(sessionStats.crashes)} warn={sessionStats.crashes > 0} />
      </View>

      <View style={styles.filters}>
        {FILTERS.map((f) => {
          const on = filter === f.id;
          return (
            <Pressable
              key={f.id}
              onPress={() => setFilter(f.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.chip, on && { backgroundColor: accentSoft, borderColor: accent }]}
            >
              <Txt weight={on ? 'semibold' : 'regular'} size={13} color={on ? colors.text : colors.textMuted}>
                {f.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={visible}
        keyExtractor={(e) => String(e.id)}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={40} color={accent} />
            <Txt weight="semibold" size={16} style={{ marginTop: 10 }}>
              Không có gì ở đây
            </Txt>
            <Txt size={13} color={colors.textMuted} style={{ marginTop: 4, textAlign: 'center' }}>
              Lỗi, cảnh báo giật lag và dấu hiệu crash sẽ hiện ở màn này.
            </Txt>
          </View>
        }
      />

      <View style={styles.footer}>
        <FooterBtn icon="copy-outline" label="Sao chép" onPress={copy} disabled={!visible.length} />
        <FooterBtn icon="share-outline" label="Chia sẻ" onPress={share} disabled={!visible.length} />
        <FooterBtn icon="trash-outline" label="Xoá" color={colors.danger} onPress={confirmClear} disabled={!logs.length} />
      </View>
    </View>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={[styles.stat, warn && { backgroundColor: withAlpha('#F87171', 0.12) }]}>
      <Txt weight="bold" size={18} color={warn ? '#FCA5A5' : colors.text} style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </Txt>
      <Txt size={11} color={colors.textMuted} numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

function FooterBtn({
  icon,
  label,
  onPress,
  color = colors.text,
  disabled,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.footerBtn, pressed && { opacity: 0.7 }, disabled && { opacity: 0.35 }]}
    >
      <Ionicons name={icon} size={20} color={color} />
      <Txt weight="medium" size={13} color={color}>
        {label}
      </Txt>
    </Pressable>
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
  stats: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 12 },
  stat: { flex: 1, borderRadius: 14, backgroundColor: colors.surface, paddingVertical: 10, paddingHorizontal: 10 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  chip: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  row: { paddingVertical: 10, paddingHorizontal: 4, borderRadius: 10 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  levelLabel: { lineHeight: 14 },
  detail: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.surface,
    fontFamily: Platform.select({ ios: 'Menlo', default: fonts.regular }),
  },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  sessionSep: { textAlign: 'center', paddingVertical: 10 },
  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  footerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12 },
});
