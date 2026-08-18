import { useSessionExchange } from '@/hooks/useSessionExchange';
import React, { useState, useRef } from 'react';
import { useLocation, useParams } from 'wouter';
import { useGetClientBoardMap, getGetClientBoardMapQueryKey } from '@workspace/api-client-react';
import type { ClientBoardMapCrew } from '@workspace/api-client-react';
import { Loader2, ArrowLeft, Map as MapIcon, User, ExternalLink, Activity, X, MapPin, CheckCircle2, Circle, Camera, Wrench, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MapContainer, TileLayer, Marker, Circle as LeafletCircle, Polyline } from 'react-leaflet';
import { CrewMapMarker, crewPinFromClientCrew } from '@workspace/board-ui';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { formatDistanceToNow } from 'date-fns';

const propertyIcon = L.divIcon({
  className: 'bg-transparent',
  html: `<div class="h-6 w-6 rounded-full bg-primary flex items-center justify-center border-2 border-background shadow-md">
           <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-primary-foreground"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
         </div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 24],
});

function CrewDetailSheet({
  crew,
  onClose,
}: {
  crew: ClientBoardMapCrew;
  onClose: () => void;
}) {
  const before = crew.photos?.filter(p => p.phase === 'before') ?? [];
  const after = crew.photos?.filter(p => p.phase === 'after') ?? [];
  const other = crew.photos?.filter(p => p.phase !== 'before' && p.phase !== 'after') ?? [];
  const services = crew.services ?? [];
  const doneSvcs = services.filter(s => s.done).length;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm animate-in fade-in"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-[90] bg-card rounded-t-3xl shadow-2xl animate-in slide-in-from-bottom-6 max-h-[85vh] flex flex-col md:left-auto md:right-6 md:bottom-6 md:top-24 md:w-96 md:rounded-3xl md:max-h-none">
        {/* Drag handle (mobile) */}
        <div className="md:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-4 border-b shrink-0">
          <div className="shrink-0">
            {crew.selfieUrl ? (
              <img
                src={crew.selfieUrl}
                alt=""
                className="w-12 h-12 rounded-full object-cover border-2 border-primary"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-muted border flex items-center justify-center">
                <User className="w-6 h-6 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-lg text-foreground truncate leading-tight">{crew.crewName}</h2>
            <div className="text-xs text-muted-foreground truncate">{crew.crewTrade || 'General'}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
              crew.onSite ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'
            }`}>
              {crew.onSite ? 'On Site' : 'Off Site'}
            </span>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-6">
            {/* Job + unit info */}
            <div className="bg-muted/50 rounded-2xl p-4 space-y-3">
              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 mt-0.5 text-primary shrink-0" />
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Job</div>
                  <div className="text-sm font-semibold text-foreground mt-0.5">
                    {crew.description || crew.jobNo}
                  </div>
                </div>
              </div>

              {crew.unitNo && (
                <div className="flex items-center gap-3 pt-2 border-t border-border">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-primary">U</span>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Working Unit</div>
                    <div className="text-base font-bold text-foreground font-mono tracking-wide">{crew.unitNo}</div>
                  </div>
                </div>
              )}

              {crew.lastCheckinAt && (
                <div className="flex items-center gap-3 pt-2 border-t border-border">
                  <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Last Seen</div>
                    <div className="text-xs text-foreground mt-0.5">
                      {formatDistanceToNow(new Date(crew.lastCheckinAt))} ago
                      {crew.lastCheckinKind && <span className="ml-1 capitalize text-muted-foreground">({crew.lastCheckinKind})</span>}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Before/After Photos */}
            {(crew.photos?.length ?? 0) > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Camera className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">Job Photos</h3>
                  <span className="text-xs text-muted-foreground">({crew.photos!.length})</span>
                </div>

                {before.length > 0 && (
                  <div className="mb-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Before</div>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {before.map(p => (
                        <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="shrink-0">
                          <img
                            src={p.url}
                            alt={p.note ?? 'Before photo'}
                            className="w-20 h-20 rounded-xl object-cover border border-border hover:opacity-90 transition-opacity"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {after.length > 0 && (
                  <div className="mb-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">After</div>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {after.map(p => (
                        <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="shrink-0">
                          <img
                            src={p.url}
                            alt={p.note ?? 'After photo'}
                            className="w-20 h-20 rounded-xl object-cover border border-border hover:opacity-90 transition-opacity"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {other.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Work Photos</div>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {other.map(p => (
                        <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="shrink-0">
                          <img
                            src={p.url}
                            alt={p.note ?? 'Photo'}
                            className="w-20 h-20 rounded-xl object-cover border border-border hover:opacity-90 transition-opacity"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Services */}
            {services.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold text-foreground">Today's Services</h3>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">{doneSvcs}/{services.length} done</span>
                </div>
                <div className="space-y-1.5">
                  {services.map(s => (
                    <div key={s.id} className="flex items-center gap-2.5 py-1.5 px-3 rounded-xl bg-muted/40">
                      {s.done
                        ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                        : <Circle className="w-4 h-4 text-muted-foreground shrink-0" />}
                      <span className={`text-sm leading-snug ${s.done ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                        {s.service}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(crew.photos?.length ?? 0) === 0 && services.length === 0 && (
              <div className="text-center py-6 text-sm text-muted-foreground italic">
                No photos or services recorded yet for this job.
              </div>
            )}

            {crew.trackerUrl && (
              <Button variant="outline" size="sm" className="w-full" asChild>
                <a href={crew.trackerUrl} target="_blank" rel="noreferrer">
                  Open Live Tracker <ExternalLink className="ml-2 h-3.5 w-3.5" />
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default function MapView() {
  const { token } = useParams<{ token: string }>();
  useSessionExchange(token);
  const [, setLocation] = useLocation();
  const [selectedCrew, setSelectedCrew] = useState<ClientBoardMapCrew | null>(null);

  const { data: mapData, isLoading, error } = useGetClientBoardMap(token, {
    query: {
      queryKey: getGetClientBoardMapQueryKey(token),
      refetchInterval: 10000,
    }
  });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm font-medium">Loading live map...</p>
        </div>
      </div>
    );
  }

  if (error || !mapData) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-foreground">Map Unavailable</h1>
          <p className="mt-2 text-muted-foreground">We couldn't load the map view.</p>
          <Button className="mt-6" onClick={() => setLocation(`/${token}`)}>Back to Board</Button>
        </div>
      </div>
    );
  }

  const { propertyName, propertyAddress, lat, lng, crews, happenings } = mapData;
  const hasLocation = lat != null && lng != null;

  return (
    <div className="flex h-screen flex-col bg-background font-sans md:flex-row">
      {/* Sidebar */}
      <aside className="flex h-[40vh] w-full flex-col border-r bg-card md:h-screen md:w-[360px] shrink-0">
        <header className="flex shrink-0 items-center justify-between border-b px-4 py-3 shadow-sm">
          <div>
            <Button variant="ghost" size="icon" className="mb-2 h-8 w-8 -ml-2" onClick={() => setLocation(`/${token}`)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-lg font-bold tracking-tight text-foreground leading-tight">{propertyName}</h1>
            {propertyAddress && <p className="text-xs font-semibold text-muted-foreground">{propertyAddress}</p>}
          </div>
          <div className="flex items-center gap-2 rounded-full bg-secondary/50 px-3 py-1.5 border">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            <span className="text-[10px] font-bold tracking-widest text-foreground uppercase">Live</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Crews */}
          <div className="p-4 border-b">
            <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <User className="h-4 w-4" /> Active Crews
            </h2>
            <div className="flex flex-col gap-3">
              {crews.length === 0 && (
                <p className="text-sm text-muted-foreground py-2 text-center">No active crews at the moment.</p>
              )}
              {crews.map(crew => (
                <button
                  key={crew.jobNo}
                  onClick={() => setSelectedCrew(crew)}
                  className="flex flex-col gap-2 rounded-xl border bg-secondary/20 p-3 text-left hover:bg-secondary/40 transition-colors w-full"
                >
                  <div className="flex items-start gap-3">
                    {crew.selfieUrl ? (
                      <img src={crew.selfieUrl} alt="" className="h-10 w-10 shrink-0 rounded-full bg-card object-cover border" />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card border">
                        <User className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex flex-1 flex-col min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-foreground truncate">{crew.crewName}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                          crew.onSite ? 'bg-green-100 text-green-700' : 'bg-muted/50 text-muted-foreground'
                        }`}>
                          {crew.onSite ? 'On Site' : 'Off Site'}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground truncate">{crew.crewTrade || 'General'}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-xs bg-background/50 rounded-lg px-2 py-1.5">
                    <span className="font-semibold text-foreground truncate">{crew.description || crew.jobNo}</span>
                    {crew.unitNo && (
                      <span className="shrink-0 font-mono text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-bold">
                        Unit {crew.unitNo}
                      </span>
                    )}
                  </div>

                  {((crew.photos?.length ?? 0) > 0 || (crew.services?.length ?? 0) > 0) && (
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      {(crew.photos?.length ?? 0) > 0 && (
                        <span className="flex items-center gap-1">
                          <Camera className="h-3 w-3" />
                          {crew.photos!.length} photo{crew.photos!.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {(crew.services?.length ?? 0) > 0 && (
                        <span className="flex items-center gap-1">
                          <Wrench className="h-3 w-3" />
                          {crew.services!.filter(s => s.done).length}/{crew.services!.length} services
                        </span>
                      )}
                      <span className="ml-auto text-primary text-[10px] font-medium">Tap for details →</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Activity Feed */}
          <div className="p-4">
            <h2 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Activity className="h-4 w-4" /> Activity Feed
            </h2>
            <div className="flex flex-col gap-4">
              {happenings.length === 0 && (
                <p className="text-sm text-muted-foreground py-2 text-center">No recent activity.</p>
              )}
              {happenings.map((h, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center pt-1.5">
                    <div className="h-2 w-2 rounded-full bg-primary" />
                    {i < happenings.length - 1 && <div className="mt-2 h-full w-px bg-border" />}
                  </div>
                  <div className="flex flex-col pb-2">
                    <p className="text-sm font-medium text-foreground">{h.text}</p>
                    <time className="text-xs text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(h.at))} ago
                    </time>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* Map Area */}
      <main className="relative flex-1 bg-muted/20">
        {!hasLocation ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            <MapIcon className="mb-4 h-16 w-16 text-muted-foreground/30" />
            <h2 className="text-xl font-bold text-foreground">Location Not Available</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              The coordinates for {propertyName} haven't been set yet.
            </p>
          </div>
        ) : (
          <MapContainer
            center={[lat!, lng!]}
            zoom={16}
            className="h-full w-full z-0"
            zoomControl={false}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* Property Marker */}
            <Marker position={[lat!, lng!]} icon={propertyIcon} />

            {/* GPS trails */}
            {crews.map((crew, idx) =>
              (crew.trail ?? []).length > 1 ? (
                <Polyline
                  key={`trail-${crew.jobId}-${idx}`}
                  positions={(crew.trail ?? []).map(p => [p.lat, p.lng] as [number, number])}
                  pathOptions={{ color: '#16a34a', weight: 4, opacity: 0.85 }}
                />
              ) : null
            )}

            {/* Crew Markers — clicking opens the detail sheet */}
            {crews.map((crew, idx) => {
              const pin = crewPinFromClientCrew(crew);
              if (!pin) return null;
              const isSelected = selectedCrew?.jobNo === crew.jobNo;
              return (
                <React.Fragment key={crew.jobNo + idx}>
                  <CrewMapMarker
                    pin={pin}
                    selected={isSelected}
                    popup={false}
                    onSelect={() => setSelectedCrew(crew)}
                  />
                  {crew.accuracy != null && (
                    <LeafletCircle
                      center={[pin.lat, pin.lng]}
                      radius={crew.accuracy}
                      pathOptions={{ color: 'hsl(var(--primary))', fillColor: 'hsl(var(--primary))', fillOpacity: 0.08, weight: 1 }}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </MapContainer>
        )}

        {/* "Tap a pin" hint — shown only when there are crews with no selection */}
        {crews.length > 0 && !selectedCrew && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
            <div className="bg-black/60 backdrop-blur-sm text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg">
              Tap a crew pin to see job details
            </div>
          </div>
        )}
      </main>

      {/* Crew detail sheet */}
      {selectedCrew && (
        <CrewDetailSheet crew={selectedCrew} onClose={() => setSelectedCrew(null)} />
      )}
    </div>
  );
}
