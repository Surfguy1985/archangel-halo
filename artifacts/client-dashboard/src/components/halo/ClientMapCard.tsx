/**
 * ClientMapCard — property map lens (permission-gated by 'unit_map').
 * Embeds a Leaflet map centered on the property with on-site crew dots (first name only).
 * No GPS trail, no crew contact details — client-safe.
 * "Open full map" navigates to /:token/map for full detail.
 */
import React, { useEffect } from 'react';
import {
  useGetClientBoardMap,
  getGetClientBoardMapQueryKey,
} from '@workspace/api-client-react';
import { MapPin, Users, Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon path issue in Vite builds
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const propertyIcon = L.divIcon({
  className: 'bg-transparent',
  html: `<div style="width:14px;height:14px;border-radius:50%;background:#B4FF44;border:2px solid #07101E;box-shadow:0 0 8px rgba(180,255,68,0.5)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

function makeCrewIcon(firstName: string, onSite: boolean) {
  const bg = onSite ? '#22c55e' : '#3B82F6';
  return L.divIcon({
    className: 'bg-transparent',
    html: `<div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:${bg};border:2px solid #07101E;box-shadow:0 2px 8px rgba(0,0,0,0.4);font-size:11px;font-weight:700;color:white;font-family:sans-serif">${firstName[0]?.toUpperCase() ?? '?'}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

type Props = {
  token: string;
  permissions: string[];
  onNavigateMap: () => void;
};

export function ClientMapCard({ token, permissions, onNavigateMap }: Props) {
  const hasPermission = permissions.includes('unit_map') || permissions.includes('map');

  const { data, isLoading, error } = useGetClientBoardMap(token, {
    query: {
      queryKey: getGetClientBoardMapQueryKey(token),
      enabled: hasPermission,
      refetchInterval: 60_000,
    },
  });

  if (!hasPermission) {
    return (
      <div className="bg-[#0C1B30] border border-white/7 rounded-2xl px-4 py-4 flex items-center gap-3 mb-3" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
        <MapPin className="w-4 h-4 text-white/25 shrink-0" />
        <span className="text-[12.5px] text-white/40">Map access is not enabled for this account.</span>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-[#0C1B30] border border-white/7 rounded-2xl px-4 py-5 flex items-center gap-3 mb-3" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
        <Loader2 className="w-4 h-4 text-[#B4FF44]/50 animate-spin shrink-0" />
        <span className="text-[12.5px] text-white/38">Loading map data…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-[#0C1B30] border border-[#E11D48]/15 rounded-2xl px-4 py-4 flex items-center gap-3 mb-3" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
        <AlertCircle className="w-4 h-4 text-[#E11D48]/60 shrink-0" />
        <span className="text-[12.5px] text-white/45">Map data unavailable.</span>
      </div>
    );
  }

  const lat = data.lat ?? null;
  const lng = data.lng ?? null;
  const onSiteCrew = (data.crews ?? []).filter(c => c.onSite && c.lat != null && c.lng != null);
  const hasCoords = lat != null && lng != null;

  return (
    <div className="bg-[#0C1B30] border border-white/7 rounded-2xl overflow-hidden mb-3" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
      <div className="px-4 pt-3.5 pb-2.5 border-b border-white/5 flex items-center gap-2">
        <MapPin className="w-3 h-3 text-[#3B82F6]/60 shrink-0" />
        <span className="text-[9.5px] font-bold tracking-[0.2em] uppercase text-white/30">Property Map</span>
        {onSiteCrew.length > 0 && (
          <div className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#22C55E]/12 border border-[#22C55E]/20">
            <div className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" style={{ animation: 'h1Pulse 2s ease-in-out infinite' }} />
            <span className="text-[9.5px] font-bold text-[#22C55E]/80">{onSiteCrew.length} on site</span>
          </div>
        )}
      </div>

      {/* Embedded Leaflet map */}
      <div className="mx-4 my-3 rounded-xl overflow-hidden" style={{ height: 180 }}>
        {hasCoords ? (
          <MapContainer
            center={[lat, lng]}
            zoom={15}
            style={{ width: '100%', height: '100%' }}
            zoomControl={false}
            attributionControl={false}
            dragging={false}
            scrollWheelZoom={false}
            doubleClickZoom={false}
            touchZoom={false}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution=""
            />
            {/* Property marker */}
            <Marker position={[lat, lng]} icon={propertyIcon}>
              <Popup>{data.propertyName}</Popup>
            </Marker>
            {/* On-site crew dots — first name only, no trail, no contact */}
            {onSiteCrew.map((crew, i) => {
              const firstName = crew.crewName.split(' ')[0];
              return (
                <Marker
                  key={i}
                  position={[crew.lat!, crew.lng!]}
                  icon={makeCrewIcon(firstName, crew.onSite)}
                >
                  <Popup>
                    <span style={{ fontWeight: 600 }}>{firstName}</span>
                    {crew.unitNo ? ` · Unit ${crew.unitNo}` : ''}
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        ) : (
          /* No coords — show tap-to-open fallback */
          <button
            onClick={onNavigateMap}
            className="w-full h-full bg-[#050D1A] flex flex-col items-center justify-center gap-2"
          >
            <MapPin className="w-6 h-6 text-[#3B82F6]/50" />
            <span className="text-[12px] font-semibold text-white/40">No property coordinates configured</span>
            <span className="text-[10.5px] text-white/22">Open full map for details</span>
          </button>
        )}
      </div>

      {/* Crew summary — first name only */}
      {data.crews.length > 0 && (
        <div className="px-4 pb-3">
          <div className="text-[9.5px] font-bold tracking-[0.16em] uppercase text-white/22 mb-2">
            <Users className="inline w-2.5 h-2.5 mr-1 -mt-0.5" />
            Crew Today
          </div>
          <div className="space-y-2">
            {data.crews.slice(0, 4).map((crew, i) => {
              const firstName = crew.crewName.split(' ')[0];
              const statusColor = crew.onSite ? '#22C55E' : crew.status === 'scheduled' ? '#3B82F6' : 'rgba(255,255,255,0.35)';
              return (
                <div key={i} className="flex items-center gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-[#0A1628] border border-white/10 grid place-items-center shrink-0 overflow-hidden">
                    {crew.selfieUrl ? (
                      <img src={crew.selfieUrl} alt={firstName} className="w-full h-full object-cover"
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <span className="text-[9px] font-bold text-white/40">{firstName[0]}</span>
                    )}
                  </div>
                  <span className="text-[12px] font-medium text-white/70 flex-1">{firstName}</span>
                  {crew.unitNo && <span className="text-[10.5px] text-white/30">Unit {crew.unitNo}</span>}
                  <span className="text-[10px] font-semibold capitalize" style={{ color: statusColor }}>{crew.status}</span>
                </div>
              );
            })}
            {data.crews.length > 4 && (
              <div className="text-[10.5px] text-white/28">+{data.crews.length - 4} more crew assigned</div>
            )}
          </div>
        </div>
      )}

      <div className="border-t border-white/[0.04] px-4 py-2.5">
        <button onClick={onNavigateMap}
          className="flex items-center gap-1.5 text-[11.5px] text-white/35 hover:text-white/60 transition-colors">
          <ExternalLink className="w-3 h-3" />
          Open full map
        </button>
      </div>
    </div>
  );
}
