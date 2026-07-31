import { Switch, Route, Router as WouterRouter} from "wouter";
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
import Catalog from "@/pages/Catalog";
import Wings from "@/pages/Wings";
import Payments from "@/pages/Payments";
import Admin from "@/pages/Admin";
import AdminAccount from "@/pages/AdminAccount";

// Live cross-device sync: every device polls the shared server every 15s,
// refetches when the app regains focus or reconnects, so updates made on any
// phone or desktop appear everywhere without a manual reload.
import ClientBoardOffice from "@/pages/ClientBoardOffice";
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
              <SplashScreen />
              <DesktopLayout>
                <Switch>
                  <Route path="/" component={Today} />
                  <Route path="/properties" component={Properties} />
                  <Route path="/properties/:id" component={PropertyDetail} />
                  <Route path="/jobs/:id" component={JobDetail} />
                  <Route path="/invoices/new" component={CreateInvoice} />
                  <Route path="/invoices/:id" component={InvoiceDetail} />
                  <Route path="/money" component={Money} />
                  <Route path="/money/payments" component={Payments} />
                  <Route path="/calendar" component={Calendar} />
                  <Route path="/crews" component={Crews} />
                  <Route path="/crews/:id" component={CrewDetail} />
                  <Route path="/wings" component={Wings} />
                  <Route path="/pipeline" component={Pipeline} />
                  <Route path="/catalog" component={Catalog} />
                  <Route path="/supply" component={Supply} />
                  <Route path="/vendors" component={Vendors} />
                  <Route path="/import" component={Import} />
                  <Route path="/jobboard" component={JobBoard} />
                  <Route path="/admin" component={Admin} />
                  <Route path="/admin/:propertyId" component={AdminAccount} />
                  <Route path="/admin/:propertyId/board" component={ClientBoardOffice} />
                  <Route component={NotFound} />
                </Switch>
              </DesktopLayout>
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
