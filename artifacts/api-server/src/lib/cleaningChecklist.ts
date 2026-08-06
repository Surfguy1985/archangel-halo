/**
 * Archangel Turn Cleaning — Scope of Work Checklist
 *
 * This is the canonical checklist template uploaded by the office. It appears
 * in the crew portal for every job whose category or description includes
 * "clean" or "turn". Completion state is stored per (job, crew) in
 * cleaning_checklists. The PDF reference is served at
 * /api/docs/archangel-turn-cleaning-checklist.pdf.
 */

export interface CleaningChecklistItem {
  id: string;
  sectionId: string;
  label: string;
}

export interface CleaningChecklistSection {
  id: string;
  title: string;
  items: CleaningChecklistItem[];
}

export const CLEANING_CHECKLIST: CleaningChecklistSection[] = [
  {
    id: "kitchen",
    title: "Kitchen & Fixtures",
    items: [
      {
        id: "k1",
        sectionId: "kitchen",
        label:
          "Run all small items (light globes, drip pans, hood filters, appliance knobs, switch plates, vent covers) through a full dishwasher cycle — light globes free of insects",
      },
      {
        id: "k2",
        sectionId: "kitchen",
        label:
          "Soak fridge & oven racks in tub with degreaser; scrub, wipe dry, reinstall",
      },
      {
        id: "k3",
        sectionId: "kitchen",
        label: "Spray oven interior, let soak, scrub clean",
      },
      {
        id: "k4",
        sectionId: "kitchen",
        label: "Pull range — clean back, sides, wall, and floor beneath",
      },
      {
        id: "k5",
        sectionId: "kitchen",
        label: "Degrease range hood inside and out, including underside",
      },
      {
        id: "k6",
        sectionId: "kitchen",
        label:
          "Pull refrigerator (mind icemaker line) — clean top, sides, back, floor beneath; vacuum coils, wipe condensation pan",
      },
      {
        id: "k7",
        sectionId: "kitchen",
        label: "Clean fridge interior, including under crisper drawers",
      },
      {
        id: "k8",
        sectionId: "kitchen",
        label:
          "Wipe cabinets & drawers inside and out; clean cabinet tops; degrease fronts above range",
      },
      {
        id: "k9",
        sectionId: "kitchen",
        label: "Clean countertops spot-free and residue-free",
      },
      {
        id: "k10",
        sectionId: "kitchen",
        label: "Clean sink with non-abrasive cleaner; polish stainless",
      },
      {
        id: "k11",
        sectionId: "kitchen",
        label: "Empty dishwasher after cycle, wipe dry, reinstall all items",
      },
      {
        id: "k12",
        sectionId: "kitchen",
        label:
          "Clean kitchen floor, baseboards, and dishwasher panel with flooring-approved cleaner",
      },
    ],
  },
  {
    id: "bathrooms",
    title: "Bathrooms",
    items: [
      {
        id: "b1",
        sectionId: "bathrooms",
        label: "Report any mold or mildew immediately",
      },
      {
        id: "b2",
        sectionId: "bathrooms",
        label: "Spray tile & grout cleaner; let soak while working other areas",
      },
      {
        id: "b3",
        sectionId: "bathrooms",
        label:
          "Clean shower rod, towel bars, TP holder, and medicine cabinet",
      },
      {
        id: "b4",
        sectionId: "bathrooms",
        label:
          "Clean vanity inside & out; polish top, sink, and fixtures spot-free",
      },
      {
        id: "b5",
        sectionId: "bathrooms",
        label:
          "Clean tub and fixtures with non-abrasive cleaner; wipe dry",
      },
      {
        id: "b6",
        sectionId: "bathrooms",
        label:
          "Toilet: plunge water down, soak bowl cleaner under rim; clean exterior, tank, supply line, and cut-off valve; brush, flush, and rinse",
      },
      {
        id: "b7",
        sectionId: "bathrooms",
        label:
          "Clean mirror and light fixture, including individual bulbs",
      },
    ],
  },
  {
    id: "interior",
    title: "Interior — All Rooms",
    items: [
      {
        id: "i1",
        sectionId: "interior",
        label:
          "Clean washer & dryer inside and out, including lint traps; confirm drain line is seated",
      },
      {
        id: "i2",
        sectionId: "interior",
        label:
          "Wipe all doors, closet doors, shelves, and hanger racks spot-free",
      },
      {
        id: "i3",
        sectionId: "interior",
        label: "Clean ceiling fans and chandeliers thoroughly",
      },
      {
        id: "i4",
        sectionId: "interior",
        label: "Clean non-carpeted closet floors",
      },
      {
        id: "i5",
        sectionId: "interior",
        label: "Dust and clean furnace and furnace closet",
      },
      {
        id: "i6",
        sectionId: "interior",
        label: "Clean windows inside & out, including sills and frames",
      },
      {
        id: "i7",
        sectionId: "interior",
        label: "Clean blinds per manufacturer specs",
      },
      {
        id: "i8",
        sectionId: "interior",
        label: "Wipe down all baseboards",
      },
      {
        id: "i9",
        sectionId: "interior",
        label:
          "Vacuum entire unit, including fans and ceiling corners",
      },
      {
        id: "i10",
        sectionId: "interior",
        label: "Sweep out fireplace (if applicable)",
      },
    ],
  },
  {
    id: "exterior",
    title: "Exterior & Common Areas",
    items: [
      {
        id: "e1",
        sectionId: "exterior",
        label:
          "Clear, sweep, and hose off patio, balcony, and storage areas",
      },
      {
        id: "e2",
        sectionId: "exterior",
        label:
          "Clear breezeways of blown-in debris at entrances and under stairs",
      },
    ],
  },
];

export const CLEANING_CHECKLIST_ITEMS_FLAT: CleaningChecklistItem[] = CLEANING_CHECKLIST.flatMap((s) => s.items);

export const PDF_PATH = "/api/docs/archangel-turn-cleaning-checklist.pdf";

/** Returns true for jobs that should trigger the cleaning checklist. */
export function isCleaningJob(category?: string | null, description?: string | null): boolean {
  const hay = `${category ?? ""} ${description ?? ""}`.toLowerCase();
  return hay.includes("clean") || hay.includes("turn") || hay.includes("make ready") || hay.includes("make-ready");
}
