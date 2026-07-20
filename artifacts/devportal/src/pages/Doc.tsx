import React, { useEffect, useState } from "react";
import { useParams } from "wouter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { docs } from "@/content/registry";
import { ChevronRight, FileText } from "lucide-react";

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
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <FileText className="w-12 h-12 text-muted-foreground/30 mb-4" />
        <h2 className="font-display text-2xl font-semibold mb-2">Document not found</h2>
        <p className="text-muted-foreground mb-6">The documentation you're looking for doesn't exist or has been moved.</p>
        <button onClick={() => window.history.back()} className="text-sm font-medium text-primary hover:underline">
          Go back
        </button>
      </div>
    );
  }

  // Custom renderer functions to add IDs to headings
  const components = {
    h2: ({ node, children, ...props }: any) => {
      const id = slugify(extractText(children));
      return <h2 id={id} className="scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0 mt-10 mb-5" {...props}>{children}</h2>;
    },
    h3: ({ node, children, ...props }: any) => {
      const id = slugify(extractText(children));
      return <h3 id={id} className="scroll-m-20 text-2xl font-semibold tracking-tight mt-8 mb-4" {...props}>{children}</h3>;
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-12 max-w-[1200px] animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Main Document Content */}
      <article className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-8">
          <span>{doc.category}</span>
          <ChevronRight className="w-4 h-4" />
          <span className="text-foreground font-medium">{doc.title}</span>
        </div>
        
        <div className="prose prose-zinc dark:prose-invert max-w-none prose-headings:font-display prose-a:text-primary">
          <ReactMarkdown 
            remarkPlugins={[remarkGfm]}
            components={components}
          >
            {doc.markdown}
          </ReactMarkdown>
        </div>
        
        <div className="mt-16 pt-8 border-t flex justify-between items-center text-sm text-muted-foreground">
          <span>Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
          <button className="hover:text-foreground transition-colors">Provide feedback</button>
        </div>
      </article>

      {/* Right Sidebar - TOC */}
      {toc.length > 0 && (
        <aside className="hidden lg:block w-64 shrink-0">
          <div className="sticky top-24">
            <h4 className="font-display font-medium text-sm text-foreground mb-4">On this page</h4>
            <nav className="flex flex-col gap-2.5 text-sm">
              {toc.map((item) => (
                <a 
                  key={item.id}
                  href={`#${item.id}`}
                  className={`line-clamp-2 transition-colors hover:text-foreground ${
                    activeId === item.id 
                      ? "text-primary font-medium" 
                      : "text-muted-foreground"
                  } ${item.level === 3 ? "pl-4" : ""}`}
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
