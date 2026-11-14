import { Text, type TextProps } from 'react-native';

import { fonts, useTheme } from '@/theme';

type Weight = keyof typeof fonts;

interface Props extends TextProps {
  weight?: Weight;
  size?: number;
  color?: string;
}

export function Txt({ weight = 'regular', size = 16, color, style, ...rest }: Props) {
  const { colors } = useTheme();
  return (
    <Text
      {...rest}
      style={[
        { fontFamily: fonts[weight], fontSize: size, color: color ?? colors.text, lineHeight: Math.round(size * 1.35) },
        style,
      ]}
    />
  );
}
