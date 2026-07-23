import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, Home } from "lucide-react";
import { Link } from "wouter";
import { FalkonBadge } from "@/components/FalkonBadge";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background">
      <div className="flex-1 flex items-center justify-center w-full px-4">
        <Card className="w-full max-w-md bg-card border-border shadow-[0_0_30px_rgba(198,242,17,0.05)] overflow-hidden">
          <div className="h-1 w-full bg-primary shadow-[0_0_10px_rgba(198,242,17,0.8)]" />
          <CardContent className="pt-8 pb-8 px-6 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 border border-primary/20 mb-6 relative">
              <div className="absolute inset-0 rounded-full bg-primary/5 animate-ping" />
              <AlertTriangle className="h-8 w-8 text-primary drop-shadow-[0_0_8px_rgba(198,242,17,0.6)]" />
            </div>
            
            <h1 className="font-display text-2xl font-bold text-foreground tracking-tight mb-2">404 — Page Not Found</h1>
            
            <p className="text-sm text-muted-foreground leading-relaxed mb-8 max-w-[280px] mx-auto">
              The page you're looking for doesn't exist or has been moved.
            </p>

            <Link 
              href="/" 
              className="inline-flex items-center justify-center gap-2 h-11 w-full rounded-xl bg-primary text-primary-foreground font-display font-bold text-sm hover:brightness-110 active:scale-[0.98] transition-all shadow-[0_0_15px_rgba(198,242,17,0.3)]"
            >
              <Home className="w-4 h-4" />
              Return Home
            </Link>
          </CardContent>
        </Card>
      </div>
      
      <div className="pb-8 w-full">
        <FalkonBadge />
      </div>
    </div>
  );
}
