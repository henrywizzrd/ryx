import Ionicons from '@expo/vector-icons/Ionicons';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

/**
 * Bản dự phòng ngoài iOS/Android: biểu tượng tĩnh.
 * (lottie-react-native trên web cần thêm thư viện riêng, nên bản web không nạp nó.)
 */
export function ShieldAnim({ style }: { playKey: number; style?: StyleProp<ViewStyle> }) {
  const { accent } = useTheme();
  return (
    <View style={[style, { alignItems: 'center', justifyContent: 'center' }]}>
      <Ionicons name="shield-checkmark" size={26} color={accent} />
    </View>
  );
}
