import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Mic, Bell, LayoutGrid, CalendarDays, Home, Building, DollarSign, Users, Target, Package, Truck, Import as ImportIcon, ClipboardList, Settings, GraduationCap, BookOpen, Sparkles } from "lucide-react";
import { useGetToday, getGetTodayQueryKey } from "@workspace/api-client-react";
import haloLogo from "../assets/halo-logo.png";
import { NotificationsPopover } from "./NotificationsPopover";
import { VoiceCaptureDialog } from "./VoiceCaptureDialog";
import { BusinessInfoDialog } from "./BusinessInfoDialog";
import { GuidedTour } from "./GuidedTour";
import { FalkonBadge } from "./FalkonBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function DesktopLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [cmdText, setCmdText] = useState("");
  const [cmdInitial, setCmdInitial] = useState<string | undefined>(undefined);

  const submitCommand = () => {
    const text = cmdText.trim();
    if (!text) return;
    setCmdInitial(text);
    setCmdText("");
    setVoiceOpen(true);
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const { data: today } = useGetToday({
    query: { queryKey: getGetTodayQueryKey(), refetchInterval: 10_000 },
  });

  return (
    <div className="min-h-screen bg-background flex text-foreground">
      {/* Sidebar Navigation */}
      <aside className="w-[240px] border-r border-border bg-card flex flex-col fixed inset-y-0 left-0 shadow-2xl z-40">
        <div data-tour="brand" className="p-6 pb-5 border-b border-border flex flex-col gap-2">
          <img src={haloLogo} alt="HALO" className="h-9 w-auto self-start filter brightness-0" />
          <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground pl-0.5 font-display font-medium">Archangel Operations</span>
        </div>

        <nav data-tour="sidebar" className="flex-1 py-6 px-4 flex flex-col gap-2 overflow-y-auto">
          <NavItem href="/" icon={Home} label="Today" active={location === "/"} tourId="nav-today" />
          <NavItem href="/jobboard" icon={ClipboardList} label="Job Board" active={location.startsWith("/jobboard")} tourId="nav-jobboard" />
          <NavItem href="/properties" icon={Building} label="Properties" active={location.startsWith("/properties")} tourId="nav-properties" />
          <NavItem href="/money" icon={DollarSign} label="Money" active={location.startsWith("/money") || location.startsWith("/invoices")} tourId="nav-money" />
          <NavItem href="/crews" icon={Users} label="Crews" active={location.startsWith("/crews")} tourId="nav-crews" />
          <NavItem href="/pipeline" icon={Target} label="Pipeline" active={location.startsWith("/pipeline")} tourId="nav-pipeline" />
          <NavItem href="/catalog" icon={BookOpen} label="Price Book" active={location.startsWith("/catalog")} tourId="nav-catalog" />
          <NavItem href="/supply" icon={Package} label="Supply" active={location.startsWith("/supply")} tourId="nav-supply" />
          <NavItem href="/vendors" icon={Truck} label="Vendors" active={location.startsWith("/vendors")} tourId="nav-vendors" />
          <NavItem href="/calendar" icon={CalendarDays} label="Calendar" active={location.startsWith("/calendar")} tourId="nav-calendar" />
          <NavItem href="/import" icon={ImportIcon} label="Import" active={location.startsWith("/import")} tourId="nav-import" />
        </nav>

        <div className="p-4 border-t border-border flex gap-2">
           <button
            data-tour="talk"
            onClick={() => setVoiceOpen(true)}
            title="Talk to HALO"
            className="flex-1 h-10 rounded-none flex items-center justify-center bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--gold-light)] hover:shadow-[0_0_15px_rgba(180,255,68,0.3)] transition-all font-display font-bold uppercase tracking-wider"
          >
            <Mic className="w-4 h-4 mr-2" />
            Talk
          </button>
          <NotificationsPopover>
            <button
              data-tour="notifications"
              className="relative w-10 h-10 rounded-none flex items-center justify-center bg-card shadow-sm border border-border hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
              title="Notifications"
            >
              <Bell className="w-4 h-4" />
              {today?.unreadNotifications ? (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-none bg-[var(--primary)] text-black text-[10px] font-bold flex items-center justify-center shadow-[0_0_10px_rgba(180,255,68,0.5)]">
                  {today.unreadNotifications}
                </span>
              ) : null}
            </button>
          </NotificationsPopover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-tour="more"
                className="w-10 h-10 rounded-none flex items-center justify-center bg-card shadow-sm border border-border hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
                title="More"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-60 rounded-none border-[var(--border)] bg-card text-foreground">
              <DropdownMenuLabel className="font-display uppercase tracking-wider text-xs">Workspace</DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-[var(--border)]" />
              <DropdownMenuItem onSelect={() => setTourOpen(true)} className="rounded-none focus:bg-[var(--muted)] focus:text-[var(--primary)]">
                <GraduationCap className="w-4 h-4 mr-2" />
                Guided tour
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSettingsOpen(true)} className="rounded-none focus:bg-[var(--muted)] focus:text-[var(--primary)]">
                <Settings className="w-4 h-4 mr-2" />
                Settings &amp; business info
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setVoiceOpen(true)} className="rounded-none focus:bg-[var(--muted)] focus:text-[var(--primary)]">
                <Mic className="w-4 h-4 mr-2" />
                Talk to HALO
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-[240px] flex-1 bg-background flex flex-col min-h-screen">
        <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-md px-8 pt-6 pb-4 border-b border-border/50">
          <div data-tour="ask-halo" className="relative max-w-2xl">
            <Sparkles className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--primary)]" />
            <input
              value={cmdText}
              onChange={(e) => setCmdText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitCommand();
              }}
              placeholder="Ask HALO to do anything — “Invoice Maple Grove $950 for painting unit 5”…"
              className="w-full h-12 rounded-none bg-card border border-border shadow-sm pl-11 pr-24 text-sm focus:outline-none focus:border-[var(--primary)] focus:shadow-[0_0_15px_rgba(180,255,68,0.1)] placeholder:text-muted-foreground font-mono transition-all text-foreground"
              data-testid="input-command-bar"
            />
            {cmdText.trim() && (
              <button
                type="button"
                onClick={submitCommand}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 px-6 rounded-none bg-[var(--primary)] hover:bg-[var(--gold-light)] hover:shadow-[0_0_15px_rgba(180,255,68,0.3)] text-black text-xs font-display font-bold uppercase tracking-wider transition-all"
                data-testid="button-command-go"
              >
                Do it
              </button>
            )}
          </div>
        </div>
        <div className="flex-1">
          {children}
        </div>
        <FalkonBadge />
      </main>

      <VoiceCaptureDialog
        open={voiceOpen}
        onOpenChange={(o) => {
          setVoiceOpen(o);
          if (!o) setCmdInitial(undefined);
        }}
        initialText={cmdInitial}
      />
      <BusinessInfoDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <GuidedTour open={tourOpen} onOpenChange={setTourOpen} />
    </div>
  );
}

function NavItem({ href, icon: Icon, label, active, tourId }: { href: string, icon: any, label: string, active: boolean, tourId?: string }) {
  return (
    <Link href={href} data-tour={tourId} className={`group flex items-center gap-3 px-3 py-2.5 rounded-none transition-all border-l-2 ${active ? "border-[var(--primary)] bg-[var(--muted)] text-foreground" : "border-transparent text-muted-foreground hover:bg-[var(--muted)]/50 hover:text-foreground hover:border-[var(--border)]"}`}>
      <span className={`custom-icon ${active ? "bg-[var(--primary)] text-black" : "bg-[var(--border)] text-muted-foreground group-hover:text-[var(--primary)] group-hover:bg-[var(--muted)]"}`}>
        <Icon className="w-4 h-4" />
      </span>
      <span className="font-medium text-sm font-display tracking-wide">{label}</span>
    </Link>
  );
}
