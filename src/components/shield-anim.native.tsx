import LottieView from 'lottie-react-native';
import type { StyleProp, ViewStyle } from 'react-native';

const SHIELD_ANIM = require('../../assets/lottie/shield-block.json');

/** Hiệu ứng khiên bật lên (Lottie) khi Shield vừa chặn một thứ gì đó. */
export function ShieldAnim({ playKey, style }: { playKey: number; style?: StyleProp<ViewStyle> }) {
  return <LottieView key={playKey} source={SHIELD_ANIM} autoPlay loop={false} style={style} />;
}
