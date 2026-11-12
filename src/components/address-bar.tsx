import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { displayHost, isSecure } from '@/lib/url';
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
}

export function AddressBar({ tab, blocked, shieldOn, onSubmit, onShieldPress, onReload, onStop, onFocusChange }: Props) {
  const { accent, accentSoft } = useTheme();
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  const showPage = !tab.home && !!tab.url;
  const host = showPage ? displayHost(tab.url) : '';

  const setFocus = (v: boolean) => {
    if (v) setDraft(showPage ? (tab.url ?? '') : '');
    setFocused(v);
    onFocusChange(v);
  };

  return (
    <Glass radius={ADDRESS_BAR_HEIGHT / 2} style={{ height: ADDRESS_BAR_HEIGHT }} contentStyle={styles.row}>
      {!focused && (
        <Pressable
          onPress={onShieldPress}
          accessibilityRole="button"
          accessibilityLabel={`Khiên bảo vệ, đã chặn ${blocked} mục trên trang này`}
          hitSlop={6}
          style={({ pressed }) => [
            styles.shield,
            { backgroundColor: shieldOn ? accentSoft : 'rgba(255,255,255,0.08)' },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Ionicons name={shieldOn ? 'shield-checkmark' : 'shield-outline'} size={16} color={shieldOn ? accent : colors.textMuted} />
          {blocked > 0 && (
            <Txt weight="bold" size={13} color={accent} style={styles.shieldCount}>
              {blocked > 999 ? '999+' : blocked}
            </Txt>
          )}
        </Pressable>
      )}

      {focused ? (
        <Ionicons name="search" size={17} color={colors.textMuted} style={{ marginLeft: 14 }} />
      ) : null}

      {focused ? (
        <View style={styles.inputWrap}>
          <TextInput
            ref={inputRef}
            autoFocus
            value={draft}
            onChangeText={setDraft}
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
          <View style={[styles.progress, { width: `${Math.max(5, tab.progress * 100)}%`, backgroundColor: accent }]} />
        </View>
      )}
    </Glass>
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
  cancel: { paddingHorizontal: 12, height: 40, justifyContent: 'center' },
  progressTrack: { position: 'absolute', left: 20, right: 20, bottom: 3, height: 2, borderRadius: 1, overflow: 'hidden' },
  progress: { height: 2, borderRadius: 1 },
});
