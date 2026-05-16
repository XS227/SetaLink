import React, { createContext, useContext, useMemo } from 'react';
import { Colors, Typography, Spacing, Radius, Shadow, Animation, Layout } from '../design/tokens';

export interface Theme {
  colors:     typeof Colors;
  typography: typeof Typography;
  spacing:    typeof Spacing;
  radius:     typeof Radius;
  shadow:     typeof Shadow;
  animation:  typeof Animation;
  layout:     typeof Layout;
  isDark:     boolean;
  reducedMotion: boolean;
}

function buildTheme(isDark: boolean, reducedMotion: boolean): Theme {
  return { colors: Colors, typography: Typography, spacing: Spacing,
           radius: Radius, shadow: Shadow, animation: Animation,
           layout: Layout, isDark, reducedMotion };
}

const DEFAULT_THEME = buildTheme(true, false);
const ThemeContext  = createContext<Theme>(DEFAULT_THEME);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // SetaLink is dark-only; isDark is constant until we add light mode
  const theme = useMemo(() => buildTheme(true, false), []);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
