// Service-category palette for the Falkon card face. Kept dependency-free
// (no lucide/react imports) so the palette guard
// (scripts/src/check-card-contrast.ts) can import it directly at runtime.
// White header text readability over these colors is enforced by that guard
// via headerBase() in ./contrast — run `pnpm --filter @workspace/scripts run
// check:card-contrast` after editing.
export const APPLE_CATEGORY_COLORS: Record<string, string> = {
  maintenance: '#007AFF', // Blue
  lease: '#34C759', // Green
  rent: '#FF9500', // Orange
  move: '#5856D6', // Purple
  coordination: '#AF52DE', // Pink
  blank: '#8E8E93', // Gray
  vendor: '#FF2D55', // Red
  billing: '#FF9500', // Orange
  access: '#00C7BE', // Teal
};
