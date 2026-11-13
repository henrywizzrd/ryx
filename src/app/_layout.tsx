import {
  BeVietnamPro_400Regular,
  BeVietnamPro_500Medium,
  BeVietnamPro_600SemiBold,
  BeVietnamPro_700Bold,
  useFonts,
} from '@expo-google-fonts/be-vietnam-pro';
import { DarkTheme, Stack, ThemeProvider, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Txt } from '@/components/txt';
import { UpdateBanner } from '@/components/update-banner';
import { initUpdates } from '@/lib/app-updates';
import { initRyxNet } from '@/lib/ryx-net';
import { initLogging, log } from '@/lib/logger';
import { initPerfMonitor } from '@/lib/perf-monitor';
import { BookmarksProvider } from '@/state/bookmarks';
import { DownloadsProvider } from '@/state/downloads';
import { HistoryProvider } from '@/state/history';
import { ReadingProvider } from '@/state/reading';
import { SettingsProvider, useSettings } from '@/state/settings';
import { StatsProvider } from '@/state/stats';
import { TabsProvider } from '@/state/tabs';
import { colors } from '@/theme';

// Bật nhật ký + theo dõi hiệu năng sớm nhất có thể để bắt được cả lỗi lúc khởi động
initLogging();
initPerfMonitor();
initUpdates();
initRyxNet();

SplashScreen.preventAutoHideAsync();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
  },
};

function RootStack() {
  const { settings } = useSettings();
  const theme = { ...navTheme, colors: { ...navTheme.colors, primary: settings.accent } };
  return (
    <ThemeProvider value={theme}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="customize" options={{ presentation: 'modal' }} />
        <Stack.Screen name="logs" options={{ presentation: 'modal' }} />
        <Stack.Screen name="history" options={{ presentation: 'modal' }} />
        <Stack.Screen name="dns" options={{ presentation: 'modal' }} />
        <Stack.Screen name="downloads" options={{ presentation: 'modal' }} />
      </Stack>
      <UpdateBanner />
    </ThemeProvider>
  );
}

/** Màn hình thay thế khi giao diện bị lỗi lúc render: ghi log và cho thử lại thay vì app trắng màn hình. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    log.crash('react', `Giao diện bị lỗi: ${error.message}`, error.stack);
    SplashScreen.hideAsync().catch(() => {});
  }, [error]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <Txt weight="bold" size={20} style={{ textAlign: 'center' }}>
        Có lỗi xảy ra
      </Txt>
      <Txt size={14} color={colors.textMuted} style={{ marginTop: 8, textAlign: 'center' }}>
        {error.message}
      </Txt>
      <Txt size={13} color={colors.textFaint} style={{ marginTop: 8, textAlign: 'center' }}>
        Lỗi đã được ghi vào Nhật ký (Menu → Nhật ký).
      </Txt>
      <Pressable
        onPress={retry}
        accessibilityRole="button"
        style={{
          marginTop: 24,
          minHeight: 48,
          paddingHorizontal: 28,
          borderRadius: 24,
          backgroundColor: colors.surfaceRaised,
          justifyContent: 'center',
        }}
      >
        <Txt weight="semibold" size={16}>
          Thử lại
        </Txt>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    BeVietnamPro_400Regular,
    BeVietnamPro_500Medium,
    BeVietnamPro_600SemiBold,
    BeVietnamPro_700Bold,
  });

  useEffect(() => {
    if (fontError) log.error('app', 'Không tải được font Be Vietnam Pro', fontError);
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SettingsProvider>
          <StatsProvider>
            <TabsProvider>
              <HistoryProvider>
                <BookmarksProvider>
                  <ReadingProvider>
                    <DownloadsProvider>
                      <RootStack />
                    </DownloadsProvider>
                  </ReadingProvider>
                </BookmarksProvider>
              </HistoryProvider>
            </TabsProvider>
          </StatsProvider>
        </SettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
