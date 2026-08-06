# Layout, Spacing & Typography Guardrails

## Spacing Scale (Mandatory)
Use an 8px base system (or 4px for fine control):

| Token   | Value | Tailwind example |
|---------|-------|------------------|
| space-1 | 4px   | p-1, gap-1       |
| space-2 | 8px   | p-2, gap-2       |
| space-3 | 12px  | p-3              |
| space-4 | 16px  | p-4, gap-4       |
| space-6 | 24px  | p-6, gap-6       |
| space-8 | 32px  | p-8              |
| space-12| 48px  | p-12             |
| space-16| 64px  | p-16             |

Never mix arbitrary pixel values. If the project uses Tailwind, extend the theme instead of using arbitrary values repeatedly.

## Vertical Rhythm
- Related items (label + input, title + description): tighter gap (space-2 or space-3)
- Sections: larger separation (space-12 to space-16+)
- Cards inside a grid: consistent internal padding (usually space-6 or space-8)

## Typography Rules
1. Establish a clear scale (at minimum):
   - Display / Hero
   - H1
   - H2
   - H3
   - Body
   - Small / Caption
2. Prefer variable fonts or high-quality geometric/humanist sans.
3. Line length for body text: ideally 45–75 characters.
4. Use `text-balance` or careful wrapping on headings.
5. Never rely on font-weight alone for hierarchy — size + weight + color + spacing.

## Layout Patterns to Prefer
- Single main column with clear max-width for content-heavy pages
- Bento or asymmetric grids only when the content truly benefits
- Sticky headers that don’t fight the content
- Consistent horizontal padding that scales with viewport (px-4 → px-6 → px-8)

## Mobile
- Minimum touch target 44×44px
- Stack elements cleanly; avoid horizontal scroll
- Reduce font sizes slightly but keep hierarchy intact
- Test critical paths at 375px width