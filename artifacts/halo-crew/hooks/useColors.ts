import { useColorScheme } from 'react-native';
import colorsData from '@/constants/colors';

const { radius, dark, light } = colorsData as typeof colorsData & { dark?: typeof colorsData.light; radius: number };

/**
 * Returns the design tokens for the current color scheme.
 * Always dark for the HALO Crew app — forces dark palette.
 */
export function useColors() {
  const scheme = useColorScheme();
  const palette = (scheme === 'dark' && dark) ? dark : light;
  return { ...palette, radius };
}
