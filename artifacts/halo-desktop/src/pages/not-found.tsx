import { AlertCircle } from "lucide-react";
import { FalkonBadge } from "@/components/FalkonBadge";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background gap-8 px-4">
      <div className="w-full max-w-md border border-border bg-card p-8">
        <div className="flex items-center gap-3 mb-4">
          <span className="flex h-10 w-10 items-center justify-center border border-[color:var(--gold)] text-[color:var(--gold)]">
            <AlertCircle className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-bold text-foreground uppercase tracking-wide">404 — Not Found</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          This page doesn&apos;t exist. Use the sidebar to get back on track.
        </p>
      </div>
      <FalkonBadge />
    </div>
  );
}
