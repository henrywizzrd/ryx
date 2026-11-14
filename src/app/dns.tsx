import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from '@/components/txt';
import { log } from '@/lib/logger';
import { getRyxNetStatus, hasRyxNet, setRyxNetEnabled, type RyxNetStatus } from '@/lib/ryx-net';
import { useTabs } from '@/state/tabs';
import { useTheme, useStyles, type Palette } from '@/theme';

/**
 * DNS bảo mật bằng hồ sơ cấu hình iOS (.mobileconfig, DNS over HTTPS).
 * Ryx không tự bật DNS được (cần quyền Network Extension của tài khoản Apple trả phí),
 * nên chỉ mở file hồ sơ đã ký trong Safari để người dùng tự cài trong Cài đặt.
 * Nguồn hồ sơ: github.com/paulmillr/encrypted-dns (bản đã ký, iOS hiện "Đã xác minh").
 */
const PROVIDERS = [
  {
    id: 'google',
    name: 'Google Public DNS',
    note: 'Khuyên dùng ở Việt Nam: chạy ổn định, ít bị nhà mạng chặn.',
    url: 'https://github.com/paulmillr/encrypted-dns/raw/master/signed/google-default-https.mobileconfig',
    check: null,
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare 1.1.1.1 Security',
    note: 'Chặn thêm trang lừa đảo, mã độc. Một số nhà mạng chặn địa chỉ 1.1.1.1 nên có thể rất chậm.',
    url: 'https://github.com/paulmillr/encrypted-dns/raw/master/signed/cloudflare-malware-https.mobileconfig',
    check: 'https://one.one.one.one/help',
  },
] as const;

type ProviderId = (typeof PROVIDERS)[number]['id'];

const STEPS = [
  'Bấm "Tải hồ sơ DNS" bên dưới. Safari sẽ mở ra và hỏi có cho phép tải hồ sơ cấu hình không → chọn Cho phép.',
  'Mở Cài đặt → bấm "Đã tải về hồ sơ" (ngay dưới tên Apple ID của bạn) → Cài đặt → nhập mật mã máy.',
  'Quay lại Ryx và mở lại trang bị chặn.',
];

export default function DnsScreen() {
  const styles = useStyles(makeStyles);

  const insets = useSafeAreaInsets();
  const { accent, accentSoft, onAccent, colors } = useTheme();
  const { newTab } = useTabs();
  const [net, setNet] = useState<RyxNetStatus>(getRyxNetStatus);
  // Chưa bật lần nào → gợi ý Google (Cloudflare hay bị chặn ở VN)
  const [picked, setPicked] = useState<ProviderId>(net.enabled ? net.provider : 'google');
  const [changed, setChanged] = useState(false);
  const provider = PROVIDERS.find((p) => p.id === picked)!;

  // Cập nhật trạng thái proxy mỗi 2 giây khi đang mở màn này
  useEffect(() => {
    const t = setInterval(() => setNet(getRyxNetStatus()), 2000);
    return () => clearInterval(t);
  }, []);

  const toggleInApp = (on: boolean) => {
    setRyxNetEnabled(on, picked);
    setChanged(true);
    setTimeout(() => setNet(getRyxNetStatus()), 400);
  };

  const pick = (id: ProviderId) => {
    setPicked(id);
    if (net.enabled) {
      setRyxNetEnabled(true, id);
      setChanged(true);
    }
  };

  const inAppLine = !hasRyxNet
    ? 'Cần cài bản Ryx 1.0.1 trở lên.'
    : !net.supported
      ? 'Cần iOS 17 trở lên.'
      : !net.enabled
        ? 'Đang tắt.'
        : net.running && net.applied
          ? `Đang chạy · đã hỏi ${net.resolved} tên miền${net.fallbacks ? ` · ${net.fallbacks} lần phải dùng DNS hệ thống` : ''}`
          : 'Đang khởi động…';

  const download = () => {
    log.info('dns', `Mở hồ sơ DNS: ${provider.name}`, provider.url);
    Linking.openURL(provider.url).catch((e) => log.error('dns', 'Không mở được link hồ sơ DNS', e));
  };

  const check = () => {
    if (!provider.check) return;
    newTab(provider.check);
    router.dismissAll();
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Txt weight="bold" size={22} accessibilityRole="header">
          DNS bảo mật
        </Txt>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8} style={styles.headerBtn}>
          <Txt weight="semibold" size={16} color={accent}>
            Xong
          </Txt>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 20 }}>
        <Txt size={14} color={colors.textMuted}>
          Nhà mạng thường chặn trang web bằng DNS. Cài hồ sơ DNS mã hoá để iPhone hỏi địa chỉ trang qua máy chủ khác,
          nhờ vậy thường vào lại được trang bị chặn. Áp dụng cho cả máy (Ryx, Safari và các app khác), miễn phí, gỡ lúc
          nào cũng được.
        </Txt>

        <View style={[styles.inApp, net.enabled && net.running && { borderColor: accent }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Ionicons name="shield-checkmark" size={24} color={net.enabled ? accent : colors.textFaint} />
            <View style={{ flex: 1 }}>
              <Txt weight="semibold" size={16}>
                DNS riêng trong Ryx
              </Txt>
              <Txt size={12} color={colors.textMuted}>
                Khuyên dùng · không cần cài hồ sơ · chỉ áp dụng cho Ryx
              </Txt>
            </View>
            <Switch
              value={net.enabled}
              onValueChange={toggleInApp}
              disabled={!hasRyxNet || !net.supported}
              trackColor={{ true: accent }}
              accessibilityLabel="Bật DNS riêng trong Ryx"
            />
          </View>
          <Txt size={13} color={net.enabled && net.running ? colors.text : colors.textMuted}>
            {inAppLine}
          </Txt>
          {changed ? (
            <Txt size={12} color={colors.gambling}>
              Tắt hẳn Ryx rồi mở lại để áp dụng cho mọi trang (các trang đang mở có thể vẫn dùng kết nối cũ).
            </Txt>
          ) : null}
        </View>

        <View style={{ gap: 10 }}>
          <Txt weight="semibold" size={13} color={colors.textMuted}>
            CHỌN MÁY CHỦ
          </Txt>
          {PROVIDERS.map((p) => {
            const on = p.id === picked;
            return (
              <Pressable
                key={p.id}
                onPress={() => pick(p.id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                style={[styles.option, on && { borderColor: accent, backgroundColor: accentSoft }]}
              >
                <Ionicons
                  name={on ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={on ? accent : colors.textFaint}
                />
                <View style={{ flex: 1 }}>
                  <Txt weight="semibold" size={15}>
                    {p.name}
                  </Txt>
                  <Txt size={13} color={colors.textMuted}>
                    {p.note}
                  </Txt>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={{ gap: 10 }}>
          <Txt weight="semibold" size={13} color={colors.textMuted}>
            CÁCH KHÁC: HỒ SƠ DNS CHO CẢ MÁY
          </Txt>
          <Txt size={13} color={colors.textMuted}>
            Dùng khi muốn Safari và các app khác cũng vào được trang bị chặn.
          </Txt>
          {STEPS.map((s, i) => (
            <View key={i} style={styles.step}>
              <View style={[styles.stepNum, { backgroundColor: accentSoft }]}>
                <Txt weight="bold" size={13} color={accent}>
                  {i + 1}
                </Txt>
              </View>
              <Txt size={14} style={{ flex: 1 }}>
                {s}
              </Txt>
            </View>
          ))}
        </View>

        <Pressable
          onPress={download}
          accessibilityRole="button"
          style={({ pressed }) => [styles.primary, { backgroundColor: accent }, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="download-outline" size={20} color={onAccent} />
          <Txt weight="semibold" size={16} color={onAccent}>
            Tải hồ sơ DNS
          </Txt>
        </Pressable>

        {provider.check ? (
          <Pressable
            onPress={check}
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="checkmark-done-outline" size={20} color={colors.text} />
            <Txt weight="medium" size={15}>
              Kiểm tra đã bật chưa
            </Txt>
          </Pressable>
        ) : null}

        <Txt size={12} color={colors.textFaint}>
          Muốn gỡ: Cài đặt → Cài đặt chung → VPN & Quản lý thiết bị → chọn hồ sơ DNS → Xoá hồ sơ. Nếu cài hồ sơ rồi mà
          vẫn không vào được, có thể nhà mạng chặn sâu hơn DNS hoặc chặn luôn máy chủ đó; thử máy chủ còn lại.
        </Txt>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 20,
    },
    headerBtn: { minHeight: 44, justifyContent: 'center' },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 14,
      minHeight: 64,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    inApp: {
      gap: 10,
      padding: 16,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
    stepNum: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
    primary: {
      minHeight: 52,
      borderRadius: 26,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    secondary: {
      minHeight: 50,
      borderRadius: 25,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.surfaceRaised,
    },
  });
