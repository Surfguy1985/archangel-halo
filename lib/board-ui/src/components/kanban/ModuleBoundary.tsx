import React from 'react';
import { parseModule } from './moduleSchemas';

/**
 * ModuleBoundary — wrap the three existing module surfaces without rewriting
 * BoardCardModules.tsx.
 *
 *   <ModuleBoundary module={card.module} surface="metrics" links={card.links}>
 *     <ModuleMetrics module={card.module} tint={...} />
 *   </ModuleBoundary>
 *
 * Behavior by parse outcome:
 *   ok      — render children exactly as today (zero visual change)
 *   none    — render nothing (manual / payment_request cards have no module)
 *   unknown — a module type this build has never seen (server shipped a new
 *             one). Render a graceful "update available" card face with the
 *             card's first link instead of a blank strip or a crash. With a
 *             desktop app in the field this WILL happen; design for it.
 *   invalid — known type, malformed payload. Server bug: render nothing in
 *             production, render a loud red box in dev, always console.error.
 *
 * Also a React error boundary: a throw inside any module renderer takes down
 * only that card's module strip, never the whole board. A board that loses one
 * card face is an annoyance; a board that white-screens during an invoice
 * approval is an incident.
 */

type Surface = 'metrics' | 'evidence' | 'decision';

interface ModuleBoundaryProps {
  module: unknown;
  surface: Surface;
  links?: Array<{ label?: string | null; url?: string | null }> | null;
  children: React.ReactNode;
}

const isDev =
  (globalThis as any).process?.env?.NODE_ENV !== 'production';

export function ModuleBoundary({ module, surface, links, children }: ModuleBoundaryProps) {
  const parsed = React.useMemo(() => parseModule(module), [module]);

  if (parsed.status === 'none') return null;

  if (parsed.status === 'unknown') {
    // Only show the fallback once per card, on the card face.
    if (surface !== 'metrics') return null;
    return <UnknownModuleFace href={links?.[0]?.url ?? null} />;
  }

  if (parsed.status === 'invalid') {
    console.error(
      `[board] invalid module payload (type="${parsed.type}", surface=${surface}):`,
      parsed.error,
    );
    if (!isDev) return null;
    return surface === 'metrics' ? <InvalidModuleFace type={parsed.type} /> : null;
  }

  return <CrashShield surface={surface}>{children}</CrashShield>;
}

function UnknownModuleFace({ href }: { href: string | null }) {
  return (
    <div className="mt-[6px] rounded-[9px] border border-black/10 bg-[#fafafa] px-[10px] py-[8px]">
      <div className="text-[8px] font-[800] uppercase tracking-[0.08em] text-[#96948B]">
        Update available
      </div>
      <div className="mt-[2px] text-[12px] font-[700] text-[#101C33]">
        This card needs a newer version of Halo.
      </div>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          className="mt-[4px] inline-block text-[11px] font-[800] text-[#101C33] underline"
        >
          Open in browser
        </a>
      )}
    </div>
  );
}

function InvalidModuleFace({ type }: { type: string | null }) {
  return (
    <div className="mt-[6px] rounded-[9px] border border-red-300 bg-red-50 px-[10px] py-[8px]">
      <div className="text-[10px] font-[800] text-red-800">
        DEV: invalid payload for module "{type}" — see console
      </div>
    </div>
  );
}

interface ShieldState {
  crashed: boolean;
}

class CrashShield extends React.Component<
  { surface: Surface; children: React.ReactNode },
  ShieldState
> {
  state: ShieldState = { crashed: false };

  static getDerivedStateFromError(): ShieldState {
    return { crashed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[board] module renderer crashed (surface=${this.props.surface}):`, error);
  }

  render() {
    if (this.state.crashed) return null;
    return this.props.children;
  }
}
