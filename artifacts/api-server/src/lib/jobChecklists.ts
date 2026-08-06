/**
 * Archangel Job-Specific Checklists
 *
 * Three scope-of-work checklists for non-cleaning job types. Each mirrors the
 * printed Archangel Contractors PDF document for that trade.
 *
 * Detection priority (checked in this order before the cleaning fallback):
 *   carpet     → job category/description contains "carpet"
 *   painting   → contains "paint"
 *   make_ready → contains "make ready", "make-ready", "punch", or "unit punch"
 *
 * Completion state is stored per (job_id, crew_id, checklist_type) in the
 * job_checklists table. Agreement is recorded in agreed_at / agreed_by.
 */

export type JobChecklistType = "carpet" | "make_ready" | "painting";

export interface JobChecklistItem {
  id: string;
  sectionId: string;
  label: string;
}

export interface JobChecklistSection {
  id: string;
  title: string;
  items: JobChecklistItem[];
}

// ─── Carpet Cleaning ──────────────────────────────────────────────────────────

export const CARPET_CHECKLIST: JobChecklistSection[] = [
  {
    id: "setup",
    title: "Setup & Inspection",
    items: [
      { id: "ca1", sectionId: "setup", label: "Occupied units: place plastic strips or foam blocks under furniture legs" },
      { id: "ca2", sectionId: "setup", label: "Inspect carpet thoroughly and note all needed repairs" },
      { id: "ca3", sectionId: "setup", label: "Sweep wall perimeter with stiff brush to loosen dust at baseboards and corners, then vacuum — vacuum must have a hose attachment for baseboards" },
      { id: "ca4", sectionId: "setup", label: "Use corner guards to protect baseboards and walls" },
    ],
  },
  {
    id: "pretreat",
    title: "Pre-Treatment",
    items: [
      { id: "ca5", sectionId: "pretreat", label: "Pre-spot all stains per manufacturer's recommendations" },
      { id: "ca6", sectionId: "pretreat", label: "Remove red dye stains with proper chemicals and procedures" },
      { id: "ca7", sectionId: "pretreat", label: "Spray pre-spotter on traffic-area stains to loosen; follow all manufacturer instructions" },
    ],
  },
  {
    id: "steam",
    title: "Steam Cleaning",
    items: [
      { id: "ca8", sectionId: "steam", label: "Steam clean with hot water extraction — work ~16 sq ft at a time: spray solution, extract with suction wand, repeat through unit" },
      { id: "ca9", sectionId: "steam", label: "Do not over-saturate the carpet" },
      { id: "ca10", sectionId: "steam", label: "Wipe solution and foam off furniture legs and woodwork immediately to prevent damage" },
      { id: "ca11", sectionId: "steam", label: "Deodorize carpet" },
      { id: "ca12", sectionId: "steam", label: "Hand-rake all carpeted areas for a uniform appearance" },
      { id: "ca13", sectionId: "steam", label: "Stretch carpet as needed" },
    ],
  },
  {
    id: "closeout",
    title: "Close-Out",
    items: [
      { id: "ca14", sectionId: "closeout", label: "Clean any floors, sinks, or tubs used to service the equipment" },
      { id: "ca15", sectionId: "closeout", label: "Leave closet doors open so carpet can dry" },
      { id: "ca16", sectionId: "closeout", label: "Set thermostat as directed by Owner" },
      { id: "ca17", sectionId: "closeout", label: "Turn off all lights" },
    ],
  },
];

// ─── Make-Ready / Unit Punch ──────────────────────────────────────────────────

export const MAKE_READY_CHECKLIST: JobChecklistSection[] = [
  {
    id: "electrical",
    title: "Electrical",
    items: [
      { id: "mr1", sectionId: "electrical", label: "Test all fixtures, switches, outlets, and GFCIs" },
      { id: "mr2", sectionId: "electrical", label: "Breaker box: all circuits labeled, no open knockouts" },
      { id: "mr3", sectionId: "electrical", label: "All detectors mounted securely" },
      { id: "mr4", sectionId: "electrical", label: "New batteries in all smoke/CO detectors; test function" },
    ],
  },
  {
    id: "entrance",
    title: "Entrance",
    items: [
      { id: "mr5", sectionId: "entrance", label: "Test doorbell/intercom and peephole" },
      { id: "mr6", sectionId: "entrance", label: "Door locks and latches work and are installed correctly" },
      { id: "mr7", sectionId: "entrance", label: "Hardware secure, clean, paint-free; resident-added hardware removed" },
      { id: "mr8", sectionId: "entrance", label: "Doorstop present — install if missing" },
      { id: "mr9", sectionId: "entrance", label: "Door face free of dents, scratches, and scuffs" },
      { id: "mr10", sectionId: "entrance", label: "Door opens/closes easily and seals tight when closed" },
      { id: "mr11", sectionId: "entrance", label: "Sweep, weather stripping, and threshold in good condition — replace or secure as needed" },
      { id: "mr12", sectionId: "entrance", label: "Doorjamb free of cracked/split wood; handrails clean and secure" },
    ],
  },
  {
    id: "living",
    title: "Living Room",
    items: [
      { id: "mr13", sectionId: "living", label: "Light fixtures secure and functional" },
      { id: "mr14", sectionId: "living", label: "Outlets, switches, and covers — no cracks or charring" },
      { id: "mr15", sectionId: "living", label: "Ceiling fans balanced, clean, and functional" },
      { id: "mr16", sectionId: "living", label: "Closet door and shelving in good condition" },
      { id: "mr17", sectionId: "living", label: "Cable, phone, and data connections work" },
      { id: "mr18", sectionId: "living", label: "Fireplace: damper and screen function properly; hearth and mantle damage-free" },
      { id: "mr19", sectionId: "living", label: "Log cradle and insert — repaint with high-heat paint if needed; clean all vents" },
    ],
  },
  {
    id: "windows",
    title: "Windows, Patio Doors & Blinds",
    items: [
      { id: "mr20", sectionId: "windows", label: "No broken or cracked glass; glazing secure in frame" },
      { id: "mr21", sectionId: "windows", label: "Working locks on all windows and sliders; open and close easily" },
      { id: "mr22", sectionId: "windows", label: "Vertical sliding windows stay open on their own" },
      { id: "mr23", sectionId: "windows", label: "Screens fit properly with no tears" },
      { id: "mr24", sectionId: "windows", label: "Door and window seals good — repair as needed" },
      { id: "mr25", sectionId: "windows", label: "Window sills: check for water intrusion, repair as needed" },
      { id: "mr26", sectionId: "windows", label: "Deck railing brackets, screws, and bolts tight" },
      { id: "mr27", sectionId: "windows", label: "Cord safety: loop cords cut with tassels on each end; cord stops within 1\" of head rail; cords tangle-free, never tied; vertical loop chains anchored to wall" },
      { id: "mr28", sectionId: "windows", label: "Blinds open and close smoothly — replace bent, broken, or missing slats" },
    ],
  },
  {
    id: "bedrooms",
    title: "Bedrooms",
    items: [
      { id: "mr29", sectionId: "bedrooms", label: "Light fixtures function properly" },
      { id: "mr30", sectionId: "bedrooms", label: "Outlets, switches, covers — no cracks or charring; \"half-hot\" outlets work" },
      { id: "mr31", sectionId: "bedrooms", label: "Closet doors: tracks, rollers, and glides operate properly" },
      { id: "mr32", sectionId: "bedrooms", label: "Shelving and clothes rod damage-free" },
      { id: "mr33", sectionId: "bedrooms", label: "Doors latch properly; hinges good; passage knobs on all bedroom doors" },
      { id: "mr34", sectionId: "bedrooms", label: "Cable, phone, and data connections work" },
      { id: "mr35", sectionId: "bedrooms", label: "Window sills damage-free; weather stripping in good condition" },
    ],
  },
  {
    id: "laundry",
    title: "Laundry",
    items: [
      { id: "mr36", sectionId: "laundry", label: "Washer: run full cycle; supply lines free of leaks/bulges (replace every 5–7 yrs)" },
      { id: "mr37", sectionId: "laundry", label: "Washer drain hose strapped or zip-tied to wall drain" },
      { id: "mr38", sectionId: "laundry", label: "Dryer heats properly; knobs in good condition" },
      { id: "mr39", sectionId: "laundry", label: "Vent hose: no kinks, secured at both ends, cleaned — excess lint means an exhaust leak" },
      { id: "mr40", sectionId: "laundry", label: "Clean lint trap and dryer vent line" },
    ],
  },
  {
    id: "kitchen_cabinets",
    title: "Kitchen — Cabinets & Counters",
    items: [
      { id: "mr41", sectionId: "kitchen_cabinets", label: "Doors and drawers open/close easily; handles, pulls, and hinges secure and adjusted" },
      { id: "mr42", sectionId: "kitchen_cabinets", label: "No water damage or staining, including under the sink" },
      { id: "mr43", sectionId: "kitchen_cabinets", label: "Cabinet fronts and interiors damage-free; paint cabinet interiors" },
      { id: "mr44", sectionId: "kitchen_cabinets", label: "All shelving pins installed" },
      { id: "mr45", sectionId: "kitchen_cabinets", label: "Countertop free of wear and burns; recaulk as needed" },
    ],
  },
  {
    id: "dishwasher",
    title: "Dishwasher",
    items: [
      { id: "mr46", sectionId: "dishwasher", label: "Run full cycle at start of turn — no leaks, heat element works, no water left in sump" },
      { id: "mr47", sectionId: "dishwasher", label: "Door opens, closes, and seals; gasket intact and pliable" },
      { id: "mr48", sectionId: "dishwasher", label: "Soap dispenser latches, then opens during cycle" },
      { id: "mr49", sectionId: "dishwasher", label: "Racks slide smoothly; knobs and control panel good" },
      { id: "mr50", sectionId: "dishwasher", label: "Kick plate secure; unit anchored to counter" },
      { id: "mr51", sectionId: "dishwasher", label: "Air gap and return hose inspected and clean" },
    ],
  },
  {
    id: "disposal_sink",
    title: "Disposal, Sink & Faucet",
    items: [
      { id: "mr52", sectionId: "disposal_sink", label: "Disposal runs freely with no obstructions; no leaks under sink; strainer and stopper present" },
      { id: "mr53", sectionId: "disposal_sink", label: "Faucet turns easily, no corrosion or leaks; drains open and free-flowing" },
      { id: "mr54", sectionId: "disposal_sink", label: "Hot water within local code limits" },
      { id: "mr55", sectionId: "disposal_sink", label: "Aerator clean; sprayer pattern and pressure good" },
      { id: "mr56", sectionId: "disposal_sink", label: "Air gaps cleared" },
    ],
  },
  {
    id: "range",
    title: "Range, Oven, Hood & Microwave",
    items: [
      { id: "mr57", sectionId: "range", label: "Bake, broiler, and all stovetop elements work" },
      { id: "mr58", sectionId: "range", label: "Oven door opens, closes, and seals; door seal undamaged" },
      { id: "mr59", sectionId: "range", label: "Oven and hood lights work; all indicator lights function" },
      { id: "mr60", sectionId: "range", label: "Oven sits level, no rocking; racks and knobs in good condition" },
      { id: "mr61", sectionId: "range", label: "Install new drip pans" },
      { id: "mr62", sectionId: "range", label: "Hood fan operates properly; filter cleaned or replaced" },
      { id: "mr63", sectionId: "range", label: "Microwave operational — handle, frame, door, bulb, cover, tray" },
    ],
  },
  {
    id: "refrigerator",
    title: "Refrigerator",
    items: [
      { id: "mr64", sectionId: "refrigerator", label: "Door seals good; shelves free of rust and discoloration" },
      { id: "mr65", sectionId: "refrigerator", label: "Light works with proper 40W bulb" },
      { id: "mr66", sectionId: "refrigerator", label: "Condensation pan, condenser coils, and fan clean and ventilated" },
      { id: "mr67", sectionId: "refrigerator", label: "Icemaker hose connected — if no icemaker, 2 ice trays in freezer" },
      { id: "mr68", sectionId: "refrigerator", label: "Level with no rocking; handles secure; no leaks" },
      { id: "mr69", sectionId: "refrigerator", label: "Set thermostat to warmest setting" },
    ],
  },
  {
    id: "bath_sink",
    title: "Bath — Sink & Vanity",
    items: [
      { id: "mr70", sectionId: "bath_sink", label: "Faucet turns on easily, no corrosion or leaks; drains clear and open" },
      { id: "mr71", sectionId: "bath_sink", label: "Drain lines leak-free; pop-up assemblies and P-trap clean" },
      { id: "mr72", sectionId: "bath_sink", label: "Repair sink chips with porcelain repair kit" },
      { id: "mr73", sectionId: "bath_sink", label: "Replace cracked or discolored vanity-top caulk; no cabinet water damage" },
      { id: "mr74", sectionId: "bath_sink", label: "Aerator clean; air gaps cleared" },
    ],
  },
  {
    id: "toilets",
    title: "Toilets",
    items: [
      { id: "mr75", sectionId: "toilets", label: "Flush — handle operates freely; fill valve shuts off at correct level" },
      { id: "mr76", sectionId: "toilets", label: "Tank bolts leak-free" },
      { id: "mr77", sectionId: "toilets", label: "Replace the flapper" },
      { id: "mr78", sectionId: "toilets", label: "Recaulk base if needed (front and sides only)" },
      { id: "mr79", sectionId: "toilets", label: "Seat tight — replace if broken or discolored; both bolt caps in place" },
    ],
  },
  {
    id: "bathtubs",
    title: "Bathtubs & Showers",
    items: [
      { id: "mr80", sectionId: "bathtubs", label: "Recaulk tub/shower, spout, and escutcheon plates as needed" },
      { id: "mr81", sectionId: "bathtubs", label: "Shower arm and escutcheon rust-free; repair chipped porcelain and cracked grout" },
      { id: "mr82", sectionId: "bathtubs", label: "Install corner guards on tub ledges if needed" },
      { id: "mr83", sectionId: "bathtubs", label: "Tub holds water and drains properly; shoe and stop clean — replace if rusted" },
      { id: "mr84", sectionId: "bathtubs", label: "Enclosure doors and curtain rod secure and smooth" },
      { id: "mr85", sectionId: "bathtubs", label: "Shower valve leak-free; diverter works; hot and cold correct" },
      { id: "mr86", sectionId: "bathtubs", label: "Shower head spray even — clean or install new head if weak" },
    ],
  },
  {
    id: "bath_general",
    title: "Bath — General",
    items: [
      { id: "mr87", sectionId: "bath_general", label: "Light fixtures secure; exhaust fan cleaned, cover cleaned, motor lubricated" },
      { id: "mr88", sectionId: "bath_general", label: "Mirror and medicine cabinet free of cracks and discoloration" },
      { id: "mr89", sectionId: "bath_general", label: "Towel bars and toilet paper holder secure — replace as needed" },
      { id: "mr90", sectionId: "bath_general", label: "Door hinges rust-free; drawers smooth; vanity top undamaged" },
      { id: "mr91", sectionId: "bath_general", label: "Privacy lock installed; door latches smoothly" },
    ],
  },
  {
    id: "hvac",
    title: "HVAC & Water Heater",
    items: [
      { id: "mr92", sectionId: "hvac", label: "Replace furnace and A/C filters" },
      { id: "mr93", sectionId: "hvac", label: "Test heat and cool modes — vents blow hot/cold as set" },
      { id: "mr94", sectionId: "hvac", label: "Gas furnace: steady blue flame; check pilot, thermocouple, burner; inspect heat exchanger and flue; compartment covers tight" },
      { id: "mr95", sectionId: "hvac", label: "Clear condensation lines; test overflow switch; add tablet to pan; condenser coils clean" },
      { id: "mr96", sectionId: "hvac", label: "Water heater: test T&P relief; valve pipe ends within 6\" of floor and plumbed outside per code" },
      { id: "mr97", sectionId: "hvac", label: "Tank and pan leak-free; all valves open and close fully" },
      { id: "mr98", sectionId: "hvac", label: "Gas heater: tight flue, no backdraft, steady blue flame • Electric: ohm-test elements" },
      { id: "mr99", sectionId: "hvac", label: "Set thermostat per Owner: 55° heat / 80° cool" },
    ],
  },
  {
    id: "final",
    title: "Final Items & Safety Verification",
    items: [
      { id: "mr100", sectionId: "final", label: "Paint front door and patio/balcony (paint provided by Owner)" },
      { id: "mr101", sectionId: "final", label: "Check smart-home devices — front door batteries, leak sensors, smart plug, and hub" },
      { id: "mr102", sectionId: "final", label: "SAFETY: verify all blind pull cords meet safety requirements" },
      { id: "mr103", sectionId: "final", label: "SAFETY: smoke/CO detectors tested with new batteries; all windows and exterior doors have working locks" },
    ],
  },
];

// ─── Painting ─────────────────────────────────────────────────────────────────

export const PAINTING_CHECKLIST: JobChecklistSection[] = [
  {
    id: "prep",
    title: "Prep Work",
    items: [
      { id: "pa1", sectionId: "prep", label: "Remove all nails, screws, and hooks from walls and ceilings" },
      { id: "pa2", sectionId: "prep", label: "Remove all electrical wall plates" },
      { id: "pa3", sectionId: "prep", label: "Carefully remove window coverings and store them properly" },
      { id: "pa4", sectionId: "prep", label: "Protect all fire/CO alarms, sprinklers, and phone jacks" },
      { id: "pa5", sectionId: "prep", label: "Wear proper personal protective equipment at all times" },
      { id: "pa6", sectionId: "prep", label: "Repairs, TBT, Kilz, and baseboard replacement included in base price unless otherwise agreed with Owner" },
    ],
  },
  {
    id: "painting",
    title: "Painting & Materials",
    items: [
      { id: "pa7", sectionId: "painting", label: "Paint all currently painted surfaces — walls, baseboards, doors, doorjambs, closet walls, and window ledges" },
      { id: "pa8", sectionId: "painting", label: "Excluded: closet shelves, cabinet interiors, and ceilings" },
      { id: "pa9", sectionId: "painting", label: "Apply by roller or brush as directed by Owner" },
      { id: "pa10", sectionId: "painting", label: "Use only Owner-specified paint, primer, and supplies" },
      { id: "pa11", sectionId: "painting", label: "All repairs included in base price unless otherwise agreed with Owner" },
    ],
  },
  {
    id: "spraying",
    title: "If Spraying",
    items: [
      { id: "pa12", sectionId: "spraying", label: "Provide respirators, goggles, and safety equipment to all crew" },
      { id: "pa13", sectionId: "spraying", label: "Fully cover all flooring, cabinets, countertops, fixtures, appliances, wall plates, doorknobs, smoke detectors, and sprinkler heads" },
    ],
  },
  {
    id: "closeout",
    title: "Clean-Up & Close-Out",
    items: [
      { id: "pa14", sectionId: "closeout", label: "Clean all spills, drips, and overspray" },
      { id: "pa15", sectionId: "closeout", label: "Replace all electrical wall plates" },
      { id: "pa16", sectionId: "closeout", label: "Leave interior doors open to dry; close and lock front & rear doors on completion" },
      { id: "pa17", sectionId: "closeout", label: "Secure all windows and doors" },
      { id: "pa18", sectionId: "closeout", label: "Set thermostat as directed by Owner" },
      { id: "pa19", sectionId: "closeout", label: "Turn off all lights" },
    ],
  },
];

// ─── Registry ─────────────────────────────────────────────────────────────────

export const JOB_CHECKLISTS: Record<JobChecklistType, JobChecklistSection[]> = {
  carpet: CARPET_CHECKLIST,
  make_ready: MAKE_READY_CHECKLIST,
  painting: PAINTING_CHECKLIST,
};

export const JOB_CHECKLIST_ITEMS_FLAT: Record<JobChecklistType, JobChecklistItem[]> = {
  carpet: CARPET_CHECKLIST.flatMap((s) => s.items),
  make_ready: MAKE_READY_CHECKLIST.flatMap((s) => s.items),
  painting: PAINTING_CHECKLIST.flatMap((s) => s.items),
};

export const JOB_CHECKLIST_PDF: Record<JobChecklistType, string> = {
  carpet: "/api/docs/archangel-carpet-cleaning-checklist.pdf",
  make_ready: "/api/docs/archangel-make-ready-checklist.pdf",
  painting: "/api/docs/archangel-painting-checklist.pdf",
};

export const JOB_CHECKLIST_LABEL: Record<JobChecklistType, string> = {
  carpet: "Carpet Cleaning Checklist",
  make_ready: "Make-Ready / Unit Punch Checklist",
  painting: "Painting Checklist",
};

/**
 * Returns the checklist type for a job based on its category and description.
 * Returns null if no specific checklist applies (cleaning jobs are handled separately).
 * Priority: carpet → painting → make_ready
 */
export function getJobChecklistType(
  category?: string | null,
  description?: string | null,
): JobChecklistType | null {
  const hay = `${category ?? ""} ${description ?? ""}`.toLowerCase();
  if (hay.includes("carpet")) return "carpet";
  if (hay.includes("paint")) return "painting";
  if (
    hay.includes("make ready") ||
    hay.includes("make-ready") ||
    hay.includes("make_ready") ||
    hay.includes("punch") ||
    hay.includes("unit punch")
  )
    return "make_ready";
  return null;
}

/** Agreement text shown to crew before they can check items. */
export const CHECKLIST_AGREEMENT_TEXT =
  "By starting this checklist, you confirm that if Archangel later determines you did not complete some or all of the items, it could delay your pay until the agreed work is completed, or result in the loss of future work and removal from the platform. Payouts would be calculated pro-rata based on the actual work completed and the time and resource costs involved in completing the assigned work.";
