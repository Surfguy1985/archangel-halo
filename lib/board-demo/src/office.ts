// Shared Office Board Demo script + pre-rendered narration clips.
// This is the single source of truth for the office-side Board Demo used by
// both the mobile (@workspace/halo) and desktop (@workspace/halo-desktop)
// apps. Spotlight targets differ per app (mobile uses column-* testids,
// desktop uses lane-* testids), so each app keeps its own target list and
// zips it with this script by index.
//
// The MP3 clips are pre-rendered ElevenLabs narration keyed by step index
// (step-N.mp3). If a step's title/body is edited here, its clip must be
// re-rendered or the audio will no longer match the on-screen text.

import step0 from "./assets/office-demo/step-0.mp3";
import step1 from "./assets/office-demo/step-1.mp3";
import step2 from "./assets/office-demo/step-2.mp3";
import step3 from "./assets/office-demo/step-3.mp3";
import step4 from "./assets/office-demo/step-4.mp3";
import step5 from "./assets/office-demo/step-5.mp3";
import step6 from "./assets/office-demo/step-6.mp3";

export type OfficeDemoScriptStep = {
  title: string;
  body: string;
};

export const OFFICE_DEMO_SCRIPT: OfficeDemoScriptStep[] = [
  {
    title: "The office side of the board",
    body: "You've seen what the client sees. This is the office side — the same board, viewed from HALO. Cards you send from here land in the client's From Archangel column, and everything the client does shows up right back here.",
  },
  {
    title: "Four columns, zero guesswork",
    body: "From Archangel holds every card you've pushed to the client — invoices, live crew trackers, photo sets, and recaps. To do, In progress, and Done mirror the client's own board, so the office always knows exactly what the client is looking at.",
  },
  {
    title: "Send a card in seconds",
    body: "Tap Send a card and pick a template — an update, a heads-up, or an invoice. The moment you hit send, it appears on the client's board in real time. No email, no portal invite. One tap, and it's in front of them.",
  },
  {
    title: "Invoices that collect themselves",
    body: "When you push an invoice, the card carries everything — the PDF, the amount, the due date, and a live pay link. The client reviews and pays right on the card, and HALO's books reconcile automatically.",
  },
  {
    title: "Live crews and before-and-after proof",
    body: "The tracker card is a live window to the site — Marco's crew is checked in at Unit 204 right now. And the photo card carries the crew's before-and-after set, so the client sees the damage and the finished wall without ever asking.",
  },
  {
    title: "See it through their eyes",
    body: "Open their board any time to see exactly what the client sees — same cards, same order, same lights. One truth, two views.",
  },
  {
    title: "That's the whole loop",
    body: "Work happens, cards raise themselves, invoices carry their own pay links, and crews prove their work in photos — office and client looking at the same living board. That's HALO.",
  },
];

const CLIPS: string[] = [step0, step1, step2, step3, step4, step5, step6];

/** Pre-rendered narration clip URL for a step, or null if none exists. */
export function officeDemoClipFor(index: number): string | null {
  return CLIPS[index] ?? null;
}
