import React from "react";
import { Link } from "wouter";
import { docs } from "@/content/registry";
import { ArrowRight, Book, Zap, ShieldCheck, Terminal, Cpu, Network } from "lucide-react";

export default function Home() {
  const groupedDocs = docs.reduce((acc, doc) => {
    if (!acc[doc.category]) acc[doc.category] = [];
    acc[doc.category].push(doc);
    return acc;
  }, {} as Record<string, typeof docs>);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-8 duration-1000 space-y-24 pb-12">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-black text-white p-12 md:p-24 border border-white/10 flex flex-col justify-center min-h-[70vh]">
        {/* Grid Background Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]" />
        
        {/* Abstract Glows */}
        <div className="absolute -top-[30%] -right-[10%] w-[70%] h-[70%] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute bottom-[10%] -left-[20%] w-[50%] h-[50%] bg-primary/10 blur-[100px] rounded-full pointer-events-none" />
        
        <div className="relative z-10 max-w-4xl border-l-4 border-primary pl-8 md:pl-12">
          <div className="inline-flex items-center gap-3 px-4 py-1.5 bg-black border border-primary/30 text-xs font-mono font-medium mb-10 text-primary tracking-widest uppercase">
            <span className="flex w-2 h-2 rounded-none bg-primary animate-pulse shadow-[0_0_8px_rgba(198,242,17,0.8)]" />
            System Online // v2.4.0
          </div>
          <h1 className="text-5xl md:text-8xl font-display font-bold tracking-tighter mb-8 leading-[1.1] uppercase">
            Operational <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-[#e0ff4f] to-primary">Supremacy.</span>
          </h1>
          <p className="text-xl md:text-2xl text-zinc-400 mb-12 max-w-2xl leading-relaxed font-sans font-light">
            Direct access to HALO's core engines. Integrate billing, scheduling, and dispatch protocols into your architecture.
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <Link href={docs.length > 0 ? `/docs/${docs[0].slug}` : "/"} className="group inline-flex items-center justify-center h-14 px-8 bg-primary text-black font-display font-bold uppercase tracking-widest hover:bg-white transition-all shadow-[0_0_20px_rgba(198,242,17,0.3)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5)] gap-3">
              Initialize <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link href="/api-reference" className="inline-flex items-center justify-center h-14 px-8 bg-transparent text-white border border-white/20 font-mono text-sm tracking-widest uppercase hover:bg-white/5 hover:border-primary transition-all gap-3">
              <Terminal className="w-4 h-4" /> Reference
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="grid md:grid-cols-3 gap-1">
        <div className="group space-y-6 p-10 bg-zinc-950 border border-white/10 hover:border-primary/50 transition-colors relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-100 transition-opacity">
            <Network className="w-24 h-24 text-primary" strokeWidth={0.5} />
          </div>
          <div className="w-14 h-14 bg-black border border-white/10 flex items-center justify-center text-primary mb-8 relative z-10 group-hover:scale-110 group-hover:bg-primary group-hover:text-black transition-all duration-300">
            <Zap className="w-6 h-6" />
          </div>
          <h3 className="font-display font-bold text-xl uppercase tracking-wider relative z-10">Live Webhooks</h3>
          <p className="text-zinc-400 text-sm leading-loose relative z-10 font-sans">Subscribe to operational events in real-time. Sync job status, invoice payments, and dispatch arrivals to your external systems with zero latency.</p>
        </div>
        <div className="group space-y-6 p-10 bg-zinc-950 border border-white/10 hover:border-primary/50 transition-colors relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-100 transition-opacity">
            <Cpu className="w-24 h-24 text-primary" strokeWidth={0.5} />
          </div>
          <div className="w-14 h-14 bg-black border border-white/10 flex items-center justify-center text-primary mb-8 relative z-10 group-hover:scale-110 group-hover:bg-primary group-hover:text-black transition-all duration-300">
            <Terminal className="w-6 h-6" />
          </div>
          <h3 className="font-display font-bold text-xl uppercase tracking-wider relative z-10">Typed SDKs</h3>
          <p className="text-zinc-400 text-sm leading-loose relative z-10 font-sans">Drop-in TypeScript and Python clients with strict validation. Predictable payloads. Never guess a schema structure again.</p>
        </div>
        <div className="group space-y-6 p-10 bg-zinc-950 border border-white/10 hover:border-primary/50 transition-colors relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-100 transition-opacity">
            <ShieldCheck className="w-24 h-24 text-primary" strokeWidth={0.5} />
          </div>
          <div className="w-14 h-14 bg-black border border-white/10 flex items-center justify-center text-primary mb-8 relative z-10 group-hover:scale-110 group-hover:bg-primary group-hover:text-black transition-all duration-300">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h3 className="font-display font-bold text-xl uppercase tracking-wider relative z-10">Scoped Access</h3>
          <p className="text-zinc-400 text-sm leading-loose relative z-10 font-sans">Generate granular API keys for partner integrations. Strict resource boundaries ensure your core operations remain impenetrable.</p>
        </div>
      </section>

      {/* Documentation Directory */}
      <section className="space-y-12">
        <div className="flex items-center justify-between border-b border-white/10 pb-6">
          <h2 className="text-3xl font-display font-bold tracking-widest uppercase flex items-center gap-4">
            <div className="w-3 h-3 bg-primary" /> Directory
          </h2>
        </div>

        <div className="grid md:grid-cols-2 gap-12">
          {Object.entries(groupedDocs).map(([category, items]) => (
            <div key={category} className="space-y-6">
              <h3 className="font-mono font-medium text-sm text-primary tracking-[0.3em] uppercase flex items-center gap-3">
                <span className="w-8 h-[1px] bg-primary/50" /> {category}
              </h3>
              <div className="grid gap-4">
                {items.map(doc => (
                  <Link 
                    key={doc.slug}
                    href={`/docs/${doc.slug}`}
                    className="group flex flex-col p-6 bg-zinc-950 border border-white/5 hover:border-primary hover:bg-black transition-all duration-300"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-display font-bold text-lg text-white group-hover:text-primary transition-colors tracking-wide uppercase">{doc.title}</h4>
                      <div className="w-8 h-8 flex items-center justify-center bg-white/5 border border-white/10 group-hover:bg-primary group-hover:border-primary group-hover:text-black transition-colors text-white">
                        <ArrowRight className="w-4 h-4" />
                      </div>
                    </div>
                    <p className="text-sm text-zinc-500 font-sans leading-relaxed pr-8">{doc.description}</p>
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
