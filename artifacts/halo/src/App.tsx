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
import { OfficeGate } from "./components/OfficeGate";

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
