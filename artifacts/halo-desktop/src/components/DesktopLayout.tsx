import { useState} from "react";
import { Link, useLocation} from "wouter";
import { Mic, Bell, LayoutGrid, CalendarDays, Home, Building, DollarSign, Users, Target, Package, Truck, Import as ImportIcon, ClipboardList, Settings, GraduationCap, BookOpen, Sparkles, Feather, ShieldCheck, Presentation, ExternalLink, Loader2} from "lucide-react";
import { useToast} from "@/hooks/use-toast";
import { useQueryClient} from "@tanstack/react-query";
import {
  useGetToday,
  getGetTodayQueryKey,
  useGetPresentationDemo,
  useActivatePresentationDemo,
  getGetPresentationDemoQueryKey,
} from "@workspace/api-client-react";
import haloLogo from "../assets/halo-logo.png";
import { NotificationsPopover} from "./NotificationsPopover";
import { VoiceCaptureDialog} from "./VoiceCaptureDialog";
import { BusinessInfoDialog} from "./BusinessInfoDialog";
import { GuidedTour} from "./GuidedTour";
import { WingsGuideDialog} from "./WingsGuideDialog";
import { FalkonBadge} from "./FalkonBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function DesktopLayout({ children}: { children: React.ReactNode}) {
  const [location, navigate] = useLocation();
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
  const [wingsGuideOpen, setWingsGuideOpen] = useState(false);
  const { data: today} = useGetToday({
    query: { queryKey: getGetTodayQueryKey(), refetchInterval: 10_000},
 });

  // Board Demo (Showcase): same Presentation Mode seed the mobile app uses.
  // If the demo property isn't seeded yet, seed it first, then open the
  // narrated walkthrough. Office side runs in this app; client side opens
  // the real client dashboard in a new tab.
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: demoState } = useGetPresentationDemo({
    query: { queryKey: getGetPresentationDemoQueryKey() },
  });
  const activateDemo = useActivatePresentationDemo();
  const demoBusy = activateDemo.isPending;

  const withDemoSeed = (go: (s: { propertyId?: string | null; dashboardToken?: string | null }) => void) => {
    if (demoState?.active) {
      go(demoState);
      return;
    }
    activateDemo.mutate(undefined, {
      onSuccess: (s) => {
        queryClient.invalidateQueries({ queryKey: getGetPresentationDemoQueryKey() });
        toast({ title: "Presentation Mode is on", description: "Demo property seeded." });
        go(s ?? {});
      },
      onError: () => toast({ title: "Couldn't start the Board Demo", variant: "destructive" }),
    });
  };

  const openOfficeDemo = () =>
    withDemoSeed((s) => {
      if (s.propertyId) navigate(`/admin/${s.propertyId}/board?present=1`);
    });

  const openClientDemo = () =>
    withDemoSeed((s) => {
      if (s.dashboardToken) {
        window.open(`${window.location.origin}/board/${s.dashboardToken}?present=1`, "_blank");
      }
    });

  return (
    <div className="min-h-screen bg-background flex text-foreground">
      {/* Sidebar Navigation */}
      <aside className="group/side w-[76px] hover:w-[240px] transition-[width] duration-200 ease-out border-r border-border bg-[var(--secondary)] text-[var(--secondary-foreground)] flex flex-col fixed inset-y-0 left-0 shadow-2xl z-40 overflow-hidden">
        <div data-tour="brand" className="p-4 pb-4 group-hover/side:p-6 group-hover/side:pb-5 border-b border-[var(--ink2)] flex flex-col gap-2 transition-all duration-200">
          <img src={haloLogo} alt="HALO" className="h-9 w-auto max-w-[44px] group-hover/side:max-w-none object-contain object-left self-start filter brightness-0 invert transition-all duration-200" />
          <span className="text-[10px] tracking-[0.2em] text-[var(--hairline2)] pl-0.5 font-display font-medium whitespace-nowrap opacity-0 group-hover/side:opacity-100 transition-opacity duration-200 h-0 group-hover/side:h-auto overflow-hidden">Archangel Operations</span>
        </div>

        <nav data-tour="sidebar" className="flex-1 py-6 px-4 flex flex-col gap-2 overflow-y-auto overflow-x-hidden">
          <NavItem href="/" icon={Home} label="Today" active={location === "/"} tourId="nav-today" />
          <NavItem href="/jobboard" icon={ClipboardList} label="Job Board" active={location.startsWith("/jobboard")} tourId="nav-jobboard" />
          <NavItem href="/properties" icon={Building} label="Properties" active={location.startsWith("/properties")} tourId="nav-properties" />
          <NavItem href="/money" icon={DollarSign} label="Money" active={location.startsWith("/money") || location.startsWith("/invoices")} tourId="nav-money" />
          <NavItem href="/crews" icon={Users} label="Crews" active={location.startsWith("/crews")} tourId="nav-crews" />
          <NavItem href="/pipeline" icon={Target} label="Pipeline" active={location.startsWith("/pipeline")} tourId="nav-pipeline" />
          <NavItem href="/supply" icon={Package} label="Supply" active={location.startsWith("/supply")} tourId="nav-supply" />
          <NavItem href="/calendar" icon={CalendarDays} label="Calendar" active={location.startsWith("/calendar")} tourId="nav-calendar" />
          <NavItem href="/import" icon={ImportIcon} label="Import" active={location.startsWith("/import")} tourId="nav-import" />
          <NavItem href="/admin" icon={ShieldCheck} label="Admin" active={location.startsWith("/admin")} tourId="nav-admin" />
        </nav>

        <div className="p-4 border-t border-[var(--ink2)] flex flex-col group-hover/side:flex-row gap-2">
           <button
            data-tour="talk"
            onClick={() => setVoiceOpen(true)}
            title="Talk to HALO"
            className="flex-1 h-10 rounded-md flex items-center justify-center bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--gold-light)] hover:shadow-[0_0_15px_rgba(180,255,68,0.3)] transition-all font-display font-bold"
          >
            <Mic className="w-4 h-4 group-hover/side:mr-2" />
            <span className="hidden group-hover/side:inline">Talk</span>
          </button>
          <NotificationsPopover>
            <button
              data-tour="notifications"
              className="relative w-full group-hover/side:w-10 h-10 rounded-md flex items-center justify-center bg-[var(--ink2)] text-white shadow-sm border border-[var(--ink2)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
              title="Notifications"
            >
              <Bell className="w-4 h-4" />
              {today?.unreadNotifications ? (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-[10px] font-bold flex items-center justify-center shadow-[0_0_10px_rgba(180,255,68,0.5)]">
                  {today.unreadNotifications}
                </span>
              ) : null}
            </button>
          </NotificationsPopover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-tour="more"
                className="w-full group-hover/side:w-10 h-10 rounded-md flex items-center justify-center bg-[var(--ink2)] text-white shadow-sm border border-[var(--ink2)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
                title="More"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-60 rounded-md border-[var(--border)] bg-card text-foreground">
              <DropdownMenuLabel className="font-display text-xs">Workspace</DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-[var(--border)]" />
              <DropdownMenuItem onSelect={() => navigate("/catalog")} className="rounded-sm focus:bg-[var(--muted)] focus:text-[var(--primary)]" data-testid="menu-pricebook">
                <BookOpen className="w-4 h-4 mr-2" />
                Price Book
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate("/vendors")} className="rounded-sm focus:bg-[var(--muted)] focus:text-[var(--primary)]" data-testid="menu-vendors">
                <Truck className="w-4 h-4 mr-2" />
                Vendors
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate("/wings")} className="rounded-sm focus:bg-[var(--muted)] focus:text-[var(--primary)]" data-testid="menu-wings">
                <Feather className="w-4 h-4 mr-2" />
                Wings
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-[var(--border)]" />
              <DropdownMenuLabel className="font-display text-xs">Showcase</DropdownMenuLabel>
              <DropdownMenuItem onSelect={openOfficeDemo} disabled={demoBusy} className="rounded-sm focus:bg-[var(--muted)] focus:text-[var(--primary)]" data-testid="menu-office-board-demo">
                {demoBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Presentation className="w-4 h-4 mr-2" />}
                Board Demo — office side
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={openClientDemo} disabled={demoBusy} className="rounded-sm focus:bg-[var(--muted)] focus:text-[var(--primary)]" data-testid="menu-client-board-demo">
                <ExternalLink className="w-4 h-4 mr-2" />
                Board Demo — client side
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-[var(--border)]" />
              <DropdownMenuItem onSelect={() => setTourOpen(true)} className="rounded-sm focus:bg-[var(--muted)] focus:text-[var(--primary)]">
                <GraduationCap className="w-4 h-4 mr-2" />
                Guided tour
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setWingsGuideOpen(true)} className="rounded-sm focus:bg-[var(--muted)] focus:text-[var(--primary)]">
                <BookOpen className="w-4 h-4 mr-2" />
                Wings Program Guide
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSettingsOpen(true)} className="rounded-sm focus:bg-[var(--muted)] focus:text-[var(--primary)]">
                <Settings className="w-4 h-4 mr-2" />
                Settings &amp; business info
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setVoiceOpen(true)} className="rounded-sm focus:bg-[var(--muted)] focus:text-[var(--primary)]">
                <Mic className="w-4 h-4 mr-2" />
                Talk to HALO
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-[76px] flex-1 min-w-0 bg-background flex flex-col min-h-screen">
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
              className="w-full h-12 rounded-full bg-card border border-border shadow-sm pl-11 pr-24 text-sm focus:outline-none focus:border-[var(--primary)] focus:shadow-[0_0_15px_rgba(180,255,68,0.1)] placeholder:text-muted-foreground font-mono transition-all text-foreground"
              data-testid="input-command-bar"
            />
            {cmdText.trim() && (
              <button
                type="button"
                onClick={submitCommand}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 px-6 rounded-full bg-[var(--primary)] hover:bg-[var(--gold-light)] hover:shadow-[0_0_15px_rgba(180,255,68,0.3)] text-[var(--primary-foreground)] text-xs font-display font-bold transition-all"
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
      <WingsGuideDialog open={wingsGuideOpen} onOpenChange={setWingsGuideOpen} />
    </div>
  );
}

function NavItem({ href, icon: Icon, label, active, tourId}: { href: string, icon: any, label: string, active: boolean, tourId?: string}) {
  return (
    <Link href={href} data-tour={tourId} title={label} className={`group flex items-center gap-3 px-3 py-2.5 rounded-none transition-all border-l-2 ${active ? "border-[var(--primary)] bg-[var(--muted)] text-foreground" : "border-transparent text-muted-foreground hover:bg-[var(--muted)]/50 hover:text-foreground hover:border-[var(--border)]"}`}>
      <span className={`custom-icon shrink-0 ${active ? "bg-[var(--primary)] text-black" : "bg-[var(--border)] text-muted-foreground group-hover:text-[var(--primary)] group-hover:bg-[var(--muted)]"}`}>
        <Icon className="w-4 h-4" />
      </span>
      <span className="font-medium text-sm font-display whitespace-nowrap opacity-0 group-hover/side:opacity-100 transition-opacity duration-150">{label}</span>
    </Link>
  );
}
