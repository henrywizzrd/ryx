import { setAudioModeAsync } from 'expo-audio';

import { log } from './logger';

/**
 * Phát nền: đặt phiên âm thanh của app sang chế độ "phát" (playback) để âm thanh của trang web
 * tiếp tục khi tắt màn hình/chuyển app (Info.plist đã có UIBackgroundModes=audio từ plugin expo-audio).
 * Video có hình thì iOS có thể vẫn dừng khi app ra nền; dùng nút PiP để xem tiếp trong khung nổi.
 */
export async function applyBackgroundPlay(on: boolean) {
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: on,
      interruptionMode: 'doNotMix',
    });
  } catch (e) {
    log.warn('media', 'Không đặt được chế độ phát nền', e);
  }
}
