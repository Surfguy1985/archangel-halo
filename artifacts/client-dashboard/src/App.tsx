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
import ClientPropertyTurnBoardPage from '@/pages/property-turns';
import ClientEntrataImportPage from '@/pages/entrata-import';
import ClientHowWorkPage from '@/pages/how-work';
import ClientBidBoardPage from '@/pages/bid-board';
import ClientTurnPipelinePage from '@/pages/turn-pipeline';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import './auth-init';

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/:token/property/:propertyId" component={ClientPropertyTurnBoardPage} />
      <Route path="/:token/imports" component={ClientEntrataImportPage} />
      <Route path="/:token/how-work" component={ClientHowWorkPage} />
      <Route path="/:token/bid-requests/:id" component={ClientBidBoardPage} />
      <Route path="/:token/pipeline" component={ClientTurnPipelinePage} />
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
