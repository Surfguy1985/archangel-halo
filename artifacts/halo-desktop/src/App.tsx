import { Switch, Route, Router as WouterRouter } from "wouter";
import { OfficeGate } from "./components/OfficeGate";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { DesktopLayout } from "@/components/DesktopLayout";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import { SplashScreen } from "@/components/SplashScreen";
import Properties from "@/pages/Properties";
import PropertyDetail from "@/pages/PropertyDetail";
import Money from "@/pages/Money";
import Calendar from "@/pages/Calendar";
import Dispatch from "@/pages/Dispatch";
import Import from "@/pages/Import";
import Crews from "@/pages/Crews";
import Pipeline from "@/pages/Pipeline";
import Supply from "@/pages/Supply";
import Vendors from "@/pages/Vendors";
import JobDetail from "@/pages/JobDetail";
import InvoiceDetail from "@/pages/InvoiceDetail";
import CreateInvoice from "@/pages/CreateInvoice";
import CrewDetail from "@/pages/CrewDetail";
import CrewPortal from "@/pages/CrewPortal";
import { HaloCrewPaycardPage as CrewCheckinPage } from "@workspace/board-ui";
import JobBoard from "@/pages/JobBoard";
import WorkEmbed from "@/pages/WorkEmbed";
import Catalog from "@/pages/Catalog";
import Wings from "@/pages/Wings";
import Payments from "@/pages/Payments";
import Admin from "@/pages/Admin";
import AdminAccount from "@/pages/AdminAccount";
import HaloCommand from "@/pages/HaloCommand";
import PropertyPulse from "@/pages/PropertyPulse";
const ClientPortfolioPulse = lazy(() => import("@/pages/ClientPortfolioPulse"));
const PropertyTurnBoard = lazy(() => import("@/pages/PropertyTurnBoard"));
const EntrataImportPage = lazy(() => import("@/pages/EntrataImport"));
const CostToServePage = lazy(() => import("@/pages/CostToServe"));
const BidBoardPage = lazy(() => import("@/pages/BidBoard"));
const TurnPipelinePage = lazy(() => import("@/pages/TurnPipeline"));
const AuditLogPage = lazy(() => import("@/pages/AuditLog"));
const ClientBoardViewsPage = lazy(() => import("@/pages/ClientBoardViews"));
import ClientBoardOffice from "@/pages/ClientBoardOffice";
import FalkonConnect from "@/pages/FalkonConnect";
import { HubShell, WORK_TABS, CLIENT_TABS, MONEY_TABS, PURCHASING_TABS } from "@/components/HubShell";
import { BoardRouteFallback } from "@workspace/board-ui";

// Live cross-device sync: every device polls the shared server every 15s,
// refetches when the app regains focus or reconnects, so updates made on any
// phone or desktop appear everywhere without a manual reload.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchInterval: 15_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
});

function BoardPage({ children }: { children: React.ReactNode }) {
  return (
    <OfficeGate>
      <SplashScreen />
      <Suspense fallback={<BoardRouteFallback />}>{children}</Suspense>
    </OfficeGate>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Switch>
            {/* ── Public crew portal (no auth) ──────────────────────────── */}
            <Route path="/portal/:token" component={CrewPortal} />
            <Route path="/checkin/:token">
              {(params) => <CrewCheckinPage token={params.token} />}
            </Route>

            <Route path="/views">
              <Suspense fallback={<BoardRouteFallback />}>
                <ClientBoardViewsPage />
              </Suspense>
            </Route>
            <Route path="/regional">
              {() => {
                window.location.replace("/board/caf-regional");
                return null;
              }}
            </Route>
            <Route path="/paloma">
              {() => {
                window.location.replace("/board/caf-paloma");
                return null;
              }}
            </Route>

            {/* ── Home — Property Portfolio desk (corporate). Same full-bleed
                map HUD as Pulse and Punchlist; only the desk profile changes. */}
            <Route path="/">
              <OfficeGate>
                <SplashScreen />
                <PropertyPulse level="portfolio" />
              </OfficeGate>
            </Route>

            {/* ── HALO Command — full-screen dark chat OS, no sidebar ───────
                "/" is now the map-first Property Pulse HUD, so the full chat
                lives here at "/chat". Sits BEFORE the DesktopLayout catch-all
                so it renders without the hub sidebar; the div supplies the
                full-viewport height HaloCommand's h-full layout expects.   */}
            <Route path="/chat">
              <OfficeGate>
                <SplashScreen />
                <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
                  <HaloCommand />
                </div>
              </OfficeGate>
            </Route>

            {/* ── /today → full HALO Command chat (legacy alias) ─────────── */}
            <Route path="/today">
              {() => { window.location.replace(import.meta.env.BASE_URL.replace(/\/$/, "") + "/chat"); return null; }}
            </Route>

            {/* Property Pulse — property-manager desk */}
            <Route path="/pulse">
              <OfficeGate>
                <SplashScreen />
                <PropertyPulse level="pulse" />
              </OfficeGate>
            </Route>

            {/* Property Punchlist — Archangel Contractors / vendor desk */}
            <Route path="/punchlist">
              <OfficeGate>
                <SplashScreen />
                <PropertyPulse level="punchlist" />
              </OfficeGate>
            </Route>

            <Route path="/portfolio">
              <BoardPage>
                <ClientPortfolioPulse />
              </BoardPage>
            </Route>

            <Route path="/imports">
              <BoardPage>
                <EntrataImportPage />
              </BoardPage>
            </Route>

            <Route path="/how-work">
              <BoardPage>
                <CostToServePage />
              </BoardPage>
            </Route>

            <Route path="/board/pipeline">
              <BoardPage>
                <TurnPipelinePage />
              </BoardPage>
            </Route>

            <Route path="/audit">
              <BoardPage>
                <AuditLogPage />
              </BoardPage>
            </Route>

            <Route path="/bid-requests/:id">
              <BoardPage>
                <BidBoardPage />
              </BoardPage>
            </Route>

            <Route path="/properties/:id/turns">
              <BoardPage>
                <PropertyTurnBoard />
              </BoardPage>
            </Route>

            {/* ── All other routes — hub layout with sidebar ────────────── */}
            <Route>
              <OfficeGate>
                <SplashScreen />
                <DesktopLayout>
                  <Switch>
                    <Route path="/properties">{() => <HubShell title="Properties" tabs={CLIENT_TABS}><Properties /></HubShell>}</Route>
                    <Route path="/properties/:id" component={PropertyDetail} />
                    <Route path="/jobs/:id" component={JobDetail} />
                    <Route path="/invoices/new" component={CreateInvoice} />
                    <Route path="/invoices/:id" component={InvoiceDetail} />
                    <Route path="/money">{() => <HubShell title="Money" tabs={MONEY_TABS}><Money /></HubShell>}</Route>
                    <Route path="/money/payments">{() => <HubShell title="Money" tabs={MONEY_TABS}><Payments /></HubShell>}</Route>
                    {/* Base44 work-app launcher + sync status. Sits in the Jobs hub
                        tab bar beside Board/Dispatch/Calendar; also reachable from
                        the ⋯ menu and any legacy /work link. */}
                    <Route path="/work">{() => <HubShell title="Jobs" tabs={WORK_TABS}><WorkEmbed /></HubShell>}</Route>
                    <Route path="/calendar">{() => <HubShell title="Jobs" tabs={WORK_TABS}><Calendar /></HubShell>}</Route>
                    <Route path="/dispatch">{() => <HubShell title="Jobs" tabs={WORK_TABS}><Dispatch /></HubShell>}</Route>
                    <Route path="/crews" component={Crews} />
                    <Route path="/crews/:id" component={CrewDetail} />
                    <Route path="/wings" component={Wings} />
                    <Route path="/pipeline">{() => <HubShell title="Properties" tabs={CLIENT_TABS}><Pipeline /></HubShell>}</Route>
                    <Route path="/catalog">{() => <HubShell title="Purchasing" tabs={PURCHASING_TABS}><Catalog /></HubShell>}</Route>
                    <Route path="/supply">{() => <HubShell title="Purchasing" tabs={PURCHASING_TABS}><Supply /></HubShell>}</Route>
                    <Route path="/vendors">{() => <HubShell title="Purchasing" tabs={PURCHASING_TABS}><Vendors /></HubShell>}</Route>
                    <Route path="/import" component={Import} />
                    <Route path="/integrations">{() => <FalkonConnect />}</Route>
                    <Route path="/jobboard">{() => <HubShell title="Jobs" tabs={WORK_TABS}><JobBoard /></HubShell>}</Route>
                    <Route path="/admin">{() => <HubShell title="Properties" tabs={CLIENT_TABS}><Admin /></HubShell>}</Route>
                    <Route path="/admin/:propertyId" component={AdminAccount} />
                    <Route path="/admin/:propertyId/board" component={ClientBoardOffice} />
                    {/* Alias: the mobile app's Board Demo link uses /properties/:id/board?present=1;
                        desktop visitors get redirected here, so serve the same office board. */}
                    <Route path="/properties/:propertyId/board" component={ClientBoardOffice} />
                    {/* Legacy redirect — /invoices without an ID goes to the Money hub */}
                    <Route path="/invoices">{() => { window.location.replace(import.meta.env.BASE_URL.replace(/\/$/, "") + "/money"); return null; }}</Route>
                    <Route component={NotFound} />
                  </Switch>
                </DesktopLayout>
              </OfficeGate>
            </Route>
          </Switch>
        </WouterRouter>
        <Toaster />
        <UpdatePrompt />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
