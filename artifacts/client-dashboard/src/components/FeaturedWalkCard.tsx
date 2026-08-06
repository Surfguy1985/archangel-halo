import { useState } from "react";
import { ChevronDown, Smartphone, ArrowUpRight, Footprints } from "lucide-react";
import walkHero from "../assets/walk-feature.jpg";

/**
 * Featured banner promoting the HALO Walk mobile app. Links to the Walk app
 * on the same origin (works in dev preview and on the published site) and
 * expands with how-it-works + add-to-home-screen instructions.
 */
export function FeaturedWalkCard() {
  const [open, setOpen] = useState(false);
  const walkUrl = `${window.location.origin}/walk/`;

  return (
    <div className="px-3 sm:px-5 pt-3">
      <div className="max-w-[1400px] mx-auto overflow-hidden rounded-[16px] border border-black/[0.08] bg-white shadow-sm">
        <div className="flex flex-col sm:flex-row">
          <div className="relative sm:w-[300px] shrink-0 h-[130px] sm:h-auto">
            <img
              src={walkHero}
              alt="HALO Walk — walk the property from your phone"
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
            />
          </div>
          <div className="flex-1 p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide px-2 py-[3px] rounded-full bg-[#B4FF44] text-black">
                <Footprints className="w-3 h-3" /> New
              </span>
              <span className="text-[11px] font-semibold text-[#6e6e73] uppercase tracking-wide">Mobile app</span>
            </div>
            <h3 className="mt-1.5 text-[17px] font-bold text-[#1d1d1f]">HALO Walk</h3>
            <p className="mt-1 text-[13px] leading-[1.5] text-[#3c3c43]">
              Walk your property with your phone and log what each unit needs as you go.
              When you finish the walk, every item becomes a real work order for the Archangel
              team automatically — no emails, no spreadsheets, no double entry.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href={walkUrl}
                target="_blank"
                rel="noreferrer"
                data-testid="link-open-walk"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#1d1d1f] text-white text-[13px] font-semibold active:scale-[0.97] transition-transform"
              >
                Open HALO Walk <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
              <button
                onClick={() => setOpen((v) => !v)}
                data-testid="button-walk-instructions"
                className="inline-flex items-center gap-1 px-3 py-2 rounded-full text-[13px] font-semibold text-[#1d1d1f] bg-[#f5f5f7] active:scale-[0.97] transition-transform"
              >
                <Smartphone className="w-3.5 h-3.5" /> Use it on your phone
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
            </div>
            {open && (
              <div className="mt-3 rounded-[12px] bg-[#f5f5f7] p-3.5 text-[13px] leading-[1.55] text-[#3c3c43]">
                <p className="font-semibold text-[#1d1d1f] mb-1.5">How it works</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>Open the link above on your phone and unlock it with the passcode from your Archangel contact.</li>
                  <li>Pick your property, then walk it — tap a unit, choose the services it needs, add notes or photos.</li>
                  <li>Tap <span className="font-semibold">Finish walk</span>. Each flagged unit turns into a work order with pricing from your property's price book, and it shows up here on your board.</li>
                </ol>
                <p className="font-semibold text-[#1d1d1f] mt-3 mb-1.5">Put it on your home screen</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li><span className="font-semibold">iPhone:</span> open the link in Safari → tap the Share button → <span className="font-semibold">Add to Home Screen</span>.</li>
                  <li><span className="font-semibold">Android:</span> open the link in Chrome → tap the ⋮ menu → <span className="font-semibold">Add to Home screen</span>.</li>
                </ul>
                <p className="mt-2 text-[#6e6e73]">It then opens like a regular app — one tap from your phone, no app store needed.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
