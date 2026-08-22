/** HALO Live API — wires building-ops, selection, messages, field photos */

export type Role = "portfolio" | "pulse" | "punchlist" | "field";

export const DEFAULT_PROPERTY =
  "49dec4b1-1dc5-4b59-8025-0c0bc14d35ce";

export type Plate = {
  ok: boolean;
  propertyId: string;
  propertyName: string;
  site: { lat: number; lng: number };
  summary: {
    headline: string;
    onSite: number;
    liveJobs: number;
    overdueTurns?: number;
    photoCount?: number;
  };
  buildings: Array<{
    building: number;
    label?: string;
    lat: number;
    lng: number;
    risk?: string;
    openTurns?: number;
    riskLabel?: string;
    unitCount?: number;
  }>;
  presence: Array<{
    crewId: string;
    crewName: string;
    lat: number | null;
    lng: number | null;
    onSite: boolean;
    building?: number | null;
    title?: string;
    unitNo?: string | null;
    jobId?: string | null;
  }>;
  units?: Array<{
    unitNo: string;
    building: number | null;
    status: string;
    jobId: string;
    jobNo?: string | null;
  }>;
  turnRadar?: Array<{
    jobId: string;
    jobNo?: string | null;
    unitNo?: string | null;
    building?: number | null;
    status: string;
    ageHours: number;
    risk: string;
    lat?: number | null;
    lng?: number | null;
  }>;
  photoBillboards?: Array<{
    id: string;
    unitNo?: string | null;
    building?: number | null;
    phase?: string | null;
    note?: string | null;
    storagePath?: string | null;
  }>;
  selection?: {
    building?: number | null;
    unitNo?: string | null;
    jobId?: string | null;
    source?: string;
  };
};

const base = () => (typeof window !== "undefined" ? "" : "https://archangel-halo.replit.app");

export async function fetchPlate(propertyId = DEFAULT_PROPERTY): Promise<Plate> {
  const res = await fetch(`${base()}/api/properties/${propertyId}/building-ops`);
  if (!res.ok) throw new Error(`Plate ${res.status}`);
  return res.json();
}

export async function setSelection(
  propertyId: string,
  body: { building?: number | null; unitNo?: string | null; jobId?: string | null; source?: string },
) {
  await fetch(`${base()}/api/properties/${propertyId}/selection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "halo-live", ...body }),
  });
}

/** Marketing images — Unsplash (free) with optional Shutterstock later */
export const marketingPhotos = {
  hero: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1600&q=80",
  crew: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=1200&q=80",
  unit: "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80",
  map: "https://images.unsplash.com/photo-1524661135-423995f22d0b?auto=format&fit=crop&w=1200&q=80",
  before: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=800&q=80",
  after: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80",
};
