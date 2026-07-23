import React from "react";
import falkonLogo from "@/assets/falkon-logo.png";

export function FalkonBadge({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-xs text-muted-foreground font-medium uppercase tracking-widest">Powered by</span>
      <img src={falkonLogo} alt="Falkon" className="h-4 object-contain brightness-0 dark:invert opacity-70 hover:opacity-100 transition-opacity" />
    </div>
  );
}
