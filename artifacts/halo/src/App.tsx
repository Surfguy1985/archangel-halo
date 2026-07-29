import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "./components/Layout";
import { SplashScreen } from "./components/SplashScreen";
import Today from "./pages/Today";
import Properties from "./pages/Properties";
import PropertyDetail from "./pages/PropertyDetail";
import JobDetail from "./pages/JobDetail";
import Money from "./pages/Money";
import InvoiceDetail from "./pages/InvoiceDetail";
import Calendar from "./pages/Calendar";
import Crews from "./pages/Crews";
import CrewDetail from "./pages/CrewDetail";
import CrewPortal from "./pages/CrewPortal";
import PhotoShare from "./pages/PhotoShare";
import RecapShare from "./pages/RecapShare";
import SummaryShare from "./pages/SummaryShare";
import ClientAdmin from "./pages/ClientAdmin";
import ClientBoardOffice from "./pages/ClientBoardOffice";
import ClientRequest from "./pages/ClientRequest";
import JobTracker from "./pages/JobTracker";
import Pipeline from "./pages/Pipeline";
import PaymentsHub from "./pages/PaymentsHub";
import PublicPayment from "./pages/PublicPayment";
import Supply from "./pages/Supply";
import Vendors from "./pages/Vendors";
import Import from "./pages/Import";
import JobBoard from "./pages/JobBoard";
import Settings from "./pages/Settings";
import Catalog from "./pages/Catalog";
import Wings from "./pages/Wings";
import NotFound from "@/pages/not-found";

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

function AdminRouter() {
  return (
    <>
      <SplashScreen />
      <Layout>
      <Switch>
        <Route path="/" component={Today} />
        <Route path="/properties" component={Properties} />
        <Route path="/properties/:id" component={PropertyDetail} />
        <Route path="/properties/:id/board" component={ClientBoardOffice} />
        <Route path="/jobs/:id" component={JobDetail} />
        <Route path="/money" component={Money} />
        <Route path="/money/payments" component={PaymentsHub} />
        <Route path="/invoices/:id" component={InvoiceDetail} />
        <Route path="/calendar" component={Calendar} />
        <Route path="/crews" component={Crews} />
        <Route path="/crews/:id" component={CrewDetail} />
        <Route path="/pipeline" component={Pipeline} />
        <Route path="/jobboard" component={JobBoard} />
        <Route path="/catalog" component={Catalog} />
        <Route path="/wings" component={Wings} />
        <Route path="/supply" component={Supply} />
        <Route path="/vendors" component={Vendors} />
        <Route path="/import" component={Import} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
      </Layout>
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Switch>
            <Route path="/portal/:token" component={CrewPortal} />
            <Route path="/photos/:token" component={PhotoShare} />
            <Route path="/recap/:token" component={RecapShare} />
            <Route path="/summary/:token" component={SummaryShare} />
            {/* Bare client links now live on the client dashboard artifact. */}
            <Route path="/client/:token">
              {(params) => {
                window.location.replace(`/dashboard/${params.token}`);
                return null;
              }}
            </Route>
            <Route path="/client/:token/admin" component={ClientAdmin} />
            {/* Old client board retired — bookmarked links land on the new dashboard. */}
            <Route path="/client/:token/board">
              {(params) => {
                window.location.replace(`/dashboard/${params.token}`);
                return null;
              }}
            </Route>
            <Route path="/client/:token/requests" component={ClientRequest} />
            <Route path="/track/:token" component={JobTracker} />
            <Route path="/pay/:token" component={PublicPayment} />
            <Route component={AdminRouter} />
          </Switch>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
