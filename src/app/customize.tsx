import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View, type HostInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DOCK_BUTTONS } from '@/components/dock';
import { HomeCustomize } from '@/components/home-customize';
import { useThemeFade } from '@/components/theme-fade';
import { TAB_LAYOUTS } from '@/components/tab-overview';
import { getContentBlockerStatus, refreshContentBlocker, subscribeContentBlocker } from '@/lib/content-blocker';
import { log } from '@/lib/logger';
import { ToggleRow } from '@/components/toggle-row';
import { Txt } from '@/components/txt';
import {
  DEFAULT_SETTINGS,
  MAX_DOCK_BUTTONS,
  useSettings,
  type DockButtonId,
  type DockStyle,
  type Settings,
} from '@/state/settings';
import {
  ACCENT_PRESETS,
  GLASS_LABELS,
  MODES,
  THEMES,
  setAppearance,
  themeAccent,
  useTheme,
  withAlpha,
  type ThemeId,
  type ThemeMode,
  useStyles,
  type Palette,
} from '@/theme';

const DOCK_STYLES: { id: DockStyle; label: string; hint: string }[] = [
  { id: 'floating', label: 'Nổi', hint: 'Viên nang kính' },
  { id: 'compact', label: 'Gọn', hint: 'Thấp, ít chiếm chỗ' },
  { id: 'attached', label: 'Gắn đáy', hint: 'Sát mép màn hình' },
];

const ALL_BUTTONS = Object.keys(DOCK_BUTTONS) as DockButtonId[];

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();

  return (
    <View style={styles.section}>
      <Txt weight="semibold" size={13} color={colors.textMuted} style={styles.sectionTitle} accessibilityRole="header">
        {title.toUpperCase()}
      </Txt>
      {children}
      {hint ? (
        <Txt size={13} color={colors.textFaint} style={{ marginTop: 8, marginHorizontal: 4 }}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const styles = useStyles(makeStyles);

  const { accent, onAccent, colors } = useTheme();
  return (
    <View style={styles.segment} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[styles.segItem, on && { backgroundColor: accent }]}
          >
            <Txt weight={on ? 'semibold' : 'medium'} size={14} color={on ? onAccent : colors.text}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Hình minh hoạ nhỏ cho từng kiểu dock. */
function DockPreview({ style, accent }: { style: DockStyle; accent: string }) {
  const styles = useStyles(makeStyles);

  const bar =
    style === 'attached'
      ? { left: 0, right: 0, bottom: 0, height: 14, borderRadius: 0 }
      : style === 'compact'
        ? { left: 8, right: 22, bottom: 6, height: 9, borderRadius: 5 }
        : { left: 8, right: 22, bottom: 6, height: 13, borderRadius: 7 };
  return (
    <View style={styles.preview}>
      <View style={[styles.previewBar, bar]} />
      {style !== 'attached' && (
        <View
          style={[
            styles.previewBar,
            {
              right: 6,
              bottom: 6,
              width: bar.height,
              height: bar.height,
              borderRadius: bar.height / 2,
              backgroundColor: withAlpha(accent, 0.6),
            },
          ]}
        />
      )}
    </View>
  );
}

export default function CustomizeScreen() {
  const styles = useStyles(makeStyles);

  const insets = useSafeAreaInsets();
  const { settings, update, reset } = useSettings();
  const { accent, accentSoft, colors, pageModeLabel, pageModeIcon, theme: themeId, mode } = useTheme();

  /** Đổi giao diện + chế độ ngay tại chỗ (màn hình chuyển màu dần, xem components/theme-fade), không mở lại app */
  const applyAppearance = (next: ThemeId, nextMode: ThemeMode) => {
    if (next === themeId && nextMode === mode) return;
    const from = `${themeId}:${mode}`;
    setAppearance(next, nextMode)
      .then(() => {
        update({ accent: themeAccent(next, nextMode) });
        log.info('ui', 'Đổi giao diện', `${from} → ${next}:${nextMode}`);
      })
      .catch((e: unknown) => log.error('ui', 'Không đổi được giao diện', e));
  };

  const toggleButton = (id: DockButtonId) => {
    const has = settings.dockButtons.includes(id);
    if (has) {
      update({ dockButtons: settings.dockButtons.filter((b) => b !== id) });
    } else if (settings.dockButtons.length < MAX_DOCK_BUTTONS) {
      // Giữ thứ tự gốc của danh sách để back/forward luôn đứng cạnh nhau
      const next = ALL_BUTTONS.filter((b) => b === id || settings.dockButtons.includes(b));
      update({ dockButtons: next });
    }
  };

  const setShield = (key: keyof Settings['shield'], v: boolean) => update({ shield: { ...settings.shield, [key]: v } });

  const confirmReset = () =>
    Alert.alert('Khôi phục mặc định?', 'Mọi tuỳ chỉnh giao diện và bảo vệ sẽ trở về ban đầu.', [
      { text: 'Huỷ', style: 'cancel' },
      { text: 'Khôi phục', style: 'destructive', onPress: reset },
    ]);

  const full = settings.dockButtons.length >= MAX_DOCK_BUTTONS;
  // Hai mục: Giao diện (như trước) và Trang chủ (bật/tắt từng phần, có xem trước)
  const [pane, setPane] = useState<'look' | 'home'>('look');
  // Đổi giao diện: màn này chuyển màu dần (ảnh chụp màu cũ mờ đi)
  const rootRef = useRef<HostInstance>(null);
  const fade = useThemeFade(rootRef);

  return (
    <View ref={rootRef} collapsable={false} style={styles.root}>
      <View style={styles.header}>
        <Txt weight="bold" size={22} accessibilityRole="header">
          Tuỳ chỉnh
        </Txt>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8} style={styles.headerBtn}>
          <Txt weight="semibold" size={16} color={accent}>
            Xong
          </Txt>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
        <View style={{ marginBottom: 20 }}>
          <Segmented
            options={[
              { value: 'look', label: 'Giao diện' },
              { value: 'home', label: 'Trang chủ' },
            ]}
            value={pane}
            onChange={setPane}
          />
        </View>
        {pane === 'home' ? (
          <HomeCustomize />
        ) : (
          <>
            <Section title="Kiểu thanh dock">
              <View style={styles.row3}>
                {DOCK_STYLES.map((d) => {
                  const on = settings.dockStyle === d.id;
                  return (
                    <Pressable
                      key={d.id}
                      onPress={() => update({ dockStyle: d.id })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${d.label}, ${d.hint}`}
                      style={[styles.option, on && { borderColor: accent, backgroundColor: accentSoft }]}
                    >
                      <DockPreview style={d.id} accent={accent} />
                      <Txt weight="semibold" size={14} style={{ marginTop: 8 }}>
                        {d.label}
                      </Txt>
                      <Txt size={11} color={colors.textMuted} numberOfLines={1}>
                        {d.hint}
                      </Txt>
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            <Section title="Kiểu hiển thị thẻ" hint="Cũng đổi được ngay trên màn các thẻ (giữ dock kéo lên).">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {TAB_LAYOUTS.map((l) => {
                  const on = settings.tabLayout === l.id;
                  return (
                    <Pressable
                      key={l.id}
                      onPress={() => update({ tabLayout: l.id })}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={({ pressed }) => [
                        {
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          height: 36,
                          paddingHorizontal: 12,
                          borderRadius: 18,
                          backgroundColor: on ? accentSoft : colors.surface,
                        },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Ionicons name={l.icon} size={15} color={on ? accent : colors.textMuted} />
                      <Txt weight={on ? 'semibold' : 'medium'} size={13} color={on ? accent : colors.textMuted}>
                        {l.label}
                      </Txt>
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            <Section title="Vị trí thanh địa chỉ">
              <Segmented
                options={[
                  { value: 'top', label: 'Trên cùng' },
                  { value: 'bottom', label: 'Dưới cùng' },
                ]}
                value={settings.addressBarPosition}
                onChange={(v) => update({ addressBarPosition: v })}
              />
            </Section>

            <Section title="Giao diện" hint="Trang web đang mở đổi chế độ sáng/tối cho trang ở lần tải lại sau.">
              <Segmented
                options={THEMES.map((t) => ({ value: t.id, label: t.label }))}
                value={themeId}
                onChange={(id) => applyAppearance(id, mode)}
              />
              {/* Matcha là giao diện riêng, không có bản sáng/tối */}
              {themeId !== 'matcha' && (
                <>
                  <View style={{ height: 10 }} />
                  <Segmented
                    options={MODES.map((m) => ({ value: m.id, label: m.label }))}
                    value={mode}
                    onChange={(m) => applyAppearance(themeId, m)}
                  />
                </>
              )}
            </Section>

            <Section title="Màu nhấn">
              <View style={styles.swatches} accessibilityRole="radiogroup">
                {ACCENT_PRESETS.map((c) => {
                  const on = c.toLowerCase() === settings.accent.toLowerCase();
                  return (
                    <Pressable
                      key={c}
                      onPress={() => update({ accent: c })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`Màu ${c}`}
                      style={[styles.swatchRing, on && { borderColor: c }]}
                    >
                      <View style={[styles.swatch, { backgroundColor: c }]}>
                        {on && <Ionicons name="checkmark" size={20} color="#05140E" />}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            <Section title="Độ trong suốt của kính">
              <Segmented
                options={GLASS_LABELS.map((label, i) => ({ value: i as Settings['glass'], label }))}
                value={settings.glass}
                onChange={(v) => update({ glass: v })}
              />
            </Section>

            <Section
              title={`Nút trên thanh dock (${settings.dockButtons.length}/${MAX_DOCK_BUTTONS})`}
              hint="Nút “+” (thẻ mới) luôn nằm riêng bên phải. Quay lại và Tiến tới được nhóm cạnh nhau."
            >
              <View style={styles.card}>
                {ALL_BUTTONS.map((id, i) => {
                  const on = settings.dockButtons.includes(id);
                  const disabled = !on && full;
                  const def = DOCK_BUTTONS[id];
                  return (
                    <Pressable
                      key={id}
                      onPress={() => toggleButton(id)}
                      disabled={disabled}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on, disabled }}
                      style={({ pressed }) => [
                        styles.btnRow,
                        i < ALL_BUTTONS.length - 1 && styles.divider,
                        pressed && { opacity: 0.6 },
                        disabled && { opacity: 0.4 },
                      ]}
                    >
                      <View style={styles.btnIcon}>
                        <Ionicons name={def.icon} size={19} color={colors.text} />
                      </View>
                      <Txt weight="medium" size={15} style={{ flex: 1 }}>
                        {def.label}
                      </Txt>
                      <Ionicons
                        name={on ? 'checkmark-circle' : 'ellipse-outline'}
                        size={24}
                        color={on ? accent : colors.textFaint}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            <Section title="Bảo vệ mặc định" hint="Có thể thay đổi riêng cho từng trang trong bảng Shield.">
              <View style={[styles.card, { paddingHorizontal: 14 }]}>
                <ToggleRow
                  icon="dice-outline"
                  iconColor={colors.gambling}
                  title="Chặn quảng cáo cờ bạc"
                  value={settings.shield.gambling}
                  onChange={(v) => setShield('gambling', v)}
                />
                <ToggleRow
                  icon="megaphone-outline"
                  title="Chặn quảng cáo thường"
                  value={settings.shield.ads}
                  onChange={(v) => setShield('ads', v)}
                />
                <ToggleRow
                  icon="albums-outline"
                  iconColor={colors.popups}
                  title="Chặn pop-up & chuyển hướng"
                  value={settings.shield.popups}
                  onChange={(v) => setShield('popups', v)}
                />
                <ToggleRow
                  icon="hand-left-outline"
                  title="Tự từ chối bảng hỏi cookie"
                  subtitle="Áp dụng từ trang tải sau"
                  value={settings.shield.cookies}
                  onChange={(v) => setShield('cookies', v)}
                />
                <ToggleRow
                  icon={pageModeIcon}
                  iconColor="#93C5FD"
                  title={`${pageModeLabel} cho mọi trang`}
                  value={settings.shield.dark}
                  onChange={(v) => setShield('dark', v)}
                  last
                />
              </View>
              {Object.keys(settings.siteOverrides).length > 0 && (
                <Pressable
                  onPress={() => update({ siteOverrides: {} })}
                  accessibilityRole="button"
                  style={styles.linkBtn}
                >
                  <Txt weight="medium" size={14} color={accent}>
                    Xoá tuỳ chọn riêng của {Object.keys(settings.siteOverrides).length} trang
                  </Txt>
                </Pressable>
              )}
            </Section>

            <FilterStatus />

            <Section title="Mạng" hint="Dùng khi nhà mạng chặn trang web.">
              <Pressable
                onPress={() => router.push('/dns')}
                accessibilityRole="button"
                style={({ pressed }) => [styles.card, styles.linkRow, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="lock-closed-outline" size={20} color={colors.text} />
                <Txt weight="medium" size={15} style={{ flex: 1 }}>
                  DNS bảo mật
                </Txt>
                <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
              </Pressable>
            </Section>

            <Section
              title="Nâng cao"
              hint="Chẩn đoán video: chỉ bật khi cần gửi Nhật ký để dò lỗi. Bật/tắt xong tải lại trang."
            >
              <View style={[styles.card, { paddingHorizontal: 14 }]}>
                <ToggleRow
                  icon="musical-notes-outline"
                  title="Phát nền"
                  subtitle="Âm thanh tiếp tục khi tắt màn hình. Video: bấm nút PiP trên video để xem trong khung nổi"
                  value={settings.backgroundPlay}
                  onChange={(v) => update({ backgroundPlay: v })}
                />
                <ToggleRow
                  icon="pulse-outline"
                  title="Chẩn đoán video"
                  subtitle="Ghi trạng thái trình phát vào Nhật ký"
                  value={settings.diagVideo}
                  onChange={(v) => update({ diagVideo: v })}
                  last
                />
              </View>
            </Section>

            <Pressable
              onPress={confirmReset}
              disabled={JSON.stringify(settings) === JSON.stringify(DEFAULT_SETTINGS)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.resetBtn, pressed && { opacity: 0.7 }]}
            >
              <Txt weight="semibold" size={15} color={colors.danger}>
                Khôi phục mặc định
              </Txt>
            </Pressable>
          </>
        )}
      </ScrollView>
      {fade}
    </View>
  );
}

const makeStyles = (colors: Palette, fg: (alpha: number) => string) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 4,
    },
    headerBtn: { minHeight: 44, justifyContent: 'center' },
    section: { marginBottom: 26 },
    sectionTitle: { marginBottom: 10, marginLeft: 4, letterSpacing: 0.5 },
    row3: { flexDirection: 'row', gap: 10 },
    option: {
      flex: 1,
      padding: 10,
      borderRadius: 18,
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.border,
    },
    preview: { height: 64, borderRadius: 10, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
    previewBar: { position: 'absolute', backgroundColor: fg(0.35) },
    segment: { flexDirection: 'row', padding: 4, borderRadius: 16, backgroundColor: colors.surface, gap: 4 },
    segItem: { flex: 1, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    swatches: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
    swatchRing: { padding: 3, borderRadius: 27, borderWidth: 2, borderColor: 'transparent' },
    swatch: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    card: { borderRadius: 20, backgroundColor: colors.surface, overflow: 'hidden' },
    btnRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14 },
    btnIcon: {
      width: 32,
      height: 32,
      borderRadius: 9,
      backgroundColor: fg(0.07),
      alignItems: 'center',
      justifyContent: 'center',
    },
    divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    linkBtn: { minHeight: 44, justifyContent: 'center', marginTop: 4, marginLeft: 4 },
    resetBtn: {
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(248,113,113,0.10)',
    },
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 52 },
  });

/** Trạng thái bộ lọc tầng mạng (EasyList + ABPVN) và nút cập nhật ngay. */
function FilterStatus() {
  const styles = useStyles(makeStyles);

  const { accent, colors } = useTheme();
  const st = useSyncExternalStore(subscribeContentBlocker, getContentBlockerStatus);
  const when = st.updatedAt ? new Date(st.updatedAt).toLocaleDateString('vi-VN') : 'chưa tải';
  const detail = !st.supported
    ? 'Cần cài bản Ryx mới (1.0.2 trở lên) để bật bộ lọc này.'
    : st.busy
      ? 'Đang tải / biên dịch bộ lọc…'
      : `${st.ruleCount.toLocaleString('vi-VN')} luật · cập nhật ${when} · ${st.active} danh sách đang bật`;
  return (
    <Section
      title="Bộ lọc quảng cáo tầng mạng"
      hint="EasyList (kể cả trang 18+) và ABPVN cho trang Việt. Chặn quảng cáo trước khi tải, kể cả trong khung con. Tự cập nhật 3 ngày/lần."
    >
      <View style={[styles.card, styles.linkRow]}>
        <Ionicons name="layers-outline" size={20} color={colors.text} />
        <Txt size={14} style={{ flex: 1 }} color={colors.textMuted}>
          {detail}
        </Txt>
        {st.supported && (
          <Pressable
            onPress={() => void refreshContentBlocker(true)}
            disabled={st.busy}
            accessibilityRole="button"
            style={({ pressed }) => [
              { paddingHorizontal: 8, minHeight: 44, justifyContent: 'center' },
              (pressed || st.busy) && { opacity: 0.5 },
            ]}
          >
            <Txt weight="semibold" size={14} color={accent}>
              Cập nhật
            </Txt>
          </Pressable>
        )}
      </View>
    </Section>
  );
}
