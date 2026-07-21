import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Mic, Bell, LayoutGrid, CalendarDays, Home, Building, DollarSign, Users, Target, Package, Truck, Import as ImportIcon, ClipboardList, Settings, GraduationCap, BookOpen, Sparkles } from "lucide-react";
import { useGetToday, getGetTodayQueryKey } from "@workspace/api-client-react";
import haloLogo from "../assets/halo-logo.png";
import { NotificationsPopover } from "./NotificationsPopover";
import { VoiceCaptureDialog } from "./VoiceCaptureDialog";
import { BusinessInfoDialog } from "./BusinessInfoDialog";
import { GuidedTour } from "./GuidedTour";
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
    <div className="min-h-screen bg-background flex">
      {/* Sidebar Navigation */}
      <aside className="w-[240px] border-r border-border bg-card flex flex-col fixed inset-y-0 left-0">
        <div data-tour="brand" className="p-6 pb-5 border-b border-border flex flex-col gap-2">
          <img src={haloLogo} alt="HALO" className="h-9 w-auto self-start" />
          <span className="text-[10px] tracking-[0.22em] uppercase text-muted-foreground pl-0.5">Archangel Operations</span>
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
            className="flex-1 h-10 rounded-full flex items-center justify-center bg-[var(--gold-tint)] text-[var(--gold-dark)] hover:bg-[var(--gold)] hover:text-white transition-colors"
          >
            <Mic className="w-5 h-5" />
          </button>
          <NotificationsPopover>
            <button
              data-tour="notifications"
              className="relative w-10 h-10 rounded-full flex items-center justify-center bg-card shadow-sm border border-border hover:bg-black/5 transition-colors"
              title="Notifications"
            >
              <Bell className="w-5 h-5" />
              {today?.unreadNotifications ? (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-white text-[10px] font-bold flex items-center justify-center">
                  {today.unreadNotifications}
                </span>
              ) : null}
            </button>
          </NotificationsPopover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-tour="more"
                className="w-10 h-10 rounded-full flex items-center justify-center bg-card shadow-sm border border-border hover:bg-black/5 transition-colors"
                title="More"
              >
                <LayoutGrid className="w-5 h-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-60">
              <DropdownMenuLabel>Workspace</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setTourOpen(true)}>
                <GraduationCap className="w-4 h-4 mr-2" />
                Guided tour
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                <Settings className="w-4 h-4 mr-2" />
                Settings &amp; business info
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setVoiceOpen(true)}>
                <Mic className="w-4 h-4 mr-2" />
                Talk to HALO
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-[240px] flex-1 bg-[var(--paper)]">
        <div className="sticky top-0 z-30 bg-[var(--paper)]/95 backdrop-blur px-8 pt-4 pb-2">
          <div className="relative max-w-2xl">
            <Sparkles className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--gold-dark)]" />
            <input
              value={cmdText}
              onChange={(e) => setCmdText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitCommand();
              }}
              placeholder="Ask HALO to do anything — “Invoice Maple Grove $950 for painting unit 5”, “Schedule J-2001 tomorrow with Ray”…"
              className="w-full h-11 rounded-full bg-card border border-border shadow-sm pl-11 pr-24 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gold)] placeholder:text-muted-foreground/70"
              data-testid="input-command-bar"
            />
            {cmdText.trim() && (
              <button
                type="button"
                onClick={submitCommand}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 px-4 rounded-full bg-[var(--gold)] hover:bg-[var(--gold-dark)] text-white text-xs font-bold transition-colors"
                data-testid="button-command-go"
              >
                Do it
              </button>
            )}
          </div>
        </div>
        {children}
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
    <Link href={href} data-tour={tourId} className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${active ? "bg-[var(--ink)] text-white" : "text-muted-foreground hover:bg-black/5 hover:text-foreground"}`}>
      <Icon className="w-5 h-5" />
      <span className="font-medium text-sm">{label}</span>
    </Link>
  );
}
