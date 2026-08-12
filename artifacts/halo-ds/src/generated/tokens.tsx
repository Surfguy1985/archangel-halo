/* GENERATED FROM tokens.json -- DO NOT EDIT. Run scripts/build-tokens.mjs. */
// Portable design tokens (colors as hex). Web consumes the theme via
// src/index.css; mobile (Expo) and any other platform import this object so the
// whole product shares one source of truth.
export const tokens = {
  "color": {
    "light": {
      "background": "#F4F7F9",
      "foreground": "#07101E",
      "card": "#FFFFFF",
      "cardForeground": "#07101E",
      "popover": "#FFFFFF",
      "popoverForeground": "#07101E",
      "primary": "#B4FF44",
      "primaryForeground": "#000000",
      "secondary": "#13223A",
      "secondaryForeground": "#FFFFFF",
      "muted": "#EBF0F6",
      "mutedForeground": "#435A7D",
      "accent": "#F0FAE0",
      "accentForeground": "#557F0D",
      "destructive": "#E11D48",
      "destructiveForeground": "#FFFFFF",
      "border": "#DDE7F2",
      "input": "#DDE7F2",
      "ring": "#6D9B12",
      "chart1": "#EA580C",
      "chart2": "#CA8A04",
      "chart3": "#15803D",
      "chart4": "#2563EB",
      "chart5": "#7C3AED",
      "sidebar": "#07101E",
      "sidebarForeground": "#F4F7F9",
      "sidebarBorder": "#1B2D45",
      "sidebarPrimary": "#B4FF44",
      "sidebarPrimaryForeground": "#000000",
      "sidebarAccent": "#13223A",
      "sidebarAccentForeground": "#B4FF44",
      "sidebarRing": "#B4FF44"
    },
    "dark": {
      "background": "#041029",
      "foreground": "#F4F7F9",
      "card": "#07101E",
      "cardForeground": "#F4F7F9",
      "popover": "#0D1E33",
      "popoverForeground": "#F4F7F9",
      "primary": "#B4FF44",
      "primaryForeground": "#000000",
      "secondary": "#0A1930",
      "secondaryForeground": "#F4F7F9",
      "muted": "#13223A",
      "mutedForeground": "#8CA0B9",
      "accent": "#172C0A",
      "accentForeground": "#B4FF44",
      "destructive": "#E11D48",
      "destructiveForeground": "#FFFFFF",
      "border": "#1A2E45",
      "input": "#1A2E45",
      "ring": "#B4FF44",
      "chart1": "#F97316",
      "chart2": "#EAB308",
      "chart3": "#22C55E",
      "chart4": "#3B82F6",
      "chart5": "#8B5CF6",
      "sidebar": "#041029",
      "sidebarForeground": "#F4F7F9",
      "sidebarBorder": "#0A1930",
      "sidebarPrimary": "#B4FF44",
      "sidebarPrimaryForeground": "#000000",
      "sidebarAccent": "#13223A",
      "sidebarAccentForeground": "#B4FF44",
      "sidebarRing": "#B4FF44"
    }
  },
  "fontFamily": {
    "sans": [
      "Plus Jakarta Sans",
      "system-ui",
      "sans-serif"
    ],
    "serif": [
      "Outfit",
      "sans-serif"
    ],
    "mono": [
      "ui-monospace",
      "SF Mono",
      "Menlo",
      "Consolas",
      "monospace"
    ]
  },
  "radius": "0.875rem",
  "spacing": "0.25rem"
} as const;

export type Tokens = typeof tokens;
export default tokens;
