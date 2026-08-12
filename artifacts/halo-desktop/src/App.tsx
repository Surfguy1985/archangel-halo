import { Switch, Route, Router as WouterRouter} from "wouter";
import { OfficeGate } from "./components/OfficeGate";
import { QueryClient, QueryClientProvider} from "@tanstack/react-query";
import { Toaster} from "@/components/ui/toaster";
import { TooltipProvider} from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { DesktopLayout} from "@/components/DesktopLayout";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import { SplashScreen} from "@/components/SplashScreen";
import Today from "@/pages/Today";
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
import JobBoard from "@/pages/JobBoard";
import WorkEmbed from "@/pages/WorkEmbed";
import Catalog from "@/pages/Catalog";
import Wings from "@/pages/Wings";
import Payments from "@/pages/Payments";
import Admin from "@/pages/Admin";
import AdminAccount from "@/pages/AdminAccount";

// Live cross-device sync: every device polls the shared server every 15s,
// refetches when the app regains focus or reconnects, so updates made on any
// phone or desktop appear everywhere without a manual reload.
import ClientBoardOffice from "@/pages/ClientBoardOffice";
import FalkonConnect from "@/pages/FalkonConnect";
import { HubShell, WORK_TABS, CLIENT_TABS, MONEY_TABS, PURCHASING_TABS } from "@/components/HubShell";
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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Switch>
            <Route path="/portal/:token" component={CrewPortal} />
            <Route>
              <OfficeGate>
              <SplashScreen />
              <DesktopLayout>
                <Switch>
                  <Route path="/" component={Today} />
                  <Route path="/properties">{() => <HubShell title="Clients" tabs={CLIENT_TABS}><Properties /></HubShell>}</Route>
                  <Route path="/properties/:id" component={PropertyDetail} />
                  <Route path="/jobs/:id" component={JobDetail} />
                  <Route path="/invoices/new" component={CreateInvoice} />
                  <Route path="/invoices/:id" component={InvoiceDetail} />
                  <Route path="/money">{() => <HubShell title="Money" tabs={MONEY_TABS}><Money /></HubShell>}</Route>
                  <Route path="/money/payments">{() => <HubShell title="Money" tabs={MONEY_TABS}><Payments /></HubShell>}</Route>
                  <Route path="/work">{() => <HubShell title="Work" tabs={WORK_TABS}><WorkEmbed /></HubShell>}</Route>
                  <Route path="/calendar">{() => <HubShell title="Work" tabs={WORK_TABS}><Calendar /></HubShell>}</Route>
                  <Route path="/dispatch">{() => <HubShell title="Work" tabs={WORK_TABS}><Dispatch /></HubShell>}</Route>
                  <Route path="/crews" component={Crews} />
                  <Route path="/crews/:id" component={CrewDetail} />
                  <Route path="/wings" component={Wings} />
                  <Route path="/pipeline">{() => <HubShell title="Clients" tabs={CLIENT_TABS}><Pipeline /></HubShell>}</Route>
                  <Route path="/catalog">{() => <HubShell title="Purchasing" tabs={PURCHASING_TABS}><Catalog /></HubShell>}</Route>
                  <Route path="/supply">{() => <HubShell title="Purchasing" tabs={PURCHASING_TABS}><Supply /></HubShell>}</Route>
                  <Route path="/vendors">{() => <HubShell title="Purchasing" tabs={PURCHASING_TABS}><Vendors /></HubShell>}</Route>
                  <Route path="/import" component={Import} />
                  <Route path="/integrations">{() => <FalkonConnect />}</Route>
                  <Route path="/jobboard">{() => <HubShell title="Work" tabs={WORK_TABS}><JobBoard /></HubShell>}</Route>
                  <Route path="/admin">{() => <HubShell title="Clients" tabs={CLIENT_TABS}><Admin /></HubShell>}</Route>
                  <Route path="/admin/:propertyId" component={AdminAccount} />
                  <Route path="/admin/:propertyId/board" component={ClientBoardOffice} />
                  {/* Alias: the mobile app's Board Demo link uses /properties/:id/board?present=1;
                      desktop visitors get redirected here, so serve the same office board. */}
                  <Route path="/properties/:propertyId/board" component={ClientBoardOffice} />
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
