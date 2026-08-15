import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import KanbanBoard from '@/pages/board';
import MapView from '@/pages/map';
import UnitsPage from '@/pages/units';
import HubPage from '@/pages/hub';
import TeamPage from '@/pages/team';
import HaloOne from '@/pages/halo-one';
import ClientPortfolioPulsePage from '@/pages/pulse';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import './auth-init';

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/:token/board" component={KanbanBoard} />
      <Route path="/:token/map" component={MapView} />
      <Route path="/:token/units" component={UnitsPage} />
      <Route path="/:token/hub" component={HubPage} />
      <Route path="/:token/team" component={TeamPage} />
      <Route path="/:token/halo-one" component={HaloOne} />
      <Route path="/:token" component={ClientPortfolioPulsePage} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
        <UpdatePrompt />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
