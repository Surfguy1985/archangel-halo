import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
export type PortalId = "portfolio" | "pulse" | "punchlist";
export type ViewMode = "map" | "board";
interface V {
  portal: PortalId; effectivePortal: PortalId; isVendor: boolean; isViewAs: boolean;
  viewAs: PortalId | null; setViewAs: (p: PortalId | null) => void;
  viewMode: ViewMode; setViewMode: (m: ViewMode) => void;
}
const C = createContext<V | null>(null);
function fromPath(path: string): PortalId {
  if (path.startsWith("/property-portfolio") || path === "/portfolio") return "portfolio";
  if (path.startsWith("/pulse")) return "pulse";
  if (path.startsWith("/punchlist")) return "punchlist";
  return "punchlist";
}
export function PortalProvider({ children, forcedPortal }: { children: ReactNode; forcedPortal?: PortalId }) {
  const [location] = useLocation();
  const [viewAs, setViewAs] = useState<PortalId | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("map");
  const portal = forcedPortal ?? fromPath(location);
  const effectivePortal = portal === "punchlist" && viewAs && viewAs !== "punchlist" ? viewAs : portal;
  const isVendor = effectivePortal === "punchlist";
  const isViewAs = portal === "punchlist" && !!viewAs && viewAs !== "punchlist";
  const value = useMemo(() => ({
    portal, effectivePortal, isVendor, isViewAs,
    viewAs: isViewAs ? viewAs : null,
    setViewAs: (p: PortalId | null) => { if (portal === "punchlist") setViewAs(p); },
    viewMode, setViewMode,
  }), [portal, effectivePortal, isVendor, isViewAs, viewAs, viewMode]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
export function usePortal(): V {
  return useContext(C) ?? {
    portal: "punchlist", effectivePortal: "punchlist", isVendor: true, isViewAs: false,
    viewAs: null, setViewAs: () => {}, viewMode: "map", setViewMode: () => {},
  };
}
export function useIsVendor() { return usePortal().isVendor; }
