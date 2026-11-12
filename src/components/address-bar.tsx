import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { displayHost, isSecure } from '@/lib/url';
import { sameUrl, useBookmarks } from '@/state/bookmarks';
import { useHistory } from '@/state/history';
import type { Tab } from '@/state/tabs';
import { colors, fonts, useTheme } from '@/theme';
import { Glass } from './glass';
import { IconButton } from './icon-button';
import { Txt } from './txt';

export const ADDRESS_BAR_HEIGHT = 48;

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
  const { accent, accentSoft } = useTheme();
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const [typed, setTyped] = useState(false);
  const suggestions = useSuggestions(draft, focused && typed);
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  const showPage = !tab.home && !!tab.url;
  const host = showPage ? displayHost(tab.url) : '';

  const setFocus = (v: boolean) => {
    if (v) setDraft(showPage ? (tab.url ?? '') : '');
    setTyped(false);
    setFocused(v);
    onFocusChange(v);
  };

  return (
    <View>
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
            <Pressable
              key={s.url}
              // onPressIn: chạy trước khi ô nhập mất tiêu điểm (nếu không, bàn phím đóng và gợi ý biến mất trước)
              onPressIn={() => {
                onSubmit(s.url);
                inputRef.current?.blur();
              }}
              accessibilityRole="link"
              accessibilityLabel={`${s.title}, ${displayHost(s.url)}`}
              style={({ pressed }) => [styles.suggestRow, i > 0 && styles.suggestDivider, pressed && { opacity: 0.6 }]}
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
              { backgroundColor: shieldOn ? accentSoft : 'rgba(255,255,255,0.08)' },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons
              name={shieldOn ? 'shield-checkmark' : 'shield-outline'}
              size={16}
              color={shieldOn ? accent : colors.textMuted}
            />
            {blocked > 0 && (
              <Txt weight="bold" size={13} color={accent} style={styles.shieldCount}>
                {blocked > 999 ? '999+' : blocked}
              </Txt>
            )}
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
              placeholder="Tìm kiếm hoặc nhập địa chỉ"
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
              keyboardAppearance="dark"
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
            accessibilityLabel={showPage ? `Địa chỉ: ${host}. Chạm để sửa` : 'Tìm kiếm hoặc nhập địa chỉ'}
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
              {showPage ? host : 'Tìm kiếm hoặc nhập địa chỉ'}
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

        {tab.loading && !focused && (
          <View style={styles.progressTrack} pointerEvents="none">
            <View
              style={[styles.progress, { width: `${Math.max(5, tab.progress * 100)}%`, backgroundColor: accent }]}
            />
          </View>
        )}
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
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
  shieldCount: { marginLeft: 4, lineHeight: 16 },
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
  suggestDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.1)' },
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
  progress: { height: 2, borderRadius: 1 },
});
