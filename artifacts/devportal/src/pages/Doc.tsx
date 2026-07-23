import React, { useEffect, useState } from "react";
import { useParams } from "wouter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { docs } from "@/content/registry";
import { ChevronRight, Terminal } from "lucide-react";

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w]+/g, '-').replace(/(^-|-$)/g, '');
}

function stripMarkdown(text: string): string {
  return text.replace(/[`*_~]|\[([^\]]*)\]\([^)]*\)/g, '$1');
}

function extractText(children: any): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return extractText(children.props.children);
  }
  return "";
}

interface TocItem {
  id: string;
  text: string;
  level: number;
}

export default function Doc() {
  const { slug } = useParams();
  const doc = docs.find(d => d.slug === slug);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    if (!doc) return;
    
    // Extract headings for TOC
    const headingRegex = /^(#{2,3})\s+(.+)$/gm;
    const items: TocItem[] = [];
    let match;
    
    while ((match = headingRegex.exec(doc.markdown)) !== null) {
      const level = match[1].length;
      const text = stripMarkdown(match[2]);
      const id = slugify(text);
      items.push({ id, text, level });
    }
    
    setToc(items);
  }, [doc]);

  useEffect(() => {
    const handleScroll = () => {
      const headingElements = Array.from(document.querySelectorAll("h2, h3"));
      let currentActiveId = "";
      
      for (const el of headingElements) {
        const rect = el.getBoundingClientRect();
        if (rect.top <= 100) {
          currentActiveId = el.id;
        }
      }
      
      if (currentActiveId) {
        setActiveId(currentActiveId);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  if (!doc) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center border border-white/10 bg-zinc-950 relative overflow-hidden mt-8">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]" />
        <Terminal className="w-16 h-16 text-primary mb-6 relative z-10" strokeWidth={1} />
        <h2 className="font-display text-4xl font-bold tracking-widest uppercase mb-4 text-white relative z-10">404_NOT_FOUND</h2>
        <p className="text-zinc-400 font-mono mb-8 relative z-10 uppercase tracking-widest text-sm">Target documentation block inaccessible.</p>
        <button onClick={() => window.history.back()} className="relative z-10 bg-primary text-black font-display font-bold uppercase tracking-widest px-8 py-4 hover:bg-white transition-colors">
          Return to Hub
        </button>
      </div>
    );
  }

  // Custom renderer functions to add IDs to headings
  const components = {
    h2: ({ node, children, ...props }: any) => {
      const id = slugify(extractText(children));
      return <h2 id={id} className="scroll-m-20 border-b border-white/10 pb-4 text-4xl font-display font-bold tracking-tight first:mt-0 mt-16 mb-8 uppercase text-white" {...props}>{children}</h2>;
    },
    h3: ({ node, children, ...props }: any) => {
      const id = slugify(extractText(children));
      return <h3 id={id} className="scroll-m-20 text-2xl font-display font-semibold tracking-wide mt-12 mb-6 uppercase text-white/90" {...props}>{children}</h3>;
    }
  };

  return (
    <div className="flex flex-col xl:flex-row gap-16 max-w-[1400px] animate-in fade-in duration-700">
      
      {/* Main Document Content */}
      <article className="flex-1 min-w-0">
        <div className="flex items-center gap-3 font-mono text-xs tracking-widest uppercase text-muted-foreground mb-12 bg-white/5 px-4 py-2 w-fit border border-white/10">
          <span className="text-primary">{doc.category}</span>
          <ChevronRight className="w-3 h-3 text-white/30" />
          <span className="text-white font-semibold">{doc.title}</span>
        </div>
        
        <div className="prose prose-zinc dark:prose-invert max-w-none 
          prose-headings:font-display prose-headings:font-bold prose-headings:uppercase 
          prose-a:text-primary prose-a:no-underline hover:prose-a:underline hover:prose-a:decoration-primary 
          prose-p:font-sans prose-p:leading-loose prose-p:text-zinc-300
          prose-strong:text-white prose-strong:font-semibold
          prose-ul:text-zinc-300 prose-ul:font-sans prose-li:leading-loose
          prose-ol:text-zinc-300 prose-ol:font-sans
          prose-hr:border-white/10
          ">
          <ReactMarkdown 
            remarkPlugins={[remarkGfm]}
            components={components}
          >
            {doc.markdown}
          </ReactMarkdown>
        </div>
        
        <div className="mt-24 pt-8 border-t border-white/10 flex justify-between items-center text-xs font-mono tracking-widest uppercase text-muted-foreground">
          <span>Sys_Update: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
          <button className="hover:text-primary transition-colors border border-transparent hover:border-primary px-3 py-1">Submit Report</button>
        </div>
      </article>

      {/* Right Sidebar - TOC */}
      {toc.length > 0 && (
        <aside className="hidden xl:block w-72 shrink-0">
          <div className="sticky top-32 p-6 border border-white/10 bg-zinc-950">
            <h4 className="font-display font-bold text-xs tracking-[0.2em] text-primary uppercase mb-6 flex items-center gap-3">
              <div className="w-1.5 h-1.5 bg-primary" /> Index
            </h4>
            <nav className="flex flex-col gap-3 font-mono text-xs">
              {toc.map((item) => (
                <a 
                  key={item.id}
                  href={`#${item.id}`}
                  className={`line-clamp-2 transition-all block border-l-2 py-1 pl-3 ${
                    activeId === item.id 
                      ? "border-primary text-white font-bold bg-white/5" 
                      : "border-white/10 text-muted-foreground hover:text-white hover:border-white/30"
                  } ${item.level === 3 ? "ml-4 text-[10px]" : ""}`}
                >
                  {item.text}
                </a>
              ))}
            </nav>
          </div>
        </aside>
      )}
    </div>
  );
}
