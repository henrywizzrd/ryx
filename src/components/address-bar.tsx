import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  SlideInDown,
  SlideOutUp,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { MOTION } from '@/lib/motion';
import { displayHost, isSecure } from '@/lib/url';
import { sameUrl, useBookmarks } from '@/state/bookmarks';
import { useHistory } from '@/state/history';
import type { Tab } from '@/state/tabs';
import { fonts, useTheme, useStyles, type Palette } from '@/theme';
import { Glass } from './glass';
import { IconButton } from './icon-button';
import { Txt } from './txt';

export const ADDRESS_BAR_HEIGHT = 48;
/** Bề ngang thanh địa chỉ khi không gõ, so với cả hàng */
export const BAR_W = 0.6;
/** Khoảng cách thanh địa chỉ tới đáy trang khi trang thu nhỏ thành thẻ (dock ẩn, thanh nằm sát đáy thẻ) */
export const CARD_ADDR_BOTTOM = 28;
/** Bề ngang thanh địa chỉ (khi không gõ) theo bề ngang màn hình */
export const addrBarWidth = (screenW: number) => (screenW - 32) * BAR_W;

interface Props {
  tab: Tab;
  blocked: number;
  shieldOn: boolean;
  onSubmit: (text: string) => void;
  onShieldPress: () => void;
  onReload: () => void;
  onStop: () => void;
  onFocusChange: (focused: boolean) => void;
  /** Thanh nằm dưới thì gợi ý hiện phía trên, và ngược lại */
  position: 'top' | 'bottom';
}

interface Suggestion {
  url: string;
  title: string;
  kind: 'bookmark' | 'history';
}

const MAX_SUGGESTIONS = 6;

/** Thanh tiến trình: chạy theo % tải, có vệt sáng lướt qua; tải xong thì chạy hết rồi mờ đi. */
function ProgressLine({ loading, progress, color }: { loading: boolean; progress: number; color: string }) {
  const styles = useStyles(makeStyles);

  const w = useSharedValue(0);
  const op = useSharedValue(0);
  const shine = useSharedValue(0);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (loading) {
      op.value = withTiming(1, { duration: 120 });
      w.value = withTiming(Math.max(0.05, progress), { duration: 260 });
    } else {
      w.value = withTiming(1, { duration: 180 });
      op.value = withDelay(
        200,
        withTiming(0, { duration: 320 }, (f) => {
          if (f) w.value = 0;
        }),
      );
    }
  }, [loading, progress, w, op]);
  useEffect(() => {
    if (reduceMotion) return;
    shine.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, false);
  }, [reduceMotion, shine]);
  const bar = useAnimatedStyle(() => ({ width: `${w.value * 100}%`, opacity: op.value }));
  const glint = useAnimatedStyle(() => ({ left: `${shine.value * 130 - 30}%` }));
  return (
    <View style={styles.progressTrack} pointerEvents="none">
      <Animated.View style={[styles.progress, { backgroundColor: color }, bar]}>
        {!reduceMotion && <Animated.View style={[styles.glint, glint]} />}
      </Animated.View>
    </View>
  );
}

/** Số đếm lăn như đồng hồ: số cũ trượt lên, số mới trượt từ dưới vào. */
function RollingCount({ value, color }: { value: number; color: string }) {
  const styles = useStyles(makeStyles);

  const text = value > 999 ? '999+' : String(value);
  return (
    <View style={styles.rollBox}>
      {/* Bản ẩn để giữ đúng bề ngang */}
      <Txt weight="bold" size={13} style={[styles.shieldCount, { opacity: 0 }]}>
        {text}
      </Txt>
      <Animated.View
        key={text}
        entering={SlideInDown.duration(220)}
        exiting={SlideOutUp.duration(220)}
        style={styles.rollAbs}
      >
        <Txt weight="bold" size={13} color={color} style={styles.shieldCount}>
          {text}
        </Txt>
      </Animated.View>
    </View>
  );
}

/** Gợi ý khi gõ: dấu trang trước, rồi lịch sử (mới nhất trước), không trùng link. */
function useSuggestions(query: string, enabled: boolean): Suggestion[] {
  const { bookmarks } = useBookmarks();
  const { entries } = useHistory();
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!enabled || q.length < 1) return [];
    const out: Suggestion[] = [];
    const hit = (url: string, title: string) => url.toLowerCase().includes(q) || title.toLowerCase().includes(q);
    for (const b of bookmarks) {
      if (out.length >= MAX_SUGGESTIONS) break;
      if (hit(b.url, b.title)) out.push({ url: b.url, title: b.title, kind: 'bookmark' });
    }
    for (const h of entries) {
      if (out.length >= MAX_SUGGESTIONS) break;
      if (hit(h.url, h.title) && !out.some((o) => sameUrl(o.url, h.url)))
        out.push({ url: h.url, title: h.title, kind: 'history' });
    }
    return out;
  }, [query, enabled, bookmarks, entries]);
}

export function AddressBar({
  tab,
  blocked,
  shieldOn,
  onSubmit,
  onShieldPress,
  onReload,
  onStop,
  onFocusChange,
  position,
}: Props) {
  const styles = useStyles(makeStyles);

  const { accent, accentSoft, colors, fg } = useTheme();
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const [typed, setTyped] = useState(false);
  const suggestions = useSuggestions(draft, focused && typed);
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  const showPage = !tab.home && !!tab.url;
  const host = showPage ? displayHost(tab.url) : '';

  // Bình thường thanh chỉ rộng 3/5 (nằm giữa), chạm vào để gõ thì dãn ra hết bề ngang, xong thì thu lại
  const { width: W } = useWindowDimensions();
  const full = W - 32; // khung bọc ở app/index.tsx cách mép 16 mỗi bên (addrBarWidth)
  const grow = useSharedValue(0);
  useEffect(() => {
    grow.value = withTiming(focused ? 1 : 0, { duration: 300, easing: Easing.out(Easing.cubic) });
  }, [focused, grow]);
  const growStyle = useAnimatedStyle(() => ({ width: full * (BAR_W + (1 - BAR_W) * grow.value) }));

  // Khiên chớp nhẹ mỗi lần chặn thêm (tối đa 2 lần/giây)
  const pulse = useSharedValue(1);
  const lastPulse = useRef({ n: blocked, t: 0 });
  useEffect(() => {
    const now = Date.now();
    if (blocked > lastPulse.current.n && now - lastPulse.current.t > 500) {
      lastPulse.current.t = now;
      pulse.value = withSequence(withTiming(1.2, { duration: 120 }), withSpring(1, MOTION.snappy));
    }
    lastPulse.current.n = blocked;
  }, [blocked, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  const setFocus = (v: boolean) => {
    if (v) setDraft(showPage ? (tab.url ?? '') : '');
    setTyped(false);
    setFocused(v);
    onFocusChange(v);
  };

  return (
    <Animated.View style={[{ alignSelf: 'center' }, growStyle]}>
      {suggestions.length > 0 && (
        <Glass
          radius={22}
          style={[
            styles.suggest,
            position === 'bottom' ? { bottom: ADDRESS_BAR_HEIGHT + 8 } : { top: ADDRESS_BAR_HEIGHT + 8 },
          ]}
          contentStyle={{ paddingVertical: 6 }}
        >
          {suggestions.map((s, i) => (
            <Animated.View key={s.url} entering={FadeInDown.delay(i * 35).duration(220)}>
              <Pressable
                // onPressIn: chạy trước khi ô nhập mất tiêu điểm (nếu không, bàn phím đóng và gợi ý biến mất trước)
                onPressIn={() => {
                  onSubmit(s.url);
                  inputRef.current?.blur();
                }}
                accessibilityRole="link"
                accessibilityLabel={`${s.title}, ${displayHost(s.url)}`}
                style={({ pressed }) => [
                  styles.suggestRow,
                  i > 0 && styles.suggestDivider,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Ionicons
                  name={s.kind === 'bookmark' ? 'star' : 'time-outline'}
                  size={16}
                  color={s.kind === 'bookmark' ? '#FBBF24' : colors.textMuted}
                />
                <View style={{ flex: 1 }}>
                  <Txt weight="medium" size={14} numberOfLines={1}>
                    {s.title || displayHost(s.url)}
                  </Txt>
                  <Txt size={12} color={colors.textMuted} numberOfLines={1}>
                    {s.url.replace(/^https?:\/\//, '')}
                  </Txt>
                </View>
              </Pressable>
            </Animated.View>
          ))}
        </Glass>
      )}
      <Glass radius={ADDRESS_BAR_HEIGHT / 2} style={{ height: ADDRESS_BAR_HEIGHT }} contentStyle={styles.row}>
        {!focused && (
          <Pressable
            onPress={onShieldPress}
            accessibilityRole="button"
            accessibilityLabel={`Shield, đã chặn ${blocked} mục trên trang này`}
            hitSlop={6}
            style={({ pressed }) => [
              styles.shield,
              { backgroundColor: shieldOn ? accentSoft : fg(0.08) },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Animated.View style={pulseStyle}>
              <Ionicons
                name={shieldOn ? 'shield-checkmark' : 'shield-outline'}
                size={16}
                color={shieldOn ? accent : colors.textMuted}
              />
            </Animated.View>
            {blocked > 0 && <RollingCount value={blocked} color={accent} />}
          </Pressable>
        )}

        {focused ? <Ionicons name="search" size={17} color={colors.textMuted} style={{ marginLeft: 14 }} /> : null}

        {focused ? (
          <View style={styles.inputWrap}>
            <TextInput
              ref={inputRef}
              autoFocus
              value={draft}
              onChangeText={(t) => {
                setDraft(t);
                setTyped(true);
              }}
              placeholder="Search"
              placeholderTextColor={colors.textMuted}
              onBlur={() => setFocus(false)}
              onSubmitEditing={() => {
                if (draft.trim()) onSubmit(draft);
                inputRef.current?.blur();
              }}
              selectTextOnFocus
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="web-search"
              returnKeyType="go"
              keyboardAppearance={colors.scheme}
              selectionColor={accent}
              clearButtonMode="while-editing"
              accessibilityLabel="Thanh địa chỉ"
              style={styles.input}
            />
          </View>
        ) : (
          <Pressable
            onPress={() => setFocus(true)}
            accessibilityRole="search"
            accessibilityLabel={showPage ? `Địa chỉ: ${host}. Chạm để sửa` : 'Search'}
            style={styles.inputWrap}
          >
            {showPage && (
              <Ionicons
                name={isSecure(tab.url) ? 'lock-closed' : 'warning-outline'}
                size={12}
                color={isSecure(tab.url) ? colors.textMuted : colors.gambling}
                style={{ marginRight: 6 }}
              />
            )}
            <Txt
              weight="medium"
              size={16}
              numberOfLines={1}
              color={showPage ? colors.text : colors.textMuted}
              style={{ flexShrink: 1 }}
            >
              {showPage ? host : 'Search'}
            </Txt>
          </Pressable>
        )}

        {focused ? (
          <Pressable
            onPress={() => inputRef.current?.blur()}
            accessibilityRole="button"
            hitSlop={8}
            style={styles.cancel}
          >
            <Txt weight="medium" size={15} color={accent}>
              Huỷ
            </Txt>
          </Pressable>
        ) : showPage ? (
          <IconButton
            icon={tab.loading ? 'close' : 'refresh'}
            label={tab.loading ? 'Dừng tải' : 'Tải lại'}
            onPress={tab.loading ? onStop : onReload}
            iconSize={18}
            size={40}
            color={colors.textMuted}
          />
        ) : (
          <View style={{ width: 40 }} />
        )}

        {!focused && showPage && <ProgressLine loading={tab.loading} progress={tab.progress} color={accent} />}
      </Glass>
    </Animated.View>
  );
}

const makeStyles = (colors: Palette, fg: (alpha: number) => string) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
    shield: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 36,
      minWidth: 40,
      paddingHorizontal: 10,
      borderRadius: 18,
      justifyContent: 'center',
    },
    shieldCount: { lineHeight: 16 },
    inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
    input: {
      flexShrink: 1,
      flexGrow: 1,
      color: colors.text,
      fontFamily: fonts.medium,
      fontSize: 16,
      height: ADDRESS_BAR_HEIGHT,
      paddingVertical: 0,
    },
    suggest: { position: 'absolute', left: 0, right: 0 },
    suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 52 },
    suggestDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fg(0.1) },
    cancel: { paddingHorizontal: 12, height: 40, justifyContent: 'center' },
    progressTrack: {
      position: 'absolute',
      left: 20,
      right: 20,
      bottom: 3,
      height: 2,
      borderRadius: 1,
      overflow: 'hidden',
    },
    progress: { height: 2, borderRadius: 1, overflow: 'hidden' },
    glint: { position: 'absolute', top: 0, bottom: 0, width: '30%', backgroundColor: 'rgba(255,255,255,0.55)' },
    rollBox: { marginLeft: 4, height: 16, overflow: 'hidden', justifyContent: 'center' },
    rollAbs: { position: 'absolute', left: 0, right: 0, top: 0 },
  });

/**
 * Thanh địa chỉ tĩnh, y hệt thanh thật lúc không gõ: vẽ trong thẻ ở màn các thẻ (thu nhỏ theo thẻ), để thẻ trông
 * đúng như trang thật vừa thu nhỏ (trang + thanh địa chỉ, không có dock).
 */
export function StaticAddressBar({ tab, blocked, width }: { tab: Tab; blocked: number; width: number }) {
  const styles = useStyles(makeStyles);
  const { colors, accent, accentSoft } = useTheme();
  const showPage = !tab.home && !!tab.url;
  return (
    <Glass radius={ADDRESS_BAR_HEIGHT / 2} style={{ height: ADDRESS_BAR_HEIGHT, width }} contentStyle={styles.row}>
      <View style={[styles.shield, { backgroundColor: accentSoft }]}>
        <Ionicons name="shield-checkmark" size={16} color={accent} />
        {blocked > 0 && (
          <Txt weight="semibold" size={13} color={accent} style={{ marginLeft: 4, fontVariant: ['tabular-nums'] }}>
            {blocked}
          </Txt>
        )}
      </View>
      <View style={styles.inputWrap}>
        {showPage && (
          <Ionicons
            name={isSecure(tab.url) ? 'lock-closed' : 'warning-outline'}
            size={12}
            color={isSecure(tab.url) ? colors.textMuted : colors.gambling}
            style={{ marginRight: 6 }}
          />
        )}
        <Txt
          weight="medium"
          size={16}
          numberOfLines={1}
          color={showPage ? colors.text : colors.textMuted}
          style={{ flexShrink: 1 }}
        >
          {showPage ? displayHost(tab.url) : 'Search'}
        </Txt>
      </View>
      {showPage ? (
        <View style={{ width: 40, alignItems: 'center' }}>
          <Ionicons name="refresh" size={18} color={colors.textMuted} />
        </View>
      ) : (
        <View style={{ width: 40 }} />
      )}
    </Glass>
  );
}
