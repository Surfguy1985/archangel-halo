# Glow & Effects Guide (Premium Standard)

## Philosophy
Glow is a tool for hierarchy and delight, not decoration. Use it to draw the eye to primary actions and to create depth on dark surfaces. Overuse kills the premium feel.

## Recommended Patterns

### 1. Soft Accent Glow (Buttons / Primary CTAs)
```css
/* Tailwind-friendly or CSS variable version */
.btn-primary {
  box-shadow:
    0 0 0 1px rgba(var(--primary-rgb), 0.2),
    0 1px 2px 0 rgba(0,0,0,0.05),
    0 4px 12px -2px rgba(var(--primary-rgb), 0.25),
    0 0 32px -4px rgba(var(--primary-rgb), 0.35);
  transition: box-shadow 200ms ease, transform 200ms ease;
}
.btn-primary:hover {
  box-shadow:
    0 0 0 1px rgba(var(--primary-rgb), 0.3),
    0 4px 16px -2px rgba(var(--primary-rgb), 0.35),
    0 0 48px -4px rgba(var(--primary-rgb), 0.45);
  transform: translateY(-1px);
}
```

### 2. Ambient Card Glow (Dark Mode)
Place a very soft radial gradient behind or as a pseudo-element on elevated cards:
```css
.card-glow::before {
  content: "";
  position: absolute;
  inset: -1px;
  background: radial-gradient(
    600px circle at var(--mouse-x, 50%) var(--mouse-y, 50%),
    rgba(var(--primary-rgb), 0.08),
    transparent 40%
  );
  border-radius: inherit;
  pointer-events: none;
  z-index: 0;
}
```

### 3. Focus Ring with Soft Outer Glow
```css
:focus-visible {
  outline: 2px solid rgb(var(--primary-rgb));
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(var(--primary-rgb), 0.25);
}
```

### 4. Hero / Section Ambient Light
Large, very low-opacity radial gradients at the top or behind key sections create atmosphere without noise.

## Rules
- Never use pure neon (full saturation + high blur + high opacity)
- Always use the brand primary or a single accent for colored glows
- Keep opacity under 0.4 for ambient effects
- Prefer layered box-shadow over filter: drop-shadow when possible (better performance)
- Animate glow intensity on hover/focus, never the color itself abruptly