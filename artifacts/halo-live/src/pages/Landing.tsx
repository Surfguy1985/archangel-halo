import { Link } from "wouter";
import { ArrowRight, MapPin, Camera, Radio, Shield } from "lucide-react";
import { marketingPhotos } from "@/lib/api";
import logo from "@/assets/halo-logo.png";

export function Landing() {
  return (
    <div className="min-h-full bg-halo-ink">
      {/* Nav */}
      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/5 bg-halo-ink/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <img src={logo} alt="HALO" className="h-7 w-7 object-contain" />
            <span className="text-sm font-semibold tracking-wide">HALO</span>
          </div>
          <nav className="hidden gap-6 text-sm text-halo-mist md:flex">
            <a href="#product" className="hover:text-white">Product</a>
            <a href="#field" className="hover:text-white">Field</a>
            <a href="#live" className="hover:text-white">Live Map</a>
          </nav>
          <Link href="/enter" className="rounded-full bg-halo-lime px-4 py-1.5 text-sm font-semibold text-halo-ink">
            Open Live
          </Link>
        </div>
      </header>

      {/* Hero — Airbnb-scale calm + DoorDash energy */}
      <section className="relative pt-14">
        <div className="absolute inset-0 overflow-hidden">
          <img src={marketingPhotos.hero} alt="" className="h-full w-full object-cover opacity-35" />
          <div className="absolute inset-0 bg-gradient-to-b from-halo-ink/40 via-halo-ink/80 to-halo-ink" />
        </div>
        <div className="relative mx-auto max-w-6xl px-4 pb-24 pt-20 md:pt-28">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-halo-lime">Property ops, live</p>
          <h1 className="max-w-3xl font-display text-5xl leading-[1.05] text-white md:text-7xl">
            One map.<br />Every turn.<br /><span className="italic text-halo-lime">Everyone aligned.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-halo-mist">
            HALO is the DoorDash for make-ready — crew GPS, photo-proof work, and a single live dashboard for property and vendor teams.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/enter" className="inline-flex items-center gap-2 rounded-full bg-halo-lime px-6 py-3 text-sm font-semibold text-halo-ink">
              Enter Live Map <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/field" className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-3 text-sm font-medium text-white hover:border-halo-lime/50">
              Field photo guide
            </Link>
          </div>
        </div>
      </section>

      {/* Product pillars */}
      <section id="product" className="mx-auto max-w-6xl px-4 py-20">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { icon: MapPin, title: "Shared live map", body: "Property and vendor see the same pins, crews, and turn risk — role-gated so money stays vendor-side." },
            { icon: Camera, title: "Turo-style photo proof", body: "Screen-by-screen guided before/after capture. No guesswork. No missing evidence." },
            { icon: Radio, title: "Internal live board", body: "Messages tied to units and jobs — not a separate Slack abyss." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl border border-halo-line bg-halo-card p-6">
              <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-halo-lime/10 text-halo-lime">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-halo-mist">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Split feature */}
      <section id="live" className="border-y border-halo-line bg-halo-panel">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 md:grid-cols-2 md:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-halo-lime">Live Map</p>
            <h2 className="mt-3 font-display text-4xl md:text-5xl">DoorDash energy.<br />Property clarity.</h2>
            <p className="mt-4 text-halo-mist">
              Full-bleed map, floating status sheet, crew pins, building risk tint. Portfolio and Pulse watch; Punchlist runs dispatch and money.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-halo-mist">
              {["Crew GPS on site", "Turn radar (aging / overdue)", "Before & after photo billboards", "One selection shared across devices"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-halo-lime" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="overflow-hidden rounded-3xl border border-halo-line shadow-2xl shadow-black/40">
            <img src={marketingPhotos.map} alt="Live map concept" className="aspect-[4/3] w-full object-cover" />
          </div>
        </div>
      </section>

      <section id="field" className="mx-auto max-w-6xl px-4 py-20">
        <div className="grid gap-10 md:grid-cols-2 md:items-center">
          <div className="order-2 overflow-hidden rounded-3xl border border-halo-line md:order-1">
            <div className="grid grid-cols-2 gap-1">
              <img src={marketingPhotos.before} alt="Before" className="aspect-square object-cover" />
              <img src={marketingPhotos.after} alt="After" className="aspect-square object-cover" />
            </div>
          </div>
          <div className="order-1 md:order-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-halo-lime">Field app</p>
            <h2 className="mt-3 font-display text-4xl">Photo-guided like Turo.</h2>
            <p className="mt-4 text-halo-mist">
              One step at a time: unit arrival → before shots → work → after shots → submit. Built for crews, wired to Base44 log-work and HALO review.
            </p>
            <Link href="/field" className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-halo-ink">
              Start guided capture <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-halo-line py-10 text-center text-sm text-halo-mist">
        <img src={logo} alt="" className="mx-auto mb-3 h-8 w-8 opacity-80" />
        HALO Live · Archangel · Property ops without the spaghetti
      </footer>
    </div>
  );
}
