import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "./components/Layout";
import { SplashScreen } from "./components/SplashScreen";
import { BoardRouteFallback } from "@workspace/board-ui";

// Operational deep-link targets (emails, notifications, menu)
import JobDetail from "./pages/JobDetail";
import InvoiceDetail from "./pages/InvoiceDetail";
import PropertyDetail from "./pages/PropertyDetail";
import ClientBoardOffice from "./pages/ClientBoardOffice";
import Settings from "./pages/Settings";

// Public token surfaces
import CrewPortal from "./pages/CrewPortal";
import PhotoShare from "./pages/PhotoShare";
import RecapShare from "./pages/RecapShare";
import SummaryShare from "./pages/SummaryShare";
import ClientAdmin from "./pages/ClientAdmin";
import ClientRequest from "./pages/ClientRequest";
import JobTracker from "./pages/JobTracker";
import PublicPayment from "./pages/PublicPayment";
import PMliveView from "./pages/PMliveView";
import CrewCheckinPage from "./pages/CrewCheckinPage";
import CrewJoinPage from "./pages/CrewJoinPage";

// Primary interface
import HaloCommand from "./pages/HaloCommand";
import PropertyPulse from "./pages/PropertyPulse";
const ClientPortfolioPulse = lazy(() => import("./pages/ClientPortfolioPulse"));
const PropertyTurnBoard = lazy(() => import("./pages/PropertyTurnBoard"));
const EntrataImportPage = lazy(() => import("./pages/EntrataImport"));
const CostToServePage = lazy(() => import("./pages/CostToServe"));
const BidBoardPage = lazy(() => import("./pages/BidBoard"));
const TurnPipelinePage = lazy(() => import("./pages/TurnPipeline"));
const AuditLogPage = lazy(() => import("./pages/AuditLog"));
const ClientBoardViewsPage = lazy(() => import("./pages/ClientBoardViews"));
import { OfficeGate } from "./components/OfficeGate";
import { OpsLayout } from "./components/OpsLayout";
import Today from "./pages/Today";
import Properties from "./pages/Properties";
import Crews from "./pages/Crews";
import CrewDetail from "./pages/CrewDetail";
import Calendar from "./pages/Calendar";
import Money from "./pages/Money";
import JobBoard from "./pages/JobBoard";
import Supply from "./pages/Supply";
import Vendors from "./pages/Vendors";
import Pipeline from "./pages/Pipeline";
import Catalog from "./pages/Catalog";

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

/** Traditional CRM shell — summoned from the HALO HUD. */
function GatedOps({ children }: { children: React.ReactNode }) {
  return (
    <OfficeGate>
      <SplashScreen />
      <OpsLayout>{children}</OpsLayout>
    </OfficeGate>
  );
}

/** Client-board routes: code-split with a navy skeleton matching final layout. */
function BoardPage({ children }: { children: React.ReactNode }) {
  return (
    <OfficeGate>
      <Suspense fallback={<BoardRouteFallback />}>{children}</Suspense>
    </OfficeGate>
  );
}

function GatedPage({ children }: { children: React.ReactNode }) {
  return (
    <OfficeGate>
      <SplashScreen />
      <Layout>{children}</Layout>
    </OfficeGate>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Switch>
            {/* ── Public token routes (no auth) ─────────────────────────── */}
            <Route path="/portal/:token" component={CrewPortal} />
            <Route path="/photos/:token" component={PhotoShare} />
            <Route path="/recap/:token" component={RecapShare} />
            <Route path="/summary/:token" component={SummaryShare} />
            <Route path="/track/:token" component={JobTracker} />
            <Route path="/pay/:token" component={PublicPayment} />
            <Route path="/live/:token">
              {(params) => <PMliveView token={params.token} />}
            </Route>
            <Route path="/checkin/:token">
              {(params) => <CrewCheckinPage token={params.token} />}
            </Route>
            <Route path="/join/:token">
              {(params) => <CrewJoinPage token={params.token} />}
            </Route>

            {/* ── Legacy redirects — bookmarked / emailed links ──────────── */}
            <Route path="/dashboard/:token">
              {(params) => {
                window.location.replace(`/board/${encodeURIComponent(params.token)}${window.location.search}${window.location.hash}`);
                return null;
              }}
            </Route>
            <Route path="/dashboard/:token/:rest*">
              {(params) => {
                window.location.replace(`/board/${encodeURIComponent(params.token)}${window.location.search}${window.location.hash}`);
                return null;
              }}
            </Route>
            <Route path="/client/:token">
              {(params) => {
                window.location.replace(`/board/${encodeURIComponent(params.token)}${window.location.search}${window.location.hash}`);
                return null;
              }}
            </Route>
            <Route path="/client/:token/admin" component={ClientAdmin} />
            <Route path="/client/:token/board">
              {(params) => {
                window.location.replace(`/board/${encodeURIComponent(params.token)}${window.location.search}${window.location.hash}`);
                return null;
              }}
            </Route>
            <Route path="/client/:token/requests" component={ClientRequest} />

            {/* Password-free regional / property Pulse (client dashboard tokens) */}
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

            {/* ── HALO Command — the entire product surface ─────────────── */}
            <Route path="/">
              <OfficeGate>
                <HaloCommand />
              </OfficeGate>
            </Route>

            <Route path="/property-portfolio">
              <OfficeGate>
                <PropertyPulse level="portfolio" />
              </OfficeGate>
            </Route>

            <Route path="/pulse">
              <OfficeGate>
                <PropertyPulse level="pulse" />
              </OfficeGate>
            </Route>

            <Route path="/punchlist">
              <OfficeGate>
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

            {/* ── Operational deep-links ─────────────────────────────────
                Accessible from the Settings menu item and from links in
                emails / push notifications. Never surfaced in the chat UI.  */}
            <Route path="/settings">
              <GatedPage><Settings /></GatedPage>
            </Route>
            <Route path="/jobs/:id">
              <GatedPage><JobDetail /></GatedPage>
            </Route>
            <Route path="/invoices/:id">
              <GatedPage><InvoiceDetail /></GatedPage>
            </Route>
            {/* Board must be matched before /:id so it isn't swallowed */}
            <Route path="/properties/:id/board">
              <GatedPage><ClientBoardOffice /></GatedPage>
            </Route>
            <Route path="/properties/:id">
              <GatedPage><PropertyDetail /></GatedPage>
            </Route>
            <Route path="/properties">
              <GatedOps><Properties /></GatedOps>
            </Route>
            <Route path="/ops">
              <GatedOps><Today /></GatedOps>
            </Route>
            <Route path="/today">
              <GatedOps><Today /></GatedOps>
            </Route>
            <Route path="/crews/:id">
              <GatedPage><CrewDetail /></GatedPage>
            </Route>
            <Route path="/crews">
              <GatedOps><Crews /></GatedOps>
            </Route>
            <Route path="/calendar">
              <GatedOps><Calendar /></GatedOps>
            </Route>
            <Route path="/money">
              <GatedOps><Money /></GatedOps>
            </Route>
            <Route path="/jobboard">
              <GatedOps><JobBoard /></GatedOps>
            </Route>
            <Route path="/supply">
              <GatedOps><Supply /></GatedOps>
            </Route>
            <Route path="/vendors">
              <GatedOps><Vendors /></GatedOps>
            </Route>
            <Route path="/pipeline">
              <GatedOps><Pipeline /></GatedOps>
            </Route>
            <Route path="/catalog">
              <GatedOps><Catalog /></GatedOps>
            </Route>

            {/* ── Catch-all: every unrecognised path → chat OS ──────────── */}
            <Route>
              {() => { window.location.replace("/"); return null; }}
            </Route>
          </Switch>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
