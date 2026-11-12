import { Text, type TextProps } from 'react-native';

import { colors, fonts } from '@/theme';

type Weight = keyof typeof fonts;

interface Props extends TextProps {
  weight?: Weight;
  size?: number;
  color?: string;
}

export function Txt({ weight = 'regular', size = 16, color = colors.text, style, ...rest }: Props) {
  return (
    <Text
      {...rest}
      style={[{ fontFamily: fonts[weight], fontSize: size, color, lineHeight: Math.round(size * 1.35) }, style]}
    />
  );
}
