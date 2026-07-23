import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { Search, Menu, Command, Code2, BookOpen, ChevronRight, X, Terminal } from "lucide-react";
import { docs } from "@/content/registry";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Command as CommandPrimitive, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { FalkonBadge } from "./FalkonBadge";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Group docs by category
  const groupedDocs = docs.reduce((acc, doc) => {
    if (!acc[doc.category]) acc[doc.category] = [];
    acc[doc.category].push(doc);
    return acc;
  }, {} as Record<string, typeof docs>);

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans selection:bg-primary selection:text-primary-foreground">
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="container mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-10">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="bg-primary text-primary-foreground p-2 relative overflow-hidden group-hover:scale-105 transition-transform duration-300">
                <Terminal className="w-6 h-6 relative z-10" strokeWidth={1.5} />
                <div className="absolute inset-0 bg-black/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              </div>
              <span className="font-display font-bold text-xl tracking-[0.2em] uppercase text-foreground group-hover:text-primary transition-colors">HALO</span>
            </Link>
            
            <nav className="hidden md:flex items-center gap-8 text-sm font-medium tracking-widest uppercase">
              <Link href="/" className={location === "/" ? "text-primary font-bold" : "text-muted-foreground hover:text-foreground transition-colors"}>Home</Link>
              <Link href={docs.length > 0 ? `/docs/${docs[0].slug}` : "/"} className={location.startsWith("/docs") ? "text-primary font-bold" : "text-muted-foreground hover:text-foreground transition-colors"}>Docs</Link>
              <Link href="/api-reference" className="text-muted-foreground hover:text-foreground transition-colors">API</Link>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={() => setSearchOpen(true)}
              className="hidden md:flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground bg-muted border border-border hover:bg-muted/80 hover:border-primary/50 transition-all w-72 group"
            >
              <Search className="w-4 h-4 group-hover:text-primary transition-colors" />
              <span className="flex-1 text-left font-mono text-xs uppercase tracking-wider">Search...</span>
              <kbd className="pointer-events-none inline-flex h-6 select-none items-center gap-1 bg-background px-2 font-mono text-[10px] font-medium text-foreground border border-border">
                <span>⌘</span>K
              </kbd>
            </button>
            <button 
              className="md:hidden p-2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="w-6 h-6" />
            </button>
            <button 
              className="md:hidden p-2 text-muted-foreground hover:text-foreground"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>
        </div>
        {/* Neon accent line */}
        <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-primary to-transparent opacity-30" />
      </header>

      <div className="flex-1 flex container mx-auto px-6">
        {/* Sidebar Navigation */}
        <aside className="hidden md:block w-72 shrink-0 py-12 pr-8 border-r border-border relative">
          <div className="sticky top-32 space-y-12">
            {Object.entries(groupedDocs).map(([category, items]) => (
              <div key={category}>
                <h4 className="font-display font-semibold text-xs tracking-[0.2em] uppercase text-muted-foreground mb-6">{category}</h4>
                <div className="flex flex-col gap-1 border-l border-border ml-2">
                  {items.map(doc => {
                    const isActive = location === `/docs/${doc.slug}`;
                    return (
                      <Link 
                        key={doc.slug} 
                        href={`/docs/${doc.slug}`}
                        className={`pl-5 py-2 text-sm transition-all border-l-2 -ml-[1px] font-mono ${
                          isActive 
                            ? "border-primary text-primary bg-primary/5 font-bold" 
                            : "border-transparent text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/50"
                        }`}
                      >
                        {doc.title}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0 py-12 md:pl-16">
          {children}
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-primary/20 py-12 mt-24 bg-[#0a0f1a] relative overflow-hidden text-white">
        <div className="absolute top-0 left-1/4 w-1/2 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
        <div className="container mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-primary" strokeWidth={1.5} />
            <span className="font-display font-bold tracking-widest uppercase text-sm">HALO DEV</span>
          </div>
          <FalkonBadge />
        </div>
      </footer>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-xl md:hidden flex flex-col border-b border-primary">
          <div className="h-20 flex items-center justify-between px-6 border-b border-border">
            <span className="font-display font-bold tracking-widest uppercase text-primary">Menu</span>
            <button onClick={() => setMobileMenuOpen(false)} className="p-2 text-foreground hover:text-primary transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-6 space-y-10">
            <nav className="flex flex-col gap-6 text-xl font-display uppercase tracking-widest font-semibold">
              <Link href="/" onClick={() => setMobileMenuOpen(false)} className="hover:text-primary transition-colors">Home</Link>
              <Link href="/api-reference" onClick={() => setMobileMenuOpen(false)} className="hover:text-primary transition-colors">API Reference</Link>
            </nav>
            {Object.entries(groupedDocs).map(([category, items]) => (
              <div key={category}>
                <h4 className="font-display font-bold text-xs text-muted-foreground mb-4 tracking-[0.2em] uppercase">{category}</h4>
                <div className="flex flex-col gap-4 font-mono text-sm">
                  {items.map(doc => (
                    <Link 
                      key={doc.slug} 
                      href={`/docs/${doc.slug}`}
                      onClick={() => setMobileMenuOpen(false)}
                      className="text-muted-foreground hover:text-primary transition-colors"
                    >
                      {doc.title}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search Dialog */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="p-0 overflow-hidden max-w-2xl bg-popover border-border sm:rounded-none shadow-2xl shadow-primary/10">
          <DialogTitle className="sr-only">Search Documentation</DialogTitle>
          <CommandPrimitive className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-primary/70 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input-wrapper]_svg]:text-primary [&_[cmdk-input]]:h-14 [&_[cmdk-input]]:font-mono [&_[cmdk-item]]:px-4 [&_[cmdk-item]]:py-4 [&_[cmdk-item]]:rounded-none [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
            <CommandInput placeholder="SEARCH DIRECTORY..." className="border-b border-border" />
            <CommandList className="max-h-[60vh]">
              <CommandEmpty className="py-12 text-center font-mono text-sm text-muted-foreground uppercase tracking-widest">No matching records found.</CommandEmpty>
              {Object.entries(groupedDocs).map(([category, items]) => (
                <CommandGroup key={category} heading={category}>
                  {items.map(doc => (
                    <CommandItem 
                      key={doc.slug} 
                      value={doc.title}
                      onSelect={() => {
                        setSearchOpen(false);
                        setLocation(`/docs/${doc.slug}`);
                      }}
                      className="flex items-center gap-4 cursor-pointer data-[selected=true]:bg-muted data-[selected=true]:text-foreground group transition-colors"
                    >
                      <div className="w-8 h-8 flex items-center justify-center bg-background border border-border group-data-[selected=true]:border-primary group-data-[selected=true]:text-primary transition-colors">
                        <BookOpen className="w-4 h-4" />
                      </div>
                      <div className="flex flex-col">
                        <span className="font-mono text-sm font-semibold tracking-wide">{doc.title}</span>
                        <span className="text-xs text-muted-foreground line-clamp-1 mt-1 font-sans">{doc.description}</span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </CommandPrimitive>
        </DialogContent>
      </Dialog>
    </div>
  );
}
