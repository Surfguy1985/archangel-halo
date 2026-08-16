/**
 * Ask media tiles — ChatGPT-style proof boxes.
 * Photos are Base44 evidence already on the board. Maps are Carto tiles
 * (same Voyager set as Pulse). Never invent a picture.
 */

export type AskCard = {
  id: string;
  kind: "pair" | "photo" | "map" | "site";
  title: string;
  caption: string;
  src?: string;
  before?: string;
  after?: string;
  action?: { type: "open"; panel: "photos" } | { type: "select"; propertyId: string };
};

export type GuidePhoto = {
  propertyId?: string | null;
  propertyName: string;
  unitNumber: string;
  beforeUrl?: string;
  afterUrl?: string;
};

type MapSite = {
  propertyId: string;
  name: string;
  city?: string | null;
  unitsInTurn: number;
  latitude?: number | null;
  longitude?: number | null;
};

export function clipAsk(text: string, max = 4): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return clean;
  const parts = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.slice(0, max).join(" ");
}

export function staticMapSrc(lat: number, lng: number, zoom = 15): string {
  const z = zoom;
  const x = lon2tile(lng, z);
  const y = lat2tile(lat, z);
  return `https://a.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}@2x.png`;
}

function lon2tile(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

function lat2tile(lat: number, zoom: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom,
  );
}

function shortName(name: string): string {
  return name.replace(/^caf\s+demo\s*[—–-]\s*/i, "").trim();
}

function photoFor(
  photos: GuidePhoto[],
  propertyId?: string,
  unitNumber?: string,
): GuidePhoto | undefined {
  if (unitNumber) {
    const hit = photos.find(
      (p) =>
        p.unitNumber.toLowerCase() === unitNumber.toLowerCase() &&
        (!propertyId || !p.propertyId || p.propertyId === propertyId),
    );
    if (hit) return hit;
  }
  if (propertyId) return photos.find((p) => p.propertyId === propertyId);
  return photos[0];
}

function mapCard(site: MapSite): AskCard | null {
  if (site.latitude == null || site.longitude == null) return null;
  return {
    id: `map-${site.propertyId}`,
    kind: "map",
    title: shortName(site.name),
    caption: site.city ? `${site.city} · ${site.unitsInTurn} in turn` : `${site.unitsInTurn} in turn`,
    src: staticMapSrc(site.latitude, site.longitude),
    action: { type: "select", propertyId: site.propertyId },
  };
}

function pairCard(photo: GuidePhoto): AskCard | null {
  if (!photo.beforeUrl && !photo.afterUrl) return null;
  if (photo.beforeUrl && photo.afterUrl) {
    return {
      id: `pair-${photo.propertyId ?? photo.propertyName}-${photo.unitNumber}`,
      kind: "pair",
      title: `${shortName(photo.propertyName)} · ${photo.unitNumber}`,
      caption: "Before / after",
      before: photo.beforeUrl,
      after: photo.afterUrl,
      action: { type: "open", panel: "photos" },
    };
  }
  return {
    id: `photo-${photo.propertyId ?? photo.propertyName}-${photo.unitNumber}`,
    kind: "photo",
    title: `${shortName(photo.propertyName)} · ${photo.unitNumber}`,
    caption: photo.afterUrl ? "After" : "Before",
    src: photo.afterUrl ?? photo.beforeUrl,
    action: { type: "open", panel: "photos" },
  };
}

export function pickAskCards(args: {
  photos?: GuidePhoto[];
  sites?: MapSite[];
  site?: MapSite;
  unit?: { propertyId: string; unitNumber: string };
  need?: { propertyId: string; unitNumber: string };
  wantPhotos?: boolean;
  wantMap?: boolean;
}): AskCard[] {
  const cards: AskCard[] = [];
  const photos = args.photos ?? [];
  const sites = args.sites ?? [];
  const site =
    args.site ??
    (args.unit ? sites.find((s) => s.propertyId === args.unit!.propertyId) : undefined) ??
    (args.need ? sites.find((s) => s.propertyId === args.need!.propertyId) : undefined);

  if (args.wantPhotos || args.unit || args.need) {
    const photo = photoFor(
      photos,
      site?.propertyId ?? args.unit?.propertyId,
      args.unit?.unitNumber ?? args.need?.unitNumber,
    );
    const pair = photo ? pairCard(photo) : null;
    if (pair) cards.push(pair);
    else if (args.wantPhotos) {
      for (const p of photos.slice(0, 2)) {
        const c = pairCard(p);
        if (c) cards.push(c);
      }
    }
  }

  if ((args.wantMap || args.site || args.unit || args.need) && site) {
    const map = mapCard(site);
    if (map) cards.push(map);
  }

  return cards.slice(0, 3);
}
