import { BlurView } from 'expo-blur';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, useTheme } from '@/theme';

interface Props {
  radius: number;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  shadow?: boolean;
  children?: React.ReactNode;
}

/**
 * Bề mặt kính kiểu Liquid Glass: làm mờ nền + lớp phủ tối + viền sáng mảnh + ánh sáng mép trên.
 */
export function Glass({ radius, style, contentStyle, shadow = true, children }: Props) {
  const { glass } = useTheme();
  return (
    <View style={[shadow && styles.shadow, { borderRadius: radius }, style]}>
      <View style={[styles.clip, { borderRadius: radius }]}>
        <BlurView tint="systemChromeMaterialDark" intensity={glass.intensity} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(${colors.glassTint},${glass.overlay})` }]} />
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.highlight, { borderRadius: radius }]}
        />
        <View style={[styles.content, contentStyle]}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  clip: {
    flexGrow: 1,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  highlight: {
    borderTopWidth: 1,
    borderColor: colors.glassHighlight,
  },
  content: { flexGrow: 1 },
});
