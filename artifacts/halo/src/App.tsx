import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "./components/Layout";
import Today from "./pages/Today";
import Properties from "./pages/Properties";
import PropertyDetail from "./pages/PropertyDetail";
import JobDetail from "./pages/JobDetail";
import Money from "./pages/Money";
import Calendar from "./pages/Calendar";
import Crews from "./pages/Crews";
import CrewDetail from "./pages/CrewDetail";
import CrewPortal from "./pages/CrewPortal";
import Pipeline from "./pages/Pipeline";
import Supply from "./pages/Supply";
import Vendors from "./pages/Vendors";
import Import from "./pages/Import";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function AdminRouter() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Today} />
        <Route path="/properties" component={Properties} />
        <Route path="/properties/:id" component={PropertyDetail} />
        <Route path="/jobs/:id" component={JobDetail} />
        <Route path="/money" component={Money} />
        <Route path="/calendar" component={Calendar} />
        <Route path="/crews" component={Crews} />
        <Route path="/crews/:id" component={CrewDetail} />
        <Route path="/pipeline" component={Pipeline} />
        <Route path="/supply" component={Supply} />
        <Route path="/vendors" component={Vendors} />
        <Route path="/import" component={Import} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Switch>
            <Route path="/portal/:token" component={CrewPortal} />
            <Route component={AdminRouter} />
          </Switch>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
