import { useState} from "react";
import { Link, useLocation} from "wouter";
import { Mic, Bell, LayoutGrid, Building, DollarSign, Users, Package, Import as ImportIcon, ClipboardList, Settings, GraduationCap, BookOpen, Sparkles, Feather, Presentation, ExternalLink, Loader2, Plus, Briefcase, Receipt, HandCoins, FileSignature, Sun, Moon, Monitor, Hammer} from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
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
import { QuickJobDialog} from "./QuickJobDialog";
import QuickBidDialog from "./QuickBidDialog";
import { AddPropertyDialog} from "./PropertyDialogs";
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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";

export function DesktopLayout({ children}: { children: React.ReactNode}) {
  const [location, navigate] = useLocation();
  const { theme, cycle: cycleTheme } = useTheme();
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
  const [quickJobOpen, setQuickJobOpen] = useState(false);
  const [quickBidOpen, setQuickBidOpen] = useState(false);
  const [newPropertyOpen, setNewPropertyOpen] = useState(false);
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
          <NavKicker label="Desks" />
          <NavItem href="/" icon={Building} label="Portfolio" active={location === "/"} tourId="nav-today" />
          <NavItem href="/pulse" icon={Briefcase} label="Pulse" active={location.startsWith("/pulse")} />
          <NavItem href="/punchlist" icon={Hammer} label="Punchlist" active={location.startsWith("/punchlist")} />
          <NavItem href="/portfolio" icon={LayoutGrid} label="Client board" active={location.startsWith("/portfolio")} />
          <NavItem href="/chat" icon={Sparkles} label="HALO chat" active={location.startsWith("/chat")} />
          <NavKicker label="Records" />
          <NavItem
            href="/jobboard"
            icon={ClipboardList}
            label="Jobs"
            active={location.startsWith("/jobboard") || location.startsWith("/dispatch") || location.startsWith("/calendar") || location.startsWith("/work") || location.startsWith("/jobs/")}
            tourId="nav-jobboard"
          />
          <NavItem
            href="/properties"
            icon={Building}
            label="Properties"
            active={location.startsWith("/properties") || location.startsWith("/pipeline") || location.startsWith("/admin")}
            tourId="nav-properties"
          />
          <NavItem href="/money" icon={DollarSign} label="Money" active={location.startsWith("/money") || location.startsWith("/invoices")} tourId="nav-money" />
          <NavItem href="/crews" icon={Users} label="Crews" active={location.startsWith("/crews") || location.startsWith("/wings")} tourId="nav-crews" />
          <NavItem
            href="/catalog"
            icon={Package}
            label="Purchasing"
            active={location.startsWith("/catalog") || location.startsWith("/supply") || location.startsWith("/vendors")}
            tourId="nav-supply"
          />
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
          {/* Theme toggle: system → light → dark */}
          <button
            data-testid="button-theme-toggle"
            onClick={cycleTheme}
            title={theme === 'system' ? 'Theme: system (click for light)' : theme === 'light' ? 'Theme: light (click for dark)' : 'Theme: dark (click for system)'}
            className="w-full group-hover/side:w-10 h-10 rounded-md flex items-center justify-center bg-[var(--ink2)] text-white shadow-sm border border-[var(--ink2)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
          >
            {theme === 'dark' ? <Moon className="w-4 h-4" /> : theme === 'light' ? <Sun className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
          </button>
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
              <DropdownMenuItem onSelect={() => navigate("/import")} className="rounded-sm focus:bg-[var(--muted)] focus:text-[var(--primary)]" data-testid="menu-import">
                <ImportIcon className="w-4 h-4 mr-2" />
                Import a file
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate("/wings")} className="rounded-sm focus:bg-[var(--muted)] focus:text-[var(--primary)]" data-testid="menu-wings">
                <Feather className="w-4 h-4 mr-2" />
                Wings Program
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
        <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-md px-8 pt-6 pb-4 border-b border-border/50 flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="button-new-anything"
                className="h-12 px-5 rounded-full bg-[var(--gold-light)] text-black font-display font-bold text-sm flex items-center gap-2 shadow-sm hover:shadow-[0_0_15px_rgba(180,255,68,0.35)] transition-all shrink-0"
              >
                <Plus className="w-4 h-4" /> New
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 rounded-md border-[var(--border)] bg-card text-foreground">
              <DropdownMenuLabel className="font-display text-xs">Create</DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-[var(--border)]" />
              <DropdownMenuItem onSelect={() => setNewPropertyOpen(true)} className="rounded-sm focus:bg-[var(--muted)] focus:text-[var(--primary)]" data-testid="menu-new-property">
                <Building className="w-4 h-4 mr-2" /> Property
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="rounded-sm focus:bg-[var(--muted)] focus:text-[var(--primary)]" data-testid="menu-new-job">
                  <Briefcase className="w-4 h-4 mr-2" /> Job/Bid
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="rounded-md border-[var(--border)] bg-card text-foreground">
                  <DropdownMenuItem onSelect={() => setQuickJobOpen(true)} className="rounded-sm focus:bg-[var(--muted)] focus:text-[var(--primary)]" data-testid="menu-new-job-job">
                    <Briefcase className="w-4 h-4 mr-2" /> Job — schedule work now
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setQuickBidOpen(true)} className="rounded-sm focus:bg-[var(--muted)] focus:text-[var(--primary)]" data-testid="menu-new-bid">
                    <FileSignature className="w-4 h-4 mr-2" /> Bid — price it for a client
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onSelect={() => navigate("/invoices/new")} className="rounded-sm focus:bg-[var(--muted)] focus:text-[var(--primary)]" data-testid="menu-new-invoice">
                <Receipt className="w-4 h-4 mr-2" /> Invoice
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate("/money/payments")} className="rounded-sm focus:bg-[var(--muted)] focus:text-[var(--primary)]" data-testid="menu-new-pay-crew">
                <HandCoins className="w-4 h-4 mr-2" /> Pay a crew
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Command input — hidden on "/" (HaloCommand has its own composer) */}
          {location !== "/" && (
            <p className="text-[10px] font-display font-bold tracking-[0.16em] uppercase text-muted-foreground shrink-0">
              Records
            </p>
          )}
          {location !== "/" && (
            <div data-tour="ask-halo" className="relative max-w-2xl flex-1">
              <Sparkles className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--primary)]" />
              <input
                value={cmdText}
                onChange={(e) => setCmdText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitCommand();
                }}
                placeholder='Ask HALO to do anything — "Invoice Maple Grove $950 for painting unit 5"…'
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
          )}
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
      <QuickJobDialog open={quickJobOpen} onOpenChange={setQuickJobOpen} />
      <QuickBidDialog open={quickBidOpen} onOpenChange={setQuickBidOpen} />
      <AddPropertyDialog open={newPropertyOpen} onOpenChange={setNewPropertyOpen} />
      <GuidedTour open={tourOpen} onOpenChange={setTourOpen} />
      <WingsGuideDialog open={wingsGuideOpen} onOpenChange={setWingsGuideOpen} />
    </div>
  );
}

function NavKicker({ label }: { label: string }) {
  return (
    <div className="px-3 pt-3 pb-0.5 h-0 overflow-hidden group-hover/side:h-auto opacity-0 group-hover/side:opacity-100 transition-opacity duration-150">
      <span className="text-[9px] font-display font-bold tracking-[0.18em] uppercase text-white/35">{label}</span>
    </div>
  );
}

function NavItem({ href, icon: Icon, label, active, tourId}: { href: string, icon: any, label: string, active: boolean, tourId?: string}) {
  return (
    <Link href={href} data-tour={tourId} title={label} className={`group flex items-center gap-3 px-3 py-2.5 rounded-md transition-all border-l-2 ${active ? "border-[#B4FF44] bg-[#B4FF44]/12 text-white" : "border-transparent text-white/55 hover:bg-white/8 hover:text-white"}`}>
      <span className={`custom-icon shrink-0 ${active ? "bg-[#B4FF44] text-[#041029]" : "bg-white/10 text-white/70 group-hover:text-[#B4FF44] group-hover:bg-white/15"}`}>
        <Icon className="w-4 h-4" />
      </span>
      <span className="font-medium text-sm font-display whitespace-nowrap opacity-0 group-hover/side:opacity-100 transition-opacity duration-150">{label}</span>
    </Link>
  );
}
