import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/theme';
import { Txt } from './txt';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface Props {
  icon: IconName;
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  size?: number;
  iconSize?: number;
  color?: string;
  badge?: number;
  badgeColor?: string;
  style?: StyleProp<ViewStyle>;
}

/** Nút biểu tượng ≥44pt với nhãn trợ năng và phản hồi khi nhấn. */
export function IconButton({
  icon,
  label,
  onPress,
  onLongPress,
  disabled,
  size = 44,
  iconSize = 22,
  color = colors.text,
  badge,
  badgeColor,
  style,
}: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [
        styles.base,
        { width: size, height: size, borderRadius: size / 2 },
        pressed && styles.pressed,
        style,
      ]}
    >
      <Ionicons name={icon} size={iconSize} color={disabled ? colors.textFaint : color} />
      {badge !== undefined && badge > 0 && (
        <View style={[styles.badge, { backgroundColor: badgeColor ?? colors.surfaceRaised }]}>
          <Txt weight="bold" size={10} color="#05140E" style={{ lineHeight: 13 }}>
            {badge > 99 ? '99+' : badge}
          </Txt>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: 'rgba(255,255,255,0.10)', transform: [{ scale: 0.94 }] },
  badge: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
