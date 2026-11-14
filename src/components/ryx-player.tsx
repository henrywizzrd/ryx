import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { usePlayer } from '@/lib/player-store';
import { fonts } from '@/theme';
import { Txt } from './txt';

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const HIDE_MS = 3000;
const EASE = Easing.out(Easing.cubic);

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? h + ':' : ''}${mm}:${String(ss).padStart(2, '0')}`;
};

/** Nút tròn kính tối (trình phát luôn tối, không theo giao diện app) */
function Round({
  size,
  icon,
  iconSize,
  label,
  onPress,
  style,
  children,
}: {
  size: number;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  iconSize?: number;
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [
        styles.round,
        { width: size, height: size, borderRadius: size / 2 },
        pressed && { transform: [{ scale: 0.94 }] },
        style,
      ]}
    >
      <BlurView tint="systemChromeMaterialDark" intensity={60} style={StyleSheet.absoluteFill} />
      {icon ? <Ionicons name={icon} size={iconSize ?? size * 0.42} color="#fff" /> : children}
    </Pressable>
  );
}

/**
 * Trình phát toàn màn hình của Ryx: video vẫn chạy trong trang (phủ kín màn hình), lớp này vẽ nút điều khiển và
 * gửi lệnh vào trang (window.__ryxFs trong lib/inject). Chạm để hiện/ẩn nút, chạm 2 lần nửa trái/phải để tua ±10 s,
 * kéo thanh tua để tua, vuốt xuống để thoát, khoá để chặn chạm nhầm.
 */
export function RyxPlayer({ onCmd }: { onCmd: (js: string) => void }) {
  const p = usePlayer();
  const insets = useSafeAreaInsets();
  const [shown, setShown] = useState(true);
  const [locked, setLocked] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [skipHint, setSkipHint] = useState<{ side: 'l' | 'r'; n: number } | null>(null);
  // Chạm vào nút: đếm lại 3 s trước khi tự ẩn
  const [pokeN, setPokeN] = useState(0);
  const [trackW, setTrackW] = useState(1);
  const [screenW, setScreenW] = useState(1);

  const cmd = (body: string) => onCmd(`window.__ryxFs && window.__ryxFs.${body}; true;`);

  // Đang phát: nút tự ẩn sau 3 s không chạm
  const poke = () => setPokeN((n) => n + 1);
  useEffect(() => {
    if (!p.playing || !shown || scrub !== null) return;
    const t = setTimeout(() => setShown(false), HIDE_MS);
    return () => clearTimeout(t);
  }, [p.playing, shown, scrub, pokeN]);
  // Chữ "10 giây" sau khi tua tự tắt
  useEffect(() => {
    if (!skipHint) return;
    const t = setTimeout(() => setSkipHint(null), 700);
    return () => clearTimeout(t);
  }, [skipHint]);

  const skip = (side: 'l' | 'r') => {
    void Haptics.selectionAsync();
    cmd(`skip(${side === 'l' ? -10 : 10})`);
    setSkipHint((h) => ({ side, n: h && h.side === side ? h.n + 10 : 10 }));
  };

  // Vuốt xuống để thoát: khung nút trượt theo tay
  const dragY = useSharedValue(0);
  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(0, dragY.get()) }],
    opacity: 1 - Math.min(0.6, Math.max(0, dragY.get()) / 300),
  }));
  const exit = () => cmd('exit()');

  const single = Gesture.Tap()
    .maxDuration(250)
    .onEnd(() => {
      scheduleOnRN(toggleShown);
    });
  const double = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd((e) => {
      scheduleOnRN(doubleAt, e.absoluteX);
    });
  const pan = Gesture.Pan()
    .activeOffsetY(14)
    .failOffsetX([-30, 30])
    .onUpdate((e) => {
      dragY.set(e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 110 || e.velocityY > 900) scheduleOnRN(exit);
      dragY.set(withTiming(0, { duration: 260, easing: EASE }));
    });
  function toggleShown() {
    if (locked) {
      setShown((v) => !v);
      return;
    }
    setShown((v) => !v);
  }
  function doubleAt(x: number) {
    if (locked) return;
    skip(x < screenW / 2 ? 'l' : 'r');
  }
  const gesture = locked ? Gesture.Exclusive(single) : Gesture.Race(pan, Gesture.Exclusive(double, single));

  // Thanh tua: kéo để chọn giây, thả ra mới tua
  const seekFromX = (x: number) => Math.max(0, Math.min(1, x / trackW)) * (p.d || 0);
  const seekPan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      scheduleOnRN(setScrubX, e.x);
    })
    .onUpdate((e) => {
      scheduleOnRN(setScrubX, e.x);
    })
    .onFinalize((e) => {
      scheduleOnRN(endScrub, e.x);
    });
  function setScrubX(x: number) {
    setScrub(seekFromX(x));
  }
  function endScrub(x: number) {
    const t = seekFromX(x);
    cmd(`seek(${t.toFixed(2)})`);
    setScrub(null);
    poke();
  }

  const cur = scrub ?? p.t;
  const frac = p.d > 0 ? Math.min(1, cur / p.d) : 0;
  const buf = p.d > 0 ? Math.min(1, p.buffered / p.d) : 0;
  const rateIdx = RATES.indexOf(p.rate);
  const nextRate = RATES[(rateIdx < 0 ? 2 : rateIdx + 1) % RATES.length];
  const side = { paddingLeft: Math.max(insets.left, 16), paddingRight: Math.max(insets.right, 16) };

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={StyleSheet.absoluteFill}
        onLayout={(e) => {
          setScreenW(e.nativeEvent.layout.width);
        }}
      >
        {skipHint && (
          <Animated.View
            entering={FadeIn.duration(120)}
            exiting={FadeOut.duration(200)}
            pointerEvents="none"
            style={[styles.skipHint, skipHint.side === 'l' ? { left: '12%' } : { right: '12%' }]}
          >
            <Ionicons name={skipHint.side === 'l' ? 'play-back' : 'play-forward'} size={22} color="#fff" />
            <Txt weight="semibold" size={14} color="#fff">
              {skipHint.n} giây
            </Txt>
          </Animated.View>
        )}

        {shown && (
          <Animated.View
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(220)}
            style={[StyleSheet.absoluteFill, dragStyle]}
            pointerEvents="box-none"
          >
            {locked ? (
              <View style={[styles.lockOnly, { top: insets.top + 12 }]} pointerEvents="box-none">
                <Round size={48} icon="lock-closed" label="Mở khoá" onPress={() => setLocked(false)} />
              </View>
            ) : (
              <>
                <View style={styles.dim} pointerEvents="none" />
                {/* Trên: đóng, PiP, khoá | tốc độ */}
                <View style={[styles.topRow, side, { top: insets.top + 8 }]} pointerEvents="box-none">
                  <View style={styles.group}>
                    <Round size={48} icon="close" label="Thoát toàn màn hình" onPress={exit} />
                    <Round size={48} icon="albums-outline" label="Hình trong hình" onPress={() => cmd('pip()')} />
                    <Round
                      size={48}
                      icon="lock-open-outline"
                      label="Khoá màn hình"
                      onPress={() => {
                        setLocked(true);
                        setShown(false);
                      }}
                    />
                  </View>
                  <Round
                    size={48}
                    label={`Tốc độ ${p.rate}x, chạm để đổi`}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      cmd(`rate(${nextRate})`);
                      poke();
                    }}
                  >
                    <Txt weight="semibold" size={14} color="#fff">
                      {`${p.rate}x`}
                    </Txt>
                  </Round>
                </View>

                {/* Giữa: lùi 10, phát/dừng, tới 10 */}
                <View style={styles.center} pointerEvents="box-none">
                  <Round size={60} icon="play-back" iconSize={24} label="Lùi 10 giây" onPress={() => skip('l')} />
                  <Round
                    size={80}
                    icon={p.playing ? 'pause' : 'play'}
                    iconSize={36}
                    label={p.playing ? 'Dừng' : 'Phát'}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      cmd('toggle()');
                      poke();
                    }}
                  />
                  <Round size={60} icon="play-forward" iconSize={24} label="Tới 10 giây" onPress={() => skip('r')} />
                </View>

                {/* Dưới: thời gian + thanh tua */}
                <View style={[styles.bottom, side, { bottom: Math.max(insets.bottom, 12) + 8 }]}>
                  <View style={styles.bar}>
                    <BlurView tint="systemChromeMaterialDark" intensity={60} style={StyleSheet.absoluteFill} />
                    <Txt size={13} color="#fff" style={styles.time}>
                      {fmt(cur)}
                    </Txt>
                    <GestureDetector gesture={seekPan}>
                      <View
                        style={styles.trackHit}
                        onLayout={(e) => {
                          setTrackW(Math.max(1, e.nativeEvent.layout.width));
                        }}
                        accessibilityRole="adjustable"
                        accessibilityLabel={`Đang ở ${fmt(cur)} trên ${fmt(p.d)}`}
                      >
                        <View style={styles.track}>
                          <View style={[styles.buf, { width: `${buf * 100}%` }]} />
                          <View style={[styles.fill, { width: `${frac * 100}%` }]} />
                        </View>
                        <View style={[styles.knob, { left: `${frac * 100}%` }, scrub !== null && styles.knobBig]} />
                      </View>
                    </GestureDetector>
                    <Txt size={13} color="#fff" style={styles.time}>
                      {`-${fmt(Math.max(0, p.d - cur))}`}
                    </Txt>
                  </View>
                </View>
              </>
            )}
          </Animated.View>
        )}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  round: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(30,30,30,0.35)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  dim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.28)' },
  topRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between' },
  group: { flexDirection: 'row', gap: 12 },
  lockOnly: { position: 'absolute', left: 16 },
  center: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 36,
  },
  bottom: { position: 'absolute', left: 0, right: 0 },
  bar: {
    height: 52,
    borderRadius: 26,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    gap: 12,
    backgroundColor: 'rgba(30,30,30,0.35)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  time: { fontFamily: fonts.medium, fontVariant: ['tabular-nums'], minWidth: 44, textAlign: 'center' },
  trackHit: { flex: 1, height: 40, justifyContent: 'center' },
  track: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  buf: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.35)' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#fff' },
  knob: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    marginLeft: -7,
    backgroundColor: '#fff',
  },
  knobBig: { width: 22, height: 22, borderRadius: 11, marginLeft: -11 },
  skipHint: {
    position: 'absolute',
    top: '46%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
});
