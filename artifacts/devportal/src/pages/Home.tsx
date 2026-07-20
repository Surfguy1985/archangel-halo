import React from "react";
import { Link } from "wouter";
import { docs } from "@/content/registry";
import { ArrowRight, Book, Zap, ShieldCheck } from "lucide-react";

export default function Home() {
  const groupedDocs = docs.reduce((acc, doc) => {
    if (!acc[doc.category]) acc[doc.category] = [];
    acc[doc.category].push(doc);
    return acc;
  }, {} as Record<string, typeof docs>);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 space-y-16 pb-12">
      {/* Hero Section */}
      <section className="relative rounded-3xl overflow-hidden bg-zinc-950 text-white p-10 md:p-16 shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-transparent opacity-50" />
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-primary/20 blur-3xl rounded-full pointer-events-none" />
        
        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-sm font-medium mb-6">
            <span className="flex w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Platform v2.4 Live
          </div>
          <h1 className="text-4xl md:text-6xl font-display font-semibold tracking-tight mb-6 leading-tight">
            Build operational <br/>
            <span className="text-primary-foreground">superpowers.</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-400 mb-10 max-w-2xl leading-relaxed">
            Integrate with HALO's core billing, scheduling, and dispatch engines.
            The official developer documentation for the Archangel platform.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href={docs.length > 0 ? `/docs/${docs[0].slug}` : "/"} className="inline-flex items-center justify-center h-12 px-6 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 gap-2">
              Read the Docs <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="grid md:grid-cols-3 gap-8">
        <div className="space-y-3 p-6 rounded-2xl bg-card border shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-5">
            <Zap className="w-5 h-5" />
          </div>
          <h3 className="font-display font-semibold text-lg">Real-time webhooks</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">Subscribe to operational events in real-time. Sync job status, invoice payments, and dispatch arrivals to your external systems.</p>
        </div>
        <div className="space-y-3 p-6 rounded-2xl bg-card border shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-5">
            <Book className="w-5 h-5" />
          </div>
          <h3 className="font-display font-semibold text-lg">Typed SDKs</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">Drop-in TypeScript and Python clients with strict Zod validation. Never guess an API payload structure again.</p>
        </div>
        <div className="space-y-3 p-6 rounded-2xl bg-card border shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-5">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h3 className="font-display font-semibold text-lg">Scoped access</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">Generate granular API keys for partner integrations. Strict resource boundaries ensure your core data remains secure.</p>
        </div>
      </section>

      {/* Documentation Directory */}
      <section className="space-y-8">
        <div className="flex items-center justify-between border-b pb-4">
          <h2 className="text-2xl font-display font-semibold tracking-tight">Documentation</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {Object.entries(groupedDocs).map(([category, items]) => (
            <div key={category} className="space-y-5">
              <h3 className="font-display font-medium text-lg text-muted-foreground">{category}</h3>
              <div className="grid gap-3">
                {items.map(doc => (
                  <Link 
                    key={doc.slug}
                    href={`/docs/${doc.slug}`}
                    className="group flex flex-col p-5 rounded-xl border bg-card hover:border-primary hover:shadow-md transition-all duration-200"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-foreground group-hover:text-primary transition-colors">{doc.title}</h4>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">{doc.description}</p>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
