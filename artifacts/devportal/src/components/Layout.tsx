import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { Search, Menu, Command, Code2, BookOpen, ChevronRight, X } from "lucide-react";
import { docs } from "@/content/registry";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Command as CommandPrimitive, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";

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
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="bg-primary text-primary-foreground p-1.5 rounded-md group-hover:bg-primary/90 transition-colors">
                <Code2 className="w-5 h-5" />
              </div>
              <span className="font-display font-semibold text-lg tracking-tight">HALO Developer</span>
            </Link>
            
            <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-muted-foreground">
              <Link href="/" className={location === "/" ? "text-foreground" : "hover:text-foreground transition-colors"}>Home</Link>
              <Link href={docs.length > 0 ? `/docs/${docs[0].slug}` : "/"} className={location.startsWith("/docs") ? "text-foreground" : "hover:text-foreground transition-colors"}>Documentation</Link>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={() => setSearchOpen(true)}
              className="hidden md:flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground bg-muted/30 border rounded-full hover:bg-muted/50 transition-colors w-64"
            >
              <Search className="w-4 h-4" />
              <span className="flex-1 text-left">Search documentation...</span>
              <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100">
                <span className="text-xs">⌘</span>K
              </kbd>
            </button>
            <button 
              className="md:hidden p-2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="w-5 h-5" />
            </button>
            <button 
              className="md:hidden p-2 text-muted-foreground hover:text-foreground"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex container mx-auto px-4">
        {/* Sidebar Navigation */}
        <aside className="hidden md:block w-64 shrink-0 py-8 pr-6 border-r">
          <div className="sticky top-24 space-y-8">
            {Object.entries(groupedDocs).map(([category, items]) => (
              <div key={category}>
                <h4 className="font-display font-medium text-sm text-foreground mb-3">{category}</h4>
                <div className="flex flex-col gap-1 border-l ml-2">
                  {items.map(doc => {
                    const isActive = location === `/docs/${doc.slug}`;
                    return (
                      <Link 
                        key={doc.slug} 
                        href={`/docs/${doc.slug}`}
                        className={`pl-4 py-1.5 text-sm transition-colors border-l -ml-[1px] ${
                          isActive 
                            ? "border-primary text-primary font-medium" 
                            : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
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
        <main className="flex-1 min-w-0 py-8 md:pl-8">
          {children}
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t py-12 mt-12 bg-muted/10">
        <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Code2 className="w-4 h-4" />
            <span className="text-sm">HALO Developer Portal</span>
          </div>
          <span className="text-sm text-muted-foreground">Archangel Operations Platform</span>
        </div>
      </footer>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 bg-background md:hidden flex flex-col">
          <div className="h-16 flex items-center justify-between px-4 border-b">
            <span className="font-display font-semibold">Menu</span>
            <button onClick={() => setMobileMenuOpen(false)} className="p-2 text-muted-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-6">
            <nav className="flex flex-col gap-4 text-lg font-medium">
              <Link href="/" onClick={() => setMobileMenuOpen(false)}>Home</Link>
            </nav>
            {Object.entries(groupedDocs).map(([category, items]) => (
              <div key={category}>
                <h4 className="font-display font-medium text-sm text-muted-foreground mb-3">{category}</h4>
                <div className="flex flex-col gap-3">
                  {items.map(doc => (
                    <Link 
                      key={doc.slug} 
                      href={`/docs/${doc.slug}`}
                      onClick={() => setMobileMenuOpen(false)}
                      className="text-foreground"
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
        <DialogContent className="p-0 overflow-hidden max-w-2xl sm:rounded-xl">
          <DialogTitle className="sr-only">Search Documentation</DialogTitle>
          <CommandPrimitive className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
            <CommandInput placeholder="Search documentation..." />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
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
                      className="flex items-center gap-3 cursor-pointer"
                    >
                      <BookOpen className="w-4 h-4 text-muted-foreground" />
                      <div className="flex flex-col">
                        <span className="font-medium">{doc.title}</span>
                        <span className="text-xs text-muted-foreground line-clamp-1">{doc.description}</span>
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
