import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "./components/Layout";
import { SplashScreen } from "./components/SplashScreen";

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

// Primary interface
import HaloCommand from "./pages/HaloCommand";
import PropertyPulse from "./pages/PropertyPulse";
import ClientPortfolioPulse from "./pages/ClientPortfolioPulse";
import PropertyTurnBoard from "./pages/PropertyTurnBoard";
import EntrataImportPage from "./pages/EntrataImport";
import CostToServePage from "./pages/CostToServe";
import BidBoardPage from "./pages/BidBoard";
import TurnPipelinePage from "./pages/TurnPipeline";
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

/** Wrap a page component with the office gate + stripped Layout chrome. */
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

            {/* ── HALO Command — the entire product surface ─────────────── */}
            <Route path="/">
              <OfficeGate>
                <HaloCommand />
              </OfficeGate>
            </Route>

            <Route path="/pulse">
              <OfficeGate>
                <PropertyPulse />
              </OfficeGate>
            </Route>

            <Route path="/portfolio">
              <OfficeGate>
                <ClientPortfolioPulse />
              </OfficeGate>
            </Route>

            <Route path="/imports">
              <OfficeGate>
                <EntrataImportPage />
              </OfficeGate>
            </Route>

            <Route path="/how-work">
              <OfficeGate>
                <CostToServePage />
              </OfficeGate>
            </Route>

            <Route path="/board/pipeline">
              <OfficeGate>
                <TurnPipelinePage />
              </OfficeGate>
            </Route>

            <Route path="/bid-requests/:id">
              <OfficeGate>
                <BidBoardPage />
              </OfficeGate>
            </Route>

            <Route path="/properties/:id/turns">
              <OfficeGate>
                <PropertyTurnBoard />
              </OfficeGate>
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
