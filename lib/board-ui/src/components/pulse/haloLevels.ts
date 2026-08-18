/** One HALO system, three desks. */

export type HaloStoryLevel = "portfolio" | "pulse" | "punchlist";

export type HaloStoryDesk = {
  id: HaloStoryLevel;
  kicker: string;
  title: string;
  who: string;
  person: string;
  line: string;
  mark: string;
  tone: "navy" | "lime" | "gold";
};

export const HALO_STORY: Record<HaloStoryLevel, HaloStoryDesk> = {
  portfolio: {
    id: "portfolio",
    kicker: "Corporate",
    title: "Portfolio",
    who: "The region",
    person: "Camille Hart",
    line: "Vacancy, turns, the board pack.",
    mark: "P",
    tone: "navy",
  },
  pulse: {
    id: "pulse",
    kicker: "Property manager",
    title: "Pulse",
    who: "This morning",
    person: "Elena Ruiz",
    line: "Units, crews, what needs a name.",
    mark: "●",
    tone: "lime",
  },
  punchlist: {
    id: "punchlist",
    kicker: "Archangel Contractors",
    title: "Punchlist",
    who: "The field",
    person: "Marcus Hale",
    line: "Where to go. What is waiting.",
    mark: "A",
    tone: "gold",
  },
};

export const HALO_STORY_ORDER: HaloStoryLevel[] = ["portfolio", "pulse", "punchlist"];

export function haloStoryTitle(level: HaloStoryLevel): string {
  if (level === "portfolio") return "Property Portfolio";
  if (level === "punchlist") return "Property Punchlist";
  return "Property Pulse";
}

export function haloStoryHref(level: HaloStoryLevel): string {
  if (level === "portfolio") return "/";
  if (level === "punchlist") return "/punchlist";
  return "/pulse";
}
