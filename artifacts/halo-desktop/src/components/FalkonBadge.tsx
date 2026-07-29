import falkonLogo from "@/assets/falkon-logo.png";

export function FalkonBadge({ className = ""}: { className?: string}) {
  return (
    <div className={`flex items-center justify-center gap-2 py-4 opacity-50 hover:opacity-100 transition-opacity ${className}`}>
      <span className="text-xs text-muted-foreground font-display">Powered by</span>
      <img src={falkonLogo} alt="Falkon" className="h-4 w-auto filter grayscale invert" />
    </div>
  );
}
