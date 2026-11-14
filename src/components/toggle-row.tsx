import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Switch, View } from 'react-native';

import { useTheme, useStyles, type Palette } from '@/theme';
import type { IconName } from './icon-button';
import { Txt } from './txt';

interface Props {
  icon: IconName;
  iconColor?: string;
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}

export function ToggleRow({ icon, iconColor, title, subtitle, value, onChange, last }: Props) {
  const styles = useStyles(makeStyles);

  const { accent, colors, fg } = useTheme();
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <View style={[styles.icon, { backgroundColor: fg(0.07) }]}>
        <Ionicons name={icon} size={18} color={iconColor ?? accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt weight="medium" size={15}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt size={13} color={colors.textMuted}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: accent, false: fg(0.18) }}
        ios_backgroundColor={fg(0.18)}
        accessibilityLabel={title}
      />
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8 },
    divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    icon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  });
