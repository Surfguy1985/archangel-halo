import { Link, useLocation } from "wouter";
import { Mic, Bell, LayoutGrid, CalendarDays, Home, Building, DollarSign, Users, Target, Package, Truck, Import as ImportIcon } from "lucide-react";
import { useGetToday } from "@workspace/api-client-react";
import haloLogo from "../assets/halo-logo.png";

export function DesktopLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: today } = useGetToday();

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar Navigation */}
      <aside className="w-[240px] border-r border-border bg-card flex flex-col fixed inset-y-0 left-0">
        <div className="p-6 pb-5 border-b border-border flex flex-col gap-2">
          <img src={haloLogo} alt="HALO" className="h-9 w-auto self-start" />
          <span className="text-[10px] tracking-[0.22em] uppercase text-muted-foreground pl-0.5">Archangel Operations</span>
        </div>

        <nav className="flex-1 py-6 px-4 flex flex-col gap-2 overflow-y-auto">
          <NavItem href="/" icon={Home} label="Today" active={location === "/"} />
          <NavItem href="/properties" icon={Building} label="Properties" active={location.startsWith("/properties")} />
          <NavItem href="/money" icon={DollarSign} label="Money" active={location.startsWith("/money") || location.startsWith("/invoices")} />
          <NavItem href="/crews" icon={Users} label="Crews" active={location.startsWith("/crews")} />
          <NavItem href="/pipeline" icon={Target} label="Pipeline" active={location.startsWith("/pipeline")} />
          <NavItem href="/supply" icon={Package} label="Supply" active={location.startsWith("/supply")} />
          <NavItem href="/vendors" icon={Truck} label="Vendors" active={location.startsWith("/vendors")} />
          <NavItem href="/calendar" icon={CalendarDays} label="Calendar" active={location.startsWith("/calendar")} />
          <NavItem href="/import" icon={ImportIcon} label="Import" active={location.startsWith("/import")} />
        </nav>

        <div className="p-4 border-t border-border flex gap-2">
           <button className="flex-1 h-10 rounded-full flex items-center justify-center bg-[var(--gold-tint)] text-[var(--gold-dark)] hover:bg-[var(--gold)] hover:text-white transition-colors">
            <Mic className="w-5 h-5" />
          </button>
          <button className="relative w-10 h-10 rounded-full flex items-center justify-center bg-card shadow-sm border border-border">
            <Bell className="w-5 h-5" />
            {today?.unreadNotifications ? (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-white text-[10px] font-bold flex items-center justify-center">
                {today.unreadNotifications}
              </span>
            ) : null}
          </button>
          <button className="w-10 h-10 rounded-full flex items-center justify-center bg-card shadow-sm border border-border">
            <LayoutGrid className="w-5 h-5" />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-[240px] flex-1 bg-[var(--paper)]">
        {children}
      </main>
    </div>
  );
}

function NavItem({ href, icon: Icon, label, active }: { href: string, icon: any, label: string, active: boolean }) {
  return (
    <Link href={href} className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${active ? "bg-[var(--ink)] text-white" : "text-muted-foreground hover:bg-black/5 hover:text-foreground"}`}>
      <Icon className="w-5 h-5" />
      <span className="font-medium text-sm">{label}</span>
    </Link>
  );
}
