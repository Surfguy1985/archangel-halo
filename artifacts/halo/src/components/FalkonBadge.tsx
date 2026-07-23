import { cn } from "@/lib/utils";
import falkonLogo from "@/assets/falkon-logo.png";

export function FalkonBadge({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-8 pb-12 opacity-60", className)}>
      <span className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground mb-2">Powered by</span>
      <img src={falkonLogo} alt="Falkon" className="h-4 object-contain brightness-0 invert" />
    </div>
  );
}
