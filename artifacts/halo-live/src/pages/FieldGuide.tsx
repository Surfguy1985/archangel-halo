/**
 * Turo-style guided field photo flow for make-ready turns.
 * Steps: Arrive → Before → Work notes → After → Review → Submit
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft, Camera, Check, ChevronRight, ImagePlus, MapPin, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { marketingPhotos } from "@/lib/api";
import logo from "@/assets/halo-logo.png";

type StepId = "ready" | "before" | "work" | "after" | "review" | "done";

const STEPS: Array<{ id: StepId; title: string; hint: string }> = [
  { id: "ready", title: "Get ready", hint: "You’re on unit. We’ll coach every shot." },
  { id: "before", title: "Before photos", hint: "Capture damage and empty condition — at least 4 angles." },
  { id: "work", title: "What you did", hint: "Services completed on this turn." },
  { id: "after", title: "After photos", hint: "Show the finished unit — same angles when possible." },
  { id: "review", title: "Review & submit", hint: "Confirm crew, services, and evidence." },
  { id: "done", title: "Submitted", hint: "HALO review + dispatch updated." },
];

export function FieldGuide() {
  const [idx, setIdx] = useState(0);
  const [beforeCount, setBeforeCount] = useState(0);
  const [afterCount, setAfterCount] = useState(0);
  const [notes, setNotes] = useState("");
  const step = STEPS[idx]!;
  const progress = ((idx + 1) / STEPS.length) * 100;

  const canNext = useMemo(() => {
    if (step.id === "before") return beforeCount >= 1;
    if (step.id === "after") return afterCount >= 1;
    return true;
  }, [step.id, beforeCount, afterCount]);

  function next() {
    if (idx < STEPS.length - 1) setIdx(idx + 1);
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-lg flex-col bg-halo-ink">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-halo-line bg-halo-ink/95 px-4 pb-3 pt-3 backdrop-blur">
        <div className="mb-3 flex items-center justify-between">
          <Link href="/live" className="grid h-9 w-9 place-items-center rounded-full bg-halo-card">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex items-center gap-2 text-sm font-medium">
            <img src={logo} alt="" className="h-5 w-5" />
            Field guide
          </div>
          <button type="button" className="text-xs text-halo-lime" onClick={() => setIdx(0)}>
            Steps
          </button>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-halo-line">
          <div className="h-full bg-halo-lime transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 text-xs text-halo-mist">
          {idx + 1} of {STEPS.length} · Unit demo · Base44 log-work ready
        </p>
      </header>

      <main className="flex flex-1 flex-col px-4 py-6">
        {step.id === "ready" && (
          <div className="flex flex-1 flex-col items-center text-center">
            <div className="mb-6 grid h-24 w-24 place-items-center rounded-3xl bg-halo-lime/15 text-halo-lime">
              <Camera className="h-10 w-10" />
            </div>
            <h1 className="font-display text-4xl">{step.title}</h1>
            <p className="mt-3 max-w-sm text-halo-mist">{step.hint}</p>
            <div className="mt-10 grid w-full grid-cols-2 gap-3 text-left text-sm">
              {[
                "Shoot in good light",
                "Full rooms, not close-ups only",
                "Include unit number if visible",
                "After = same angles as before",
              ].map((t) => (
                <div key={t} className="rounded-2xl border border-halo-line bg-halo-card p-3 text-halo-mist">
                  <Sparkles className="mb-2 h-4 w-4 text-halo-lime" />
                  {t}
                </div>
              ))}
            </div>
          </div>
        )}

        {(step.id === "before" || step.id === "after") && (
          <div className="flex flex-1 flex-col">
            <div className="mb-4 overflow-hidden rounded-3xl border border-halo-line">
              <img
                src={step.id === "before" ? marketingPhotos.before : marketingPhotos.after}
                alt=""
                className="aspect-[4/3] w-full object-cover opacity-90"
              />
            </div>
            <h1 className="text-2xl font-semibold">{step.title}</h1>
            <p className="mt-1 text-sm text-halo-mist">{step.hint}</p>
            <div className="mt-6 flex items-center justify-between rounded-2xl border border-halo-line bg-halo-card px-4 py-3">
              <span className="text-sm text-halo-mist">Captured</span>
              <span className="font-semibold text-halo-lime">
                {step.id === "before" ? beforeCount : afterCount} photos
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() =>
                  step.id === "before" ? setBeforeCount((n) => n + 1) : setAfterCount((n) => n + 1)
                }
                className="flex items-center justify-center gap-2 rounded-2xl bg-halo-lime py-3.5 text-sm font-semibold text-halo-ink"
              >
                <Camera className="h-4 w-4" /> Take photo
              </button>
              <button
                type="button"
                onClick={() =>
                  step.id === "before" ? setBeforeCount((n) => n + 1) : setAfterCount((n) => n + 1)
                }
                className="flex items-center justify-center gap-2 rounded-2xl border border-halo-line py-3.5 text-sm font-medium"
              >
                <ImagePlus className="h-4 w-4" /> From gallery
              </button>
            </div>
          </div>
        )}

        {step.id === "work" && (
          <div className="flex flex-1 flex-col">
            <div className="mb-4 flex items-center gap-2 text-sm text-halo-mist">
              <MapPin className="h-4 w-4 text-halo-lime" /> On unit · services
            </div>
            <h1 className="text-2xl font-semibold">{step.title}</h1>
            <p className="mt-1 text-sm text-halo-mist">{step.hint}</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Paint touch-up, full clean, carpet…"
              className="mt-6 min-h-[140px] w-full rounded-2xl border border-halo-line bg-halo-card p-4 text-sm outline-none ring-halo-lime focus:ring-1"
            />
            <div className="mt-4 flex flex-wrap gap-2">
              {["Make-ready package", "Paint", "Clean", "Carpet"].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setNotes((n) => (n ? `${n}, ${t}` : t))}
                  className="rounded-full border border-halo-line px-3 py-1.5 text-xs text-halo-mist hover:border-halo-lime/40"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        {step.id === "review" && (
          <div className="flex flex-1 flex-col gap-3">
            <h1 className="text-2xl font-semibold">{step.title}</h1>
            <p className="text-sm text-halo-mist">{step.hint}</p>
            {[
              { k: "Before photos", v: String(beforeCount) },
              { k: "After photos", v: String(afterCount) },
              { k: "Services", v: notes || "—" },
            ].map((row) => (
              <div key={row.k} className="flex justify-between rounded-2xl border border-halo-line bg-halo-card px-4 py-3 text-sm">
                <span className="text-halo-mist">{row.k}</span>
                <span className="max-w-[60%] truncate font-medium">{row.v}</span>
              </div>
            ))}
            <p className="mt-2 text-xs text-halo-mist">
              Submit sends evidence into HALO work-review → Money Lock path. Base44 dispatch stays source of field truth.
            </p>
          </div>
        )}

        {step.id === "done" && (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-halo-lime text-halo-ink">
              <Check className="h-8 w-8" />
            </div>
            <h1 className="font-display text-4xl">Locked in</h1>
            <p className="mt-2 max-w-xs text-halo-mist">
              Photos and notes are on the live map. Office can verify without chasing texts.
            </p>
            <Link href="/live" className="mt-8 rounded-full bg-halo-lime px-6 py-3 text-sm font-semibold text-halo-ink">
              Back to Live Map
            </Link>
          </div>
        )}
      </main>

      {step.id !== "done" && (
        <div className="sticky bottom-0 border-t border-halo-line bg-halo-ink/95 p-4 backdrop-blur">
          <button
            type="button"
            disabled={!canNext}
            onClick={next}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold",
              canNext ? "bg-halo-lime text-halo-ink" : "bg-halo-line text-halo-mist",
            )}
          >
            {step.id === "review" ? "Submit to HALO" : "Continue"}
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
