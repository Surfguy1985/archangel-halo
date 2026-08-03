import { Fragment, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, CircleMarker, useMap } from "react-leaflet";
import { divIcon, latLngBounds } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useGetClientBoardMap, getGetClientBoardMapQueryKey } from "@workspace/api-client-react";
import { MapPin, X, Users, Activity, Clock, LogIn, LogOut, Loader2, ArrowRight, Share2, ChevronDown, ChevronUp, History } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface Props {
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Ensure the map zooms correctly based on active pins/property
function FitToPoints({ 
  propertyLatLng, 
  crews 
}: { 
  propertyLatLng: [number, number] | null;
  crews: any[];
}) {
  const map = useMap();
  useEffect(() => {
    const points: [number, number][] = [];
    if (propertyLatLng) points.push(propertyLatLng);
    crews.forEach((c) => {
      if (c.lat != null && c.lng != null) points.push([c.lat, c.lng]);
    });
    
    if (points.length === 0) return;
    const bounds = latLngBounds(points);
    map.fitBounds(bounds.pad(0.3), { maxZoom: 17 });
  }, [map, propertyLatLng, crews.map(c => `${c.lat}-${c.lng}`).join("|")]);
  
  return null;
}

// XSS safe rendering of names/HTML
const escapeHtml = (text: string) => {
  const div = document.createElement("div");
  div.innerText = text;
  return div.innerHTML;
};

// Render marker icon
function crewIcon(crew: any) {
  const onSite = crew.onSite;
  const initial = crew.crewName ? escapeHtml(crew.crewName.charAt(0).toUpperCase()) : "?";
  const avatarHtml = crew.selfieUrl 
    ? `<img src="${escapeHtml(crew.selfieUrl)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#f3f4f6;color:#374151;font-weight:700;font-size:16px;">${initial}</div>`;
    
  const pulseHtml = onSite 
    ? `<div style="position:absolute;bottom:-2px;right:-2px;width:12px;height:12px;background:#10b981;border-radius:50%;border:2px solid white;box-shadow:0 0 0 2px rgba(16, 185, 129, 0.4);"></div>`
    : `<div style="position:absolute;bottom:-2px;right:-2px;width:12px;height:12px;background:#9ca3af;border-radius:50%;border:2px solid white;"></div>`;
    
  return divIcon({
    className: "",
    html: `<div style="width:40px;height:40px;border-radius:50%;border:2px solid white;box-shadow:0 4px 12px rgba(0,0,0,0.15);position:relative;background:white;overflow:visible;">
      <div style="width:100%;height:100%;border-radius:50%;overflow:hidden;">${avatarHtml}</div>
      ${pulseHtml}
    </div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -20],
  });
}

function propertyIcon() {
  return divIcon({
    className: "",
    html: `<div style="width:36px;height:36px;border-radius:12px;background:#101c33;color:white;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.2);"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
  });
}

// Full check-in / check-out trail for one crew, newest first.
function CrewTrail({ events }: { events: any[] }) {
  if (!events?.length) {
    return <div className="text-xs text-muted-foreground italic pt-1">No check-ins recorded yet.</div>;
  }
  return (
    <div className="mt-2 space-y-1.5 border-l-2 border-border pl-3">
      {events.map((e, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          {e.kind === "checkin" ? (
            <LogIn className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          ) : (
            <LogOut className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          )}
          <span className="font-semibold">{e.kind === "checkin" ? "Checked in" : "Checked out"}</span>
          <span className="text-muted-foreground ml-auto whitespace-nowrap">
            {format(parseISO(e.at), "MMM d, h:mm a")}
          </span>
        </div>
      ))}
    </div>
  );
}

// Points of a crew's trail that actually have GPS coordinates, oldest→newest
// so the polyline follows the crew's real path through the day.
function trailPoints(events: any[] | undefined): { lat: number; lng: number; at: string; kind: string; label: string | null }[] {
  return (events || [])
    .filter((e) => e.lat != null && e.lng != null)
    .map((e) => ({ lat: e.lat as number, lng: e.lng as number, at: e.at as string, kind: e.kind as string, label: (e.label ?? null) as string | null }))
    .reverse(); // payload is newest-first
}

export function BirdseyeMapDialog({ token, open, onOpenChange }: Props) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [expandedCrew, setExpandedCrew] = useState<string | null>(null);
  // Which crew's route trail is highlighted on the map (keyed by jobId).
  const [selectedTrail, setSelectedTrail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const shareMap = async () => {
    const url = `${window.location.origin}/board/${token}?map=1`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Live crew map", url });
        return;
      }
    } catch {
      /* fall through to clipboard */
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Last resort: show the link so sharing never silently no-ops.
      window.prompt("Copy this link to share the live map:", url);
    }
  };

  const { data, isLoading } = useGetClientBoardMap(token, {
    query: {
      queryKey: getGetClientBoardMapQueryKey(token),
      enabled: open,
      refetchInterval: 10000, // Poll every 10s
    },
  });

  const propertyLatLng: [number, number] | null = data?.lat && data?.lng ? [data.lat, data.lng] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-none w-full h-[100dvh] p-0 rounded-none border-none overflow-hidden bg-background m-0 focus-visible:outline-none focus:outline-none focus-visible:ring-0">
        <DialogTitle className="sr-only">Live Birdseye Map</DialogTitle>
        
        {isLoading && !data && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-50">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        )}

        <div className="absolute inset-0 flex flex-col md:flex-row">
          {/* Main Map Area — full bleed; the roster slides over it on mobile */}
          <div className="flex-1 relative h-full bg-muted">
            {propertyLatLng || (data?.crews && data.crews.some(c => c.lat && c.lng)) ? (
              <MapContainer
                center={propertyLatLng || [0, 0]}
                zoom={15}
                style={{ height: "100%", width: "100%", zIndex: 0 }}
                scrollWheelZoom={true}
                zoomControl={false}
              >
                <TileLayer
                  url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                />
                <FitToPoints propertyLatLng={propertyLatLng} crews={data?.crews || []} />
                
                {propertyLatLng && (
                  <Marker position={propertyLatLng} icon={propertyIcon()}>
                    <Popup className="rounded-xl overflow-hidden border-none shadow-xl">
                      <div className="font-bold text-base mb-1">{data?.propertyName}</div>
                      <div className="text-sm text-muted-foreground">{data?.propertyAddress}</div>
                    </Popup>
                  </Marker>
                )}
                
                {/* Selected crew's route trail: polyline + a dot per GPS event */}
                {data?.crews?.filter((c) => selectedTrail && c.jobId === selectedTrail).map((c) => {
                  const pts = trailPoints((c as any).events);
                  if (!pts.length) return null;
                  return (
                    <Fragment key={`trail-${c.jobId}`}>
                      {pts.length > 1 && (
                        <Polyline
                          positions={pts.map((p) => [p.lat, p.lng] as [number, number])}
                          pathOptions={{ color: "#2563eb", weight: 3, opacity: 0.75, dashArray: "6 8" }}
                        />
                      )}
                      {pts.map((p, pi) => (
                        <CircleMarker
                          key={pi}
                          center={[p.lat, p.lng]}
                          radius={6}
                          pathOptions={{
                            color: "white",
                            weight: 2,
                            fillColor: p.kind === "checkout" ? "#9ca3af" : "#2563eb",
                            fillOpacity: 1,
                          }}
                        >
                          <Popup className="rounded-xl border-none shadow-xl">
                            <div className="text-sm font-bold mb-0.5">
                              {c.crewName} · {p.kind === "checkout" ? "Checked out" : "Checked in"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {format(parseISO(p.at), "MMM d, h:mm a")}
                            </div>
                            {p.label && <div className="text-xs text-muted-foreground mt-0.5">{p.label}</div>}
                          </Popup>
                        </CircleMarker>
                      ))}
                    </Fragment>
                  );
                })}

                {data?.crews?.map((c, i) => {
                  if (c.lat == null || c.lng == null) return null;
                  return (
                    <Marker
                      key={c.jobId || i}
                      position={[c.lat, c.lng]}
                      icon={crewIcon(c)}
                      eventHandlers={{
                        // Tapping a crew marker highlights that crew's trail.
                        click: () => setSelectedTrail(c.jobId ?? null),
                      }}
                    >
                      <Popup className="rounded-xl border-none shadow-xl min-w-[240px]">
                        <div className="flex items-center gap-3 mb-3">
                          <Avatar className="w-10 h-10 border border-border">
                            {c.selfieUrl ? <AvatarImage src={c.selfieUrl} /> : null}
                            <AvatarFallback>{c.crewName?.charAt(0).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-bold text-[15px] leading-tight">{c.crewName}</div>
                            {c.crewTrade && <div className="text-xs text-muted-foreground mt-0.5">{c.crewTrade}</div>}
                          </div>
                        </div>
                        
                        {c.description && (
                          <div className="text-sm bg-muted p-2 rounded-lg mb-3 line-clamp-2">
                            {c.description}
                          </div>
                        )}
                        
                        <div className="flex items-center justify-between text-xs font-medium bg-secondary/50 rounded-lg p-2 mb-3">
                          <div className="flex items-center gap-1.5">
                            {c.onSite ? (
                              <><div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> On site</>
                            ) : (
                              <><div className="w-2 h-2 rounded-full bg-muted-foreground" /> Off site</>
                            )}
                          </div>
                          {c.lastCheckinAt && (
                            <span className="text-muted-foreground">
                              {c.lastCheckinKind === 'checkin' ? 'in ' : 'out '} 
                              {formatDistanceToNow(parseISO(c.lastCheckinAt), { addSuffix: true })}
                            </span>
                          )}
                        </div>

                        {c.trackerUrl && (
                          <a 
                            href={c.trackerUrl} 
                            target="_blank" 
                            rel="noreferrer"
                            className="flex items-center justify-center gap-2 w-full bg-primary text-primary-foreground py-2 rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
                          >
                            Live Tracker <ArrowRight className="w-4 h-4" />
                          </a>
                        )}
                      </Popup>
                    </Marker>
                  );
                })}
              </MapContainer>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/30 p-6 text-center">
                <MapPin className="w-16 h-16 text-muted-foreground/30 mb-4" />
                <h3 className="text-xl font-bold mb-2">No location data</h3>
                <p className="text-muted-foreground max-w-md">
                  We don't have GPS coordinates for {data?.propertyName || 'this property'} yet, and no crews are currently broadcasting their location.
                </p>
              </div>
            )}

            {/* Floating Close Button */}
            <button
              onClick={() => onOpenChange(false)}
              className="absolute top-4 left-4 z-[400] w-12 h-12 bg-background/90 backdrop-blur rounded-full flex items-center justify-center shadow-lg border border-border hover:bg-background transition-colors text-foreground focus:outline-none"
            >
              <X className="w-6 h-6" />
            </button>

            {/* Share the live map (deep link opens the board straight to it) */}
            <button
              onClick={shareMap}
              className="absolute top-4 right-4 z-[400] h-12 px-4 bg-background/90 backdrop-blur rounded-full flex items-center gap-2 shadow-lg border border-border hover:bg-background transition-colors text-foreground text-sm font-semibold focus:outline-none"
              data-testid="button-share-map"
            >
              <Share2 className="w-4 h-4" /> {copied ? "Link copied" : "Share"}
            </button>

            {/* Mobile: toggle the crew panel over the full-bleed map */}
            <button
              onClick={() => setPanelOpen((v) => !v)}
              className="md:hidden absolute bottom-5 left-1/2 -translate-x-1/2 z-[420] h-11 px-5 bg-foreground text-background rounded-full flex items-center gap-2 shadow-xl text-sm font-bold focus:outline-none"
              data-testid="button-toggle-crew-panel"
            >
              <Users className="w-4 h-4" />
              {data?.crews?.length || 0} crew{(data?.crews?.length || 0) === 1 ? "" : "s"}
              {panelOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
            
            {/* Overlay Header */}
            {data?.propertyName && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[400] bg-background/90 backdrop-blur px-6 py-3 rounded-full shadow-lg border border-border flex flex-col items-center pointer-events-none hidden md:flex">
                <span className="font-bold text-sm tracking-wide uppercase">{data.propertyName}</span>
                {data.propertyAddress && <span className="text-xs text-muted-foreground">{data.propertyAddress}</span>}
              </div>
            )}
          </div>

          {/* Right/Bottom Panel - Roster & Happenings. Mobile: slide-up sheet over the map. */}
          <div
            className={`md:static md:translate-y-0 md:w-[400px] md:h-full md:rounded-none absolute inset-x-0 bottom-0 h-[62dvh] rounded-t-2xl transition-transform duration-300 ${panelOpen ? "translate-y-0" : "translate-y-full"} md:!translate-y-0 w-full bg-background border-t md:border-t-0 md:border-l border-border flex flex-col z-[410] shadow-2xl`}
          >
            <div className="flex-1 overflow-y-auto hide-scrollbar">
              
              {/* Happenings Section */}
              <div className="p-6 pb-2">
                <div className="flex items-center gap-2 mb-4 text-sm font-bold tracking-widest uppercase text-muted-foreground">
                  <Activity className="w-4 h-4" /> Live Feed
                </div>
                
                <div className="space-y-4 relative before:absolute before:inset-0 before:ml-2 md:before:mx-0 before:translate-x-[9px] md:before:translate-x-[9px] before:h-full before:w-[2px] before:bg-gradient-to-b before:from-border before:to-transparent before:z-0">
                  {data?.happenings?.length ? data.happenings.map((h, i) => (
                    <div key={i} className="relative z-10 flex gap-4">
                      <div className="w-5 h-5 rounded-full bg-background border-2 border-primary flex-shrink-0 mt-0.5" />
                      <div className="bg-muted/50 rounded-xl p-3 flex-1 border border-border/50">
                        <div className="text-[13px] text-muted-foreground font-medium mb-1 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" />
                          {h.at ? formatDistanceToNow(parseISO(h.at), { addSuffix: true }) : 'Just now'}
                        </div>
                        <div className="text-sm font-medium leading-relaxed">{h.text}</div>
                      </div>
                    </div>
                  )) : (
                    <div className="text-sm text-muted-foreground italic pl-8">No recent activity.</div>
                  )}
                </div>
              </div>

              {/* Roster Section */}
              <div className="p-6 border-t border-border mt-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 text-sm font-bold tracking-widest uppercase text-muted-foreground">
                    <Users className="w-4 h-4" /> Crew Roster
                  </div>
                  <div className="text-xs font-bold bg-muted px-2 py-1 rounded-md">
                    {data?.crews?.filter(c => c.onSite).length || 0} on site
                  </div>
                </div>

                <div className="space-y-3">
                  {data?.crews?.length ? data.crews.map((c, i) => (
                    <div
                      key={c.jobId || i}
                      className="group flex items-start gap-3 p-3 rounded-xl hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50 cursor-pointer"
                      onClick={() => {
                        const key = c.jobId || String(i);
                        const opening = expandedCrew !== key;
                        setExpandedCrew(opening ? key : null);
                        // Tapping a roster row also highlights that crew's trail on the map.
                        setSelectedTrail(opening ? (c.jobId ?? null) : null);
                      }}
                      data-testid={`row-crew-${c.jobId || i}`}
                    >
                      <div className="relative">
                        <Avatar className="w-12 h-12 border border-border">
                          {c.selfieUrl ? <AvatarImage src={c.selfieUrl} /> : null}
                          <AvatarFallback>{c.crewName?.charAt(0).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        {c.onSite && (
                          <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-background rounded-full animate-pulse" />
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start mb-0.5">
                          <h4 className="font-bold text-[15px] truncate pr-2">{c.crewName}</h4>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0 mt-1">
                            {c.unitNo || c.jobNo}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-1 mb-1.5">{c.description || c.crewTrade}</p>
                        
                        <div className="flex items-center gap-3 text-[11px] font-medium text-muted-foreground">
                          {c.lastCheckinAt ? (
                            <span className="flex items-center gap-1">
                              {c.lastCheckinKind === 'checkin' ? <LogIn className="w-3 h-3 text-emerald-500" /> : <LogOut className="w-3 h-3" />}
                              {formatDistanceToNow(parseISO(c.lastCheckinAt), { addSuffix: true })}
                            </span>
                          ) : (
                            <span>Not checked in</span>
                          )}
                          
                          {c.trackerUrl && (
                            <a 
                              href={c.trackerUrl} 
                              target="_blank" 
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-primary hover:underline ml-auto flex items-center gap-1"
                            >
                              Live Tracker <ArrowRight className="w-3 h-3" />
                            </a>
                          )}
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <History className="w-3 h-3" />
                            {(c as any).events?.length || 0}
                          </span>
                        </div>
                        {expandedCrew === (c.jobId || String(i)) && <CrewTrail events={(c as any).events || []} />}
                      </div>
                    </div>
                  )) : (
                    <div className="text-center p-6 bg-muted/30 rounded-xl border border-border border-dashed">
                      <p className="text-sm text-muted-foreground">No crews dispatched today.</p>
                    </div>
                  )}
                </div>
              </div>
              
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
