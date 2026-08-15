/**
 * Evidence ledger — pairing, integrity copy, Merkle verification.
 * The hash is what makes a Unit Turn Record usable in a deposit dispute.
 */

import { createHash } from "node:crypto";

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return sha256Hex("");
  let layer = [...leaves].sort().map((leaf) => sha256Hex(leaf));
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]!;
      const right = layer[i + 1] ?? left;
      next.push(sha256Hex(`${left}${right}`));
    }
    layer = next;
  }
  return layer[0]!;
}

export type EvidenceLeaf = { id: string; sha256: string };
export type TimelineLeaf = {
  id: string;
  stage: string;
  event: string;
  occurredAt: string;
};

export function turnVerificationLeaves(input: {
  evidence: EvidenceLeaf[];
  timeline: TimelineLeaf[];
}): string[] {
  return [
    ...input.evidence.map((e) => `e:${e.id}:${e.sha256}`),
    ...input.timeline.map((t) => `t:${t.id}:${t.stage}:${t.event}:${t.occurredAt}`),
  ];
}

export function computeTurnVerificationHash(input: {
  evidence: EvidenceLeaf[];
  timeline: TimelineLeaf[];
}): string {
  return merkleRoot(turnVerificationLeaves(input));
}

export function roomSortKey(room: string | null | undefined): [number, string] {
  const raw = (room ?? "other").trim().toLowerCase();
  if (raw === "living" || raw === "living room") return [0, raw];
  if (raw === "kitchen") return [1, raw];
  const bed = raw.match(/^bed(?:room)?\s*(\d+)$/);
  if (bed) return [10 + Number(bed[1]), raw];
  const bath = raw.match(/^bath(?:room)?\s*(\d+)$/);
  if (bath) return [40 + Number(bath[1]), raw];
  if (raw === "exterior" || raw === "patio" || raw === "exterior/patio") return [80, raw];
  return [90, raw || "other"];
}

export function compareRooms(a: string | null | undefined, b: string | null | undefined): number {
  const [ra, sa] = roomSortKey(a);
  const [rb, sb] = roomSortKey(b);
  if (ra !== rb) return ra - rb;
  return sa.localeCompare(sb);
}

export function roomLabel(room: string | null | undefined): string {
  const raw = (room ?? "other").trim();
  if (!raw) return "Other";
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

export type IntegrityFlagCode =
  | "device_clock_skew_seconds"
  | "gps_outside_geofence"
  | "exif_missing"
  | "duplicate_hash";

export type IntegrityFlagView = {
  code: IntegrityFlagCode;
  explanation: string;
};

export function explainIntegrityFlags(
  flags: {
    device_clock_skew_seconds?: number;
    gps_outside_geofence?: boolean;
    exif_missing?: boolean;
    duplicate_hash?: boolean;
  } | null | undefined,
  distanceM: number | null,
): IntegrityFlagView[] {
  if (!flags) return [];
  const out: IntegrityFlagView[] = [];
  if (typeof flags.device_clock_skew_seconds === "number") {
    const skew = Math.abs(Math.round(flags.device_clock_skew_seconds));
    const minutes = Math.round(skew / 60);
    out.push({
      code: "device_clock_skew_seconds",
      explanation:
        minutes >= 1
          ? `Device clock was ${minutes} minute${minutes === 1 ? "" : "s"} off the server`
          : `Device clock was ${skew} seconds off the server`,
    });
  }
  if (flags.gps_outside_geofence) {
    const meters = distanceM != null ? Math.round(distanceM) : null;
    out.push({
      code: "gps_outside_geofence",
      explanation:
        meters != null
          ? `Location was ${meters}m from the unit`
          : "Location was outside the unit geofence",
    });
  }
  if (flags.exif_missing) {
    out.push({
      code: "exif_missing",
      explanation: "This photo has no camera metadata",
    });
  }
  if (flags.duplicate_hash) {
    out.push({
      code: "duplicate_hash",
      explanation: "This file matches another photo on this turn",
    });
  }
  return out;
}

export function haversineM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const r = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const DEFAULT_GEOFENCE_M = 50;

export type EvidencePhase = "before" | "during" | "after" | "qc";

export function pairRooms<T extends { room: string | null; phase: string }>(
  items: T[],
): Array<{
  room: string;
  before: T[];
  after: T[];
  during: T[];
  qc: T[];
}> {
  const byRoom = new Map<string, T[]>();
  for (const item of items) {
    const key = (item.room ?? "other").trim() || "other";
    const list = byRoom.get(key) ?? [];
    list.push(item);
    byRoom.set(key, list);
  }
  return [...byRoom.entries()]
    .sort((a, b) => compareRooms(a[0], b[0]))
    .map(([room, list]) => ({
      room,
      before: list.filter((i) => i.phase === "before"),
      after: list.filter((i) => i.phase === "after"),
      during: list.filter((i) => i.phase === "during"),
      qc: list.filter((i) => i.phase === "qc"),
    }));
}
