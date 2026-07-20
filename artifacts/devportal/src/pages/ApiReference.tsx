import { Link } from "wouter";
import { ArrowLeft, Code2 } from "lucide-react";
import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
import spec from "@/content/halo-openapi.yaml?raw";

export default function ApiReference() {
  return (
    <div className="api-reference-wrapper">
      <div className="sticky top-0 z-50 h-12 flex items-center gap-3 px-4 border-b bg-background">
        <Link href="/" className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Portal
        </Link>
        <div className="w-px h-4 bg-border" />
        <div className="flex items-center gap-2">
          <div className="bg-primary text-primary-foreground p-1 rounded">
            <Code2 className="w-3.5 h-3.5" />
          </div>
          <span className="font-display font-semibold text-sm">HALO API Reference</span>
        </div>
      </div>
      <ApiReferenceReact
        configuration={{
          content: spec,
          hideDarkModeToggle: true,
          theme: "default",
        }}
      />
    </div>
  );
}
