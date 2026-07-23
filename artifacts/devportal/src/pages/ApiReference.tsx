import { Link } from "wouter";
import { ArrowLeft, Terminal } from "lucide-react";
import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
import spec from "@/content/halo-openapi.yaml?raw";
import { FalkonBadge } from "@/components/FalkonBadge";

export default function ApiReference() {
  return (
    <div className="api-reference-wrapper bg-background min-h-screen flex flex-col font-sans selection:bg-primary selection:text-black">
      <div className="sticky top-0 z-50 h-16 flex items-center justify-between px-6 border-b border-border bg-background/95 backdrop-blur-xl">
        <div className="flex items-center gap-6">
          <Link href="/" className="group flex items-center gap-3 text-xs font-mono font-medium text-muted-foreground hover:text-foreground transition-colors uppercase tracking-widest">
            <div className="w-8 h-8 flex items-center justify-center border border-border group-hover:border-primary group-hover:bg-primary group-hover:text-black transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </div>
            Back to Hub
          </Link>
          <div className="w-px h-6 bg-border" />
          <div className="flex items-center gap-3">
            <div className="bg-primary text-black p-1.5">
              <Terminal className="w-4 h-4" strokeWidth={2} />
            </div>
            <span className="font-display font-bold text-sm tracking-[0.2em] uppercase text-foreground">HALO_API</span>
          </div>
        </div>
      </div>
      <div className="flex-1 api-content-override">
        <style>{`
          .api-reference-wrapper {
            --theme-color-1: hsl(222, 47%, 11%); /* Ink text */
            --theme-color-2: hsl(215, 19%, 35%); /* Slate */
            --theme-color-3: hsl(215, 16%, 47%); /* Muted */
            --theme-color-accent: hsl(84, 60%, 32%); /* Dark lime accent for readable links */
            --theme-background-1: hsl(0, 0%, 100%);
            --theme-background-2: hsl(210, 36%, 95%);
            --theme-background-3: hsl(213, 28%, 90%);
            --theme-border-color: hsl(213, 28%, 84%);
            --sidebar-background-1: var(--theme-background-1);
            --sidebar-color-1: var(--theme-color-2);
            --sidebar-color-2: var(--theme-color-3);
          }
          /* Additional overrides to ensure the Scalar UI feels integrated */
          .scalar-app {
            font-family: var(--font-sans), sans-serif !important;
          }
          .scalar-app h1, .scalar-app h2, .scalar-app h3, .scalar-app h4, .scalar-app h5, .scalar-app h6 {
            font-family: var(--font-display), sans-serif !important;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
        `}</style>
        <ApiReferenceReact
          configuration={{
            content: spec,
            hideDarkModeToggle: true,
            theme: "default",
          }}
        />
      </div>
      <footer className="border-t border-white/10 py-8 bg-black">
        <div className="container mx-auto px-6 flex justify-center">
          <FalkonBadge />
        </div>
      </footer>
    </div>
  );
}
