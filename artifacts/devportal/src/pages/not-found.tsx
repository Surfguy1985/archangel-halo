import { Terminal } from "lucide-react";
import { Link } from "wouter";
import { FalkonBadge } from "@/components/FalkonBadge";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex flex-col bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-2xl w-full border border-border bg-card p-12 relative overflow-hidden text-center">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]" />
          
          <Terminal className="w-20 h-20 text-primary mx-auto mb-8 relative z-10" strokeWidth={1} />
          
          <h1 className="text-5xl md:text-7xl font-display font-bold text-foreground mb-6 uppercase tracking-tighter relative z-10">
            System_<span className="text-primary">Error</span>
          </h1>

          <div className="inline-block border border-primary/30 bg-muted px-6 py-2 mb-10 relative z-10">
            <p className="font-mono text-primary font-bold text-sm tracking-widest uppercase">
              ERR_CODE: 404_PAGE_NOT_FOUND
            </p>
          </div>
          
          <p className="text-muted-foreground font-sans text-lg mb-12 max-w-lg mx-auto relative z-10 leading-relaxed">
            The requested module could not be located in the directory registry. It may have been relocated or purged.
          </p>

          <Link href="/" className="inline-flex items-center justify-center h-14 px-10 bg-primary text-primary-foreground font-display font-bold uppercase tracking-widest hover:bg-primary/90 transition-all relative z-10 shadow-lg shadow-primary/20">
            Return to Hub
          </Link>
        </div>
      </div>
      
      <footer className="border-t border-primary/20 py-12 bg-[#0a0f1a] relative overflow-hidden text-white mt-auto">
        <div className="absolute top-0 left-1/4 w-1/2 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
        <div className="container mx-auto px-6 flex justify-center">
          <FalkonBadge />
        </div>
      </footer>
    </div>
  );
}
