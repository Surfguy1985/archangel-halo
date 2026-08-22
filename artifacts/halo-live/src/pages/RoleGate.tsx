import { Link } from "wouter";
import { Building2, Home, Wrench, Smartphone } from "lucide-react";
import logo from "@/assets/halo-logo.png";
import type { Role } from "@/lib/api";

const roles: Array<{ id: Role; title: string; desc: string; icon: typeof Home; href: string }> = [
  { id: "portfolio", title: "Portfolio", desc: "Corporate view — turns, GPS, photos. No vendor money.", icon: Building2, href: "/live?role=portfolio" },
  { id: "pulse", title: "Pulse", desc: "Property side — live site, verify work, turn times.", icon: Home, href: "/live?role=pulse" },
  { id: "punchlist", title: "Punchlist", desc: "Vendor back office — dispatch, money, crews, reviews.", icon: Wrench, href: "/live?role=punchlist" },
  { id: "field", title: "Field", desc: "Crew phone — guided photos & log work.", icon: Smartphone, href: "/field" },
];

export function RoleGate() {
  return (
    <div className="min-h-full bg-halo-ink px-4 py-16">
      <div className="mx-auto max-w-lg text-center">
        <img src={logo} alt="HALO" className="mx-auto h-12 w-12" />
        <h1 className="mt-6 font-display text-4xl">Who’s opening HALO?</h1>
        <p className="mt-2 text-halo-mist">Same live map. Different permissions.</p>
      </div>
      <div className="mx-auto mt-10 grid max-w-2xl gap-3">
        {roles.map((r) => (
          <Link
            key={r.id}
            href={r.href}
            className="flex items-center gap-4 rounded-2xl border border-halo-line bg-halo-card p-4 transition hover:border-halo-lime/40"
          >
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-halo-lime/10 text-halo-lime">
              <r.icon className="h-5 w-5" />
            </div>
            <div className="text-left">
              <div className="font-semibold">{r.title}</div>
              <div className="text-sm text-halo-mist">{r.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
