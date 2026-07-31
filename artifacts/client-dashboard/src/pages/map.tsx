import { useSessionExchange } from '@/hooks/useSessionExchange';
import React from 'react';
import { useLocation, useParams } from 'wouter';
import { useGetClientBoardMap, getGetClientBoardMapQueryKey } from '@workspace/api-client-react';
import { Loader2, ArrowLeft, Map as MapIcon, User, ExternalLink, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { formatDistanceToNow } from 'date-fns';

// Create a custom icon for property and crews to avoid missing image issues
const propertyIcon = L.divIcon({
  className: 'bg-transparent',
  html: `<div class="h-6 w-6 rounded-full bg-primary flex items-center justify-center border-2 border-background shadow-md">
           <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-primary-foreground"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
         </div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 24],
});

const getCrewIcon = (onSite: boolean) => L.divIcon({
  className: 'bg-transparent',
  html: `<div class="h-8 w-8 rounded-full ${onSite ? 'bg-primary' : 'bg-muted'} flex items-center justify-center border-2 border-background shadow-md overflow-hidden">
           <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="${onSite ? 'text-primary-foreground' : 'text-muted-foreground'}"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
         </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});

export default function MapView() {
  const { token } = useParams<{ token: string }>();
  useSessionExchange(token);
  const [, setLocation] = useLocation();

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
          <p className="mt-2 text-muted-foreground">We couldn't load the map view. Return to the command center.</p>
          <Button className="mt-6" onClick={() => setLocation(`/${token}`)}>Back to Board</Button>
        </div>
      </div>
    );
  }

  const { propertyName, propertyAddress, lat, lng, crews, happenings } = mapData;
  const hasLocation = lat != null && lng != null;

  return (
    <div className="flex h-screen flex-col bg-background font-sans md:flex-row">
      {/* Sidebar: Activity and Crews */}
      <aside className="flex h-[40vh] w-full flex-col border-r bg-card md:h-screen md:w-[380px] shrink-0">
        <header className="flex shrink-0 items-center justify-between border-b px-4 py-3 shadow-sm">
          <div>
            <Button variant="ghost" size="icon" className="mb-2 h-8 w-8 -ml-2" onClick={() => setLocation(`/${token}`)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-lg font-bold tracking-tight text-foreground leading-tight">{propertyName}</h1>
            {propertyAddress && (
              <p className="text-xs font-semibold text-muted-foreground">{propertyAddress}</p>
            )}
          </div>
          <div className="flex items-center gap-2 rounded-full bg-secondary/50 px-3 py-1.5 border">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            <span className="text-[10px] font-bold tracking-widest text-foreground uppercase">Live</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Crews Section */}
          <div className="p-4 border-b">
            <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <User className="h-4 w-4" /> Active Crews
            </h2>
            <div className="flex flex-col gap-3">
              {crews.length === 0 && (
                <p className="text-sm text-muted-foreground py-2 text-center">No active crews at the moment.</p>
              )}
              {crews.map(crew => (
                <div key={crew.jobNo} className="flex flex-col gap-2 rounded-lg border bg-secondary/20 p-3">
                  <div className="flex items-start gap-3">
                    {crew.selfieUrl ? (
                      <img src={crew.selfieUrl} alt="" className="h-10 w-10 shrink-0 rounded bg-card object-cover border" />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-card border">
                        <User className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex flex-1 flex-col min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-foreground truncate">{crew.crewName}</span>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${crew.onSite ? 'bg-primary/20 text-primary-foreground' : 'bg-muted/50 text-muted-foreground'}`}>
                          {crew.onSite ? 'On Site' : 'Off Site'}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground truncate">{crew.crewTrade || 'General'}</span>
                    </div>
                  </div>
                  
                  <div className="mt-1 flex flex-col gap-1.5 text-xs bg-background/50 rounded p-2">
                    <div className="flex justify-between">
                      <span className="font-semibold">{crew.description || crew.jobNo}</span>
                      {crew.unitNo && <span className="font-mono bg-accent/30 text-accent-foreground px-1 rounded border border-accent/20">{crew.unitNo}</span>}
                    </div>
                    {crew.lastCheckinAt && (
                      <div className="text-[11px] text-muted-foreground flex items-center justify-between mt-1">
                        <span>Last seen: {formatDistanceToNow(new Date(crew.lastCheckinAt))} ago</span>
                        <span className="capitalize">{crew.lastCheckinKind}</span>
                      </div>
                    )}
                  </div>
                  
                  {crew.trackerUrl && (
                    <Button variant="outline" size="sm" className="h-7 w-full text-[11px]" asChild>
                      <a href={crew.trackerUrl} target="_blank" rel="noreferrer">
                        Live Tracker <ExternalLink className="ml-1.5 h-3 w-3" />
                      </a>
                    </Button>
                  )}
                </div>
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
              The coordinates for {propertyName} haven't been set yet. The map view is disabled, but you can still monitor live crews and activity.
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
            <Marker position={[lat!, lng!]} icon={propertyIcon}>
              <Popup>
                <div className="font-bold">{propertyName}</div>
              </Popup>
            </Marker>

            {/* Crew Markers */}
            {crews.map((crew, idx) => {
              if (crew.lat != null && crew.lng != null) {
                return (
                  <React.Fragment key={crew.jobNo + idx}>
                    <Marker position={[crew.lat, crew.lng]} icon={getCrewIcon(crew.onSite)}>
                      <Popup>
                        <div className="font-bold">{crew.crewName}</div>
                        <div className="text-xs">{crew.description || crew.jobNo}</div>
                      </Popup>
                    </Marker>
                    {crew.accuracy != null && (
                      <Circle 
                        center={[crew.lat, crew.lng]} 
                        radius={crew.accuracy} 
                        pathOptions={{ color: 'hsl(var(--primary))', fillColor: 'hsl(var(--primary))', fillOpacity: 0.1, weight: 1 }} 
                      />
                    )}
                  </React.Fragment>
                );
              }
              return null;
            })}
          </MapContainer>
        )}
      </main>
    </div>
  );
}
