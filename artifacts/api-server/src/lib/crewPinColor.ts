/**
 * What colour a person's pin is, decided once on the server.
 *
 * Six maps draw crew pins and every one of them used to colour by check-in
 * status alone, so a screen full of people told you who had checked in and
 * nothing about who they were. The office reads the map by team: Archangel's
 * own staff are gold, and everyone who works under a foreman carries that
 * foreman's colour so a whole crew reads as one unit at a glance.
 *
 * The rule, in order:
 *   1. Archangel owners and employees  → gold.
 *   2. Anyone reporting to a foreman   → that foreman's colour.
 *   3. A foreman, or an independent    → their saved colour, else a stable
 *                                        one picked from the palette.
 *
 * Status still shows on the pin, as a small badge — it just no longer owns
 * the whole dot.
 */

/** Archangel owners and employees. One colour, never handed to a sub. */
export const ARCHANGEL_GOLD = "#E9B824";

/**
 * Foreman colours. Picked to stay apart from each other and from the gold at
 * a glance on a satellite map, and to survive being shrunk to a 36px dot.
 */
export const TEAM_PALETTE = [
  "#3B82F6", // blue
  "#EC4899", // pink
  "#8B5CF6", // violet
  "#14B8A6", // teal
  "#F97316", // orange
  "#06B6D4", // cyan
  "#A3E635", // lime
  "#EF4444", // red
  "#6366F1", // indigo
  "#D946EF", // fuchsia
] as const;

/** Someone with no team and no saved colour still needs to be visible. */
export const UNASSIGNED_PIN = "#94A3B8";

/** Roles that mean "works for Archangel", not for a sub. */
const STAFF_ROLES = new Set(["owner", "employee", "office", "admin", "staff"]);

export function isArchangelStaff(role: string | null | undefined): boolean {
  return STAFF_ROLES.has((role ?? "").trim().toLowerCase());
}

/** Roles that lead a team. `isLeader` says the same thing structurally. */
const LEADER_ROLES = new Set(["foreman", "superintendent", "lead"]);

export function isForeman(crew: {
  role?: string | null;
  isLeader?: boolean | null;
}): boolean {
  return crew.isLeader === true || LEADER_ROLES.has((crew.role ?? "").trim().toLowerCase());
}

/** Stable palette slot, so a foreman keeps the same colour without a saved one. */
function paletteFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return TEAM_PALETTE[hash % TEAM_PALETTE.length]!;
}

const normalizeHex = (value: string | null | undefined): string | null => {
  const hex = value?.trim();
  return hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : null;
};

export type CrewColorInput = {
  id: string;
  role?: string | null;
  isLeader?: boolean | null;
  leaderId?: string | null;
  pinColor?: string | null;
};

/**
 * Resolves every crew's pin colour in one pass, because a member's colour is
 * their foreman's and that can only be answered with the whole roster in hand.
 * Returns a map of crew id → hex.
 */
export function buildCrewPinColors(crews: CrewColorInput[]): Map<string, string> {
  const byId = new Map(crews.map((c) => [c.id, c]));
  const resolved = new Map<string, string>();

  const colorOf = (crew: CrewColorInput, seen: Set<string>): string => {
    // Staff wins over everything, including a colour someone saved on the row
    // and any team they happen to sit under: gold means Archangel, always.
    if (isArchangelStaff(crew.role)) return ARCHANGEL_GOLD;

    // Members wear their foreman's colour — their own saved colour is ignored
    // on purpose, or a team stops reading as one unit. Walks the chain in case
    // a member reports to a member. The guard is for a leader chain that points
    // at itself or loops: there are no FKs here, so that can happen.
    if (crew.leaderId && crew.leaderId !== crew.id && !seen.has(crew.leaderId)) {
      const leader = byId.get(crew.leaderId);
      if (leader) {
        seen.add(crew.leaderId);
        return resolved.get(leader.id) ?? colorOf(leader, seen);
      }
    }

    const saved = normalizeHex(crew.pinColor);
    if (saved) return saved;

    if (isForeman(crew)) return paletteFor(crew.id);
    return UNASSIGNED_PIN;
  };

  // Foremen first, so a member's lookup finds a settled leader colour.
  const order = [...crews].sort(
    (a, b) => Number(!!a.leaderId) - Number(!!b.leaderId),
  );
  for (const crew of order) resolved.set(crew.id, colorOf(crew, new Set([crew.id])));
  return resolved;
}

/** Single-crew convenience for endpoints that already hold the leader row. */
export function crewPinColor(crew: CrewColorInput, leader?: CrewColorInput | null): string {
  const roster = leader ? [crew, leader] : [crew];
  return buildCrewPinColors(roster).get(crew.id) ?? UNASSIGNED_PIN;
}
